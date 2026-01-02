/**
 * 代码审查工具实现
 * 支持单 provider 模式和自动并发模式（由 CONCURRENT_REVIEW 开关控制）
 * 支持文件路径输入和 git diff 模式
 * 支持项目上下文增强
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { collectFiles } from "../core/io.js";
import { generateOutput } from "../core/merge.js";
import { getLLMProvider, getConfiguredProviders } from "../core/llm/index.js";
import { getEnhancedGitDiff, type GitMode } from "../core/git.js";
import {
    collectProjectContext,
    formatProjectContext,
} from "../core/project-context.js";
import {
    buildSystemPrompt,
    buildUserPrompt,
    parseReviewResponse,
} from "../prompts/review-prompt.js";
import type {
    CodeReviewInput,
    CodeReviewOutput,
    ReviewResult,
    ReviewIssue,
} from "../types/review.js";
import type { LLMProviderType, ChatMessage } from "../core/llm/types.js";
import type { GroupedFiles, MergeMode } from "../types/merge.js";

// Token 估算（粗略：1 token ≈ 4 字符）
const CHARS_PER_TOKEN = 4;
const MAX_INPUT_TOKENS = 80000; // 留出输出空间
const MAX_INPUT_CHARS = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;

// 默认输出目录
const DEFAULT_OUTPUT_DIR = path.join(
    import.meta.dirname ?? process.cwd(),
    "..",
    "..",
    "output"
);

/**
 * 获取配置的 provider 列表
 */
export function getReviewProviders(): LLMProviderType[] {
    return getConfiguredProviders();
}

/**
 * 是否需要询问用户反馈
 */
export function shouldAskUserFeedback(): boolean {
    const env = process.env.ASK_USER_FEEDBACK;
    return env === "true" || env === "1";
}

/**
 * 是否启用自动并发审查
 * 开启后，工具会自动并发调用所有配置的 provider
 */
export function shouldConcurrentReview(): boolean {
    const env = process.env.CONCURRENT_REVIEW;
    return env === "true" || env === "1";
}

/**
 * 执行代码审查
 */
export async function executeCodeReview(
    input: CodeReviewInput
): Promise<CodeReviewOutput> {
    const startTime = Date.now();

    const {
        inputs,
        git_mode,
        include_full_files = false,
        include_project_context = true,
        focus = "all",
        extensions,
        excludes,
        mode = "compact",
        provider: providerType,
        context,
        output = "inline",
        output_dir,
    } = input;

    // 验证输入：inputs 和 git_mode 至少要有一个
    if (!inputs?.length && !git_mode) {
        throw new Error("必须指定 inputs（文件路径）或 git_mode（git diff 模式）");
    }

    // 收集项目上下文（如果启用）
    let projectContextStr = "";
    if (include_project_context) {
        const projectCtx = collectProjectContext();
        projectContextStr = formatProjectContext(projectCtx);
    }

    let codeContent: string;
    let filesCount: number;

    // 根据模式获取代码内容
    if (git_mode) {
        // Git diff 模式（增强版，可选包含完整文件）
        const gitResult = getEnhancedGitDiff(git_mode as GitMode, {
            includeFullFiles: include_full_files,
        });

        if (!gitResult.content || gitResult.files.length === 0) {
            throw new Error(`没有${git_mode === "staged" ? "已暂存" : git_mode === "unstaged" ? "未暂存" : "未提交"}的更改`);
        }

        filesCount = gitResult.files.length;

        // 构建代码内容
        const parts: string[] = [];

        // 添加 Git diff 信息
        parts.push(`[Git Diff 模式: ${git_mode}]`);
        parts.push(`变更文件: ${gitResult.files.join(", ")}`);
        parts.push(`统计: +${gitResult.stats.additions} -${gitResult.stats.deletions}`);
        parts.push("");

        // 如果包含完整文件内容，先显示完整文件，再显示 diff
        if (include_full_files && gitResult.fullFilesContent) {
            parts.push("## 变更文件完整内容");
            parts.push(gitResult.fullFilesContent);
            parts.push("");
            parts.push("## Git Diff 详情");
        }

        parts.push(gitResult.content);
        codeContent = parts.join("\n");
    } else {
        // 文件路径模式
        const files = await collectFiles(inputs!, extensions, excludes, false);
        const fileList = Array.isArray(files)
            ? files
            : Object.values(files as GroupedFiles).flat();

        if (fileList.length === 0) {
            throw new Error("未找到匹配的文件，请检查输入路径和过滤条件");
        }

        codeContent = generateOutput(fileList, mode as MergeMode, false);
        filesCount = fileList.length;
    }

    // 组合最终的代码上下文
    let finalContent = "";
    if (projectContextStr) {
        finalContent = projectContextStr + "\n\n---\n\n## 待审查代码\n\n" + codeContent;
    } else {
        finalContent = codeContent;
    }

    // 检查 token 限制
    const estimatedTokens = Math.round(finalContent.length / CHARS_PER_TOKEN);
    if (finalContent.length > MAX_INPUT_CHARS) {
        throw new Error(
            `代码内容超过 token 限制。` +
                `当前约 ${estimatedTokens} tokens，最大 ${MAX_INPUT_TOKENS} tokens。` +
                `请尝试使用 compact 模式或缩小文件范围。`
        );
    }

    // 构建 Prompt
    const systemPrompt = buildSystemPrompt(focus);
    const userPrompt = buildUserPrompt({ code: finalContent, focus, context });
    const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
    ];

    // 判断执行模式
    const configuredProviders = getConfiguredProviders();
    const isConcurrent = shouldConcurrentReview();

    // 如果指定了 provider 参数，或者未开启并发，或者只配置了一个 provider → 单 provider 模式
    if (providerType || !isConcurrent || configuredProviders.length <= 1) {
        return executeSingleReview({
            messages,
            providerType: providerType as LLMProviderType | undefined,
            filesCount,
            startTime,
            output,
            output_dir,
        });
    }

    // 并发模式：自动调用所有配置的 provider
    return executeConcurrentReview({
        messages,
        providers: configuredProviders,
        filesCount,
        startTime,
        output,
        output_dir,
    });
}

/**
 * 单 provider 审查
 */
async function executeSingleReview(params: {
    messages: ChatMessage[];
    providerType?: LLMProviderType;
    filesCount: number;
    startTime: number;
    output: "inline" | "file";
    output_dir?: string;
}): Promise<CodeReviewOutput> {
    const { messages, providerType, filesCount, startTime, output, output_dir } = params;

    const provider = getLLMProvider(providerType);
    const llmResponse = await provider.chat(messages, {
        maxTokens: 16384,
        temperature: 0.3,
        thinking: true,
    });

    const parsedResult = parseReviewResponse(llmResponse.content);
    const result = validateAndEnrichResult(parsedResult, {
        filesReviewed: filesCount,
        provider: provider.name,
        model: llmResponse.model,
        tokensUsed: llmResponse.usage?.totalTokens,
        durationMs: Date.now() - startTime,
    });

    const report = generateMarkdownReport(result);

    let outputPath: string | undefined;
    if (output === "file") {
        const outputDir = output_dir ?? DEFAULT_OUTPUT_DIR;
        outputPath = writeReviewReport(outputDir, report);
    }

    return {
        result,
        report,
        output_path: outputPath,
        configured_providers: getConfiguredProviders(),
        ask_user_feedback: shouldAskUserFeedback(),
        is_concurrent: false,
    };
}

/**
 * 并发调用多个 provider 审查
 */
async function executeConcurrentReview(params: {
    messages: ChatMessage[];
    providers: LLMProviderType[];
    filesCount: number;
    startTime: number;
    output: "inline" | "file";
    output_dir?: string;
}): Promise<CodeReviewOutput> {
    const { messages, providers, filesCount, startTime, output, output_dir } = params;

    // 并发调用所有 provider
    const reviewPromises = providers.map(async (providerType) => {
        const provider = getLLMProvider(providerType);
        const llmResponse = await provider.chat(messages, {
            maxTokens: 16384,
            temperature: 0.3,
            thinking: true,
        });

        const parsedResult = parseReviewResponse(llmResponse.content);
        return {
            providerType,
            result: validateAndEnrichResult(parsedResult, {
                filesReviewed: filesCount,
                provider: provider.name,
                model: llmResponse.model,
                tokensUsed: llmResponse.usage?.totalTokens,
                durationMs: Date.now() - startTime,
            }),
        };
    });

    // 等待所有结果
    const results = await Promise.all(reviewPromises);

    // 构建 provider 结果映射
    const providerResults: Record<string, ReviewResult> = {};
    for (const { providerType, result } of results) {
        providerResults[providerType] = result;
    }

    // 合并结果
    const combinedResult = combineReviewResults(results.map(r => r.result), filesCount, startTime);

    // 生成合并报告
    const report = generateCombinedMarkdownReport(combinedResult, providerResults);

    let outputPath: string | undefined;
    if (output === "file") {
        const outputDir = output_dir ?? DEFAULT_OUTPUT_DIR;
        outputPath = writeReviewReport(outputDir, report);
    }

    return {
        result: combinedResult,
        report,
        output_path: outputPath,
        configured_providers: getConfiguredProviders(),
        ask_user_feedback: shouldAskUserFeedback(),
        is_concurrent: true,
        provider_results: providerResults,
    };
}

/**
 * 合并多个 provider 的审查结果
 */
function combineReviewResults(
    results: ReviewResult[],
    filesCount: number,
    startTime: number
): ReviewResult {
    // 评分取平均
    const avgScore = Math.round(
        results.reduce((sum, r) => sum + r.overall_score, 0) / results.length
    );

    // 合并 issues（按文件+行号+标题去重）
    const issueMap = new Map<string, ReviewIssue>();
    for (const result of results) {
        for (const issue of result.issues) {
            const key = `${issue.file}:${issue.line_start ?? 0}:${issue.title}`;
            if (!issueMap.has(key)) {
                issueMap.set(key, issue);
            }
        }
    }
    const combinedIssues = Array.from(issueMap.values());

    // 重新计算统计
    const stats = {
        total_issues: combinedIssues.length,
        by_severity: { critical: 0, major: 0, minor: 0, info: 0 },
        by_category: {
            security: 0,
            performance: 0,
            quality: 0,
            maintainability: 0,
            all: 0,
        },
    };
    for (const issue of combinedIssues) {
        if (issue.severity in stats.by_severity) {
            stats.by_severity[issue.severity as keyof typeof stats.by_severity]++;
        }
        if (issue.category in stats.by_category) {
            stats.by_category[issue.category as keyof typeof stats.by_category]++;
        }
    }

    // 按严重程度排序
    const severityOrder = { critical: 0, major: 1, minor: 2, info: 3 };
    combinedIssues.sort((a, b) => {
        return (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    });

    // 合并亮点（去重）
    const highlightSet = new Set<string>();
    for (const result of results) {
        for (const h of result.highlights ?? []) {
            highlightSet.add(h);
        }
    }

    // 合并 summary
    const providerNames = results.map(r => r.meta.provider).join(" + ");
    const summaryParts = results.map(r => `[${r.meta.provider}] ${r.summary}`);

    return {
        overall_score: avgScore,
        summary: `综合 ${providerNames} 审查结果。\n\n${summaryParts.join("\n\n")}`,
        issues: combinedIssues,
        highlights: Array.from(highlightSet),
        stats,
        meta: {
            files_reviewed: filesCount,
            provider: providerNames,
            model: results.map(r => r.meta.model).join(" / "),
            tokens_used: results.reduce((sum, r) => sum + (r.meta.tokens_used ?? 0), 0),
            duration_ms: Date.now() - startTime,
        },
    };
}

/**
 * 生成多 provider 对比的 Markdown 报告
 */
function generateCombinedMarkdownReport(
    combined: ReviewResult,
    providerResults: Record<string, ReviewResult>
): string {
    const parts: string[] = [];

    parts.push("# 代码审查报告（多模型并发）");
    parts.push("");

    // Provider 对比表格
    const providers = Object.keys(providerResults);
    parts.push("## 模型评分对比");
    parts.push("");
    parts.push("| 模型 | 评分 | 问题数 | 耗时 |");
    parts.push("|------|------|--------|------|");
    for (const name of providers) {
        const r = providerResults[name];
        parts.push(
            `| ${r.meta.provider} (${r.meta.model}) | ${r.overall_score}/10 | ${r.stats.total_issues} | ${r.meta.duration_ms}ms |`
        );
    }
    parts.push(`| **综合** | **${combined.overall_score}/10** | **${combined.stats.total_issues}** | ${combined.meta.duration_ms}ms |`);
    parts.push("");

    parts.push(`## 综合评分：${combined.overall_score}/10`);
    parts.push("");
    parts.push(combined.summary);
    parts.push("");

    parts.push("## 统计概览（合并后）");
    parts.push("");
    parts.push(`- 审查文件数：${combined.meta.files_reviewed}`);
    parts.push(`- 发现问题数：${combined.stats.total_issues}（去重后）`);
    parts.push(`- 总耗时：${combined.meta.duration_ms}ms`);
    parts.push(`- Token 使用：${combined.meta.tokens_used}`);
    parts.push("");

    if (combined.stats.by_severity.critical > 0) {
        parts.push(`- [CRITICAL] 严重问题：${combined.stats.by_severity.critical}`);
    }
    if (combined.stats.by_severity.major > 0) {
        parts.push(`- [MAJOR] 重要问题：${combined.stats.by_severity.major}`);
    }
    if (combined.stats.by_severity.minor > 0) {
        parts.push(`- [MINOR] 轻微问题：${combined.stats.by_severity.minor}`);
    }
    if (combined.stats.by_severity.info > 0) {
        parts.push(`- [INFO] 信息提示：${combined.stats.by_severity.info}`);
    }
    parts.push("");

    if (combined.highlights && combined.highlights.length > 0) {
        parts.push("## 代码亮点（综合）");
        parts.push("");
        for (const highlight of combined.highlights) {
            parts.push(`- ${highlight}`);
        }
        parts.push("");
    }

    if (combined.issues.length > 0) {
        parts.push("## 问题详情（合并去重）");
        parts.push("");

        for (const issue of combined.issues) {
            const severityTag = `[${(issue.severity || "unknown").toUpperCase()}]`;
            parts.push(`### ${severityTag} ${issue.title}`);
            parts.push("");
            parts.push(
                `**文件**: \`${issue.file}\`${issue.line_start ? ` (L${issue.line_start}${issue.line_end ? `-${issue.line_end}` : ""})` : ""}`
            );
            parts.push(
                `**类别**: ${issue.category || "unknown"} | **严重程度**: ${issue.severity || "unknown"}`
            );
            parts.push("");
            parts.push(issue.description);

            if (issue.code_snippet) {
                parts.push("");
                parts.push("```");
                parts.push(issue.code_snippet);
                parts.push("```");
            }

            if (issue.suggestion) {
                parts.push("");
                parts.push(`**建议**: ${issue.suggestion}`);
            }
            parts.push("");
        }
    }

    parts.push("---");
    parts.push(
        `*报告由 ProTools Code Review 生成（并发模式） | ${new Date().toISOString()}*`
    );

    return parts.join("\n");
}

/**
 * 验证并补充审查结果
 */
function validateAndEnrichResult(
    parsed: Record<string, unknown>,
    meta: {
        filesReviewed: number;
        provider: string;
        model: string;
        tokensUsed?: number;
        durationMs: number;
    }
): ReviewResult {
    const issues = (parsed.issues as ReviewIssue[]) || [];

    const stats = {
        total_issues: issues.length,
        by_severity: { critical: 0, major: 0, minor: 0, info: 0 },
        by_category: {
            security: 0,
            performance: 0,
            quality: 0,
            maintainability: 0,
            all: 0,
        },
    };

    for (const issue of issues) {
        if (issue.severity in stats.by_severity) {
            stats.by_severity[issue.severity as keyof typeof stats.by_severity]++;
        }
        if (issue.category in stats.by_category) {
            stats.by_category[issue.category as keyof typeof stats.by_category]++;
        }
    }

    const severityOrder = { critical: 0, major: 1, minor: 2, info: 3 };
    const sortedIssues = issues.sort((a, b) => {
        return (
            (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4)
        );
    });

    return {
        overall_score: Number(parsed.overall_score) || 5,
        summary: String(parsed.summary || "审查完成"),
        issues: sortedIssues,
        highlights: (parsed.highlights as string[]) || [],
        stats,
        meta: {
            files_reviewed: meta.filesReviewed,
            provider: meta.provider,
            model: meta.model,
            tokens_used: meta.tokensUsed,
            duration_ms: meta.durationMs,
        },
    };
}

/**
 * 生成 Markdown 格式的审查报告
 */
function generateMarkdownReport(result: ReviewResult): string {
    const parts: string[] = [];

    parts.push("# 代码审查报告");
    parts.push("");

    parts.push(`## 总体评分：${result.overall_score}/10`);
    parts.push("");
    parts.push(result.summary);
    parts.push("");

    parts.push("## 统计概览");
    parts.push("");
    parts.push(`- 审查文件数：${result.meta.files_reviewed}`);
    parts.push(`- 发现问题数：${result.stats.total_issues}`);
    parts.push(`- 耗时：${result.meta.duration_ms}ms`);
    parts.push(`- Provider：${result.meta.provider} (${result.meta.model})`);
    if (result.meta.tokens_used) {
        parts.push(`- Token 使用：${result.meta.tokens_used}`);
    }
    parts.push("");

    if (result.stats.by_severity.critical > 0) {
        parts.push(`- [CRITICAL] 严重问题：${result.stats.by_severity.critical}`);
    }
    if (result.stats.by_severity.major > 0) {
        parts.push(`- [MAJOR] 重要问题：${result.stats.by_severity.major}`);
    }
    if (result.stats.by_severity.minor > 0) {
        parts.push(`- [MINOR] 轻微问题：${result.stats.by_severity.minor}`);
    }
    if (result.stats.by_severity.info > 0) {
        parts.push(`- [INFO] 信息提示：${result.stats.by_severity.info}`);
    }
    parts.push("");

    if (result.highlights && result.highlights.length > 0) {
        parts.push("## 代码亮点");
        parts.push("");
        for (const highlight of result.highlights) {
            parts.push(`- ${highlight}`);
        }
        parts.push("");
    }

    if (result.issues.length > 0) {
        parts.push("## 问题详情");
        parts.push("");

        for (const issue of result.issues) {
            const severityTag = `[${(issue.severity || "unknown").toUpperCase()}]`;
            parts.push(`### ${severityTag} ${issue.title}`);
            parts.push("");
            parts.push(
                `**文件**: \`${issue.file}\`${issue.line_start ? ` (L${issue.line_start}${issue.line_end ? `-${issue.line_end}` : ""})` : ""}`
            );
            parts.push(
                `**类别**: ${issue.category || "unknown"} | **严重程度**: ${issue.severity || "unknown"}`
            );
            parts.push("");
            parts.push(issue.description);

            if (issue.code_snippet) {
                parts.push("");
                parts.push("```");
                parts.push(issue.code_snippet);
                parts.push("```");
            }

            if (issue.suggestion) {
                parts.push("");
                parts.push(`**建议**: ${issue.suggestion}`);
            }
            parts.push("");
        }
    }

    parts.push("---");
    parts.push(
        `*报告由 ProTools Code Review 生成 | ${new Date().toISOString()}*`
    );

    return parts.join("\n");
}

/**
 * 将审查报告写入文件
 */
function writeReviewReport(outputDir: string, report: string): string {
    fs.mkdirSync(outputDir, { recursive: true });

    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
    const fileName = `review_${timestamp}.md`;
    const outputPath = path.join(outputDir, fileName);

    fs.writeFileSync(outputPath, report, "utf-8");

    return outputPath;
}
