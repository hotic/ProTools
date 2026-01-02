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
    CodeReviewStartInput,
    CodeReviewStatusInput,
    CodeReviewTaskStatusOutput,
    ReviewResult,
} from "../types/review.js";
import type { LLMProviderType, ChatMessage } from "../core/llm/types.js";
import type { GroupedFiles, MergeMode } from "../types/merge.js";

// 导入拆分的模块
import {
    generateMarkdownReport,
    generateCombinedMarkdownReport,
    validateAndEnrichResult,
    combineReviewResults,
    type ReviewTask,
    generateTaskId,
    createSnapshotId,
    getTask,
    saveTask,
    cleanupReviewTasks,
    normalizeProviders,
    updateTaskStatus,
    buildTaskStatusOutput,
} from "./review/index.js";

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

interface PreparedReviewRequest {
    messages: ChatMessage[];
    filesCount: number;
    startTime: number;
    output: "inline" | "file";
    output_dir?: string;
    snapshot_id: string;
}

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
 */
export function shouldConcurrentReview(): boolean {
    const env = process.env.CONCURRENT_REVIEW;
    return env === "true" || env === "1";
}

function resolveReviewProviders(input: CodeReviewStartInput): LLMProviderType[] {
    if (input.provider) {
        return [input.provider as LLMProviderType];
    }
    if (input.providers?.length) {
        return normalizeProviders(input.providers as LLMProviderType[]);
    }
    return normalizeProviders(getConfiguredProviders());
}

async function prepareReviewRequest(
    input: CodeReviewInput
): Promise<PreparedReviewRequest> {
    const startTime = Date.now();

    const {
        cwd,
        inputs,
        git_mode,
        // 修复：不设默认值，由 Zod Schema 的 default(true) 来处理
        include_full_files,
        include_project_context = true,
        focus = "all",
        extensions,
        excludes,
        mode = "compact",
        context,
        output = "inline",
        output_dir,
    } = input;

    // 智能默认：当未指定 inputs 和 git_mode 时，自动使用 git 变更模式
    let effectiveGitMode = git_mode;
    if (!inputs?.length && !git_mode) {
        // 检查是否有未提交的变更
        const { hasUncommittedChanges } = await import("../core/git.js");
        if (hasUncommittedChanges(cwd)) {
            effectiveGitMode = "all";
        } else {
            throw new Error(
                "未指定审查目标。请指定 inputs（文件路径）或 git_mode（git diff 模式），" +
                "或者确保有未提交的 git 变更"
            );
        }
    }

    // 收集项目上下文（如果启用）
    let projectContextStr = "";
    if (include_project_context) {
        const projectCtx = collectProjectContext(cwd);
        projectContextStr = formatProjectContext(projectCtx);
    }

    let codeContent: string;
    let filesCount: number;

    // 根据模式获取代码内容
    if (effectiveGitMode) {
        // Git diff 模式（增强版，可选包含完整文件）
        // include_full_files 默认由 Schema 设为 true
        const gitResult = getEnhancedGitDiff(effectiveGitMode as GitMode, {
            cwd,
            includeFullFiles: include_full_files ?? true,
            mergeMode: mode as MergeMode,
        });

        if (!gitResult.content || gitResult.files.length === 0) {
            throw new Error(
                `没有${effectiveGitMode === "staged" ? "已暂存" : effectiveGitMode === "unstaged" ? "未暂存" : "未提交"}的更改`
            );
        }

        filesCount = gitResult.files.length;

        // 构建代码内容
        const parts: string[] = [];

        // 添加 Git diff 信息
        parts.push(`[Git Diff 模式: ${effectiveGitMode}]`);
        parts.push(`变更文件: ${gitResult.files.join(", ")}`);
        parts.push(`统计: +${gitResult.stats.additions} -${gitResult.stats.deletions}`);
        parts.push("");

        // 如果包含完整文件内容，先显示完整文件，再显示 diff
        if ((include_full_files ?? true) && gitResult.fullFilesContent) {
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

    return {
        messages,
        filesCount,
        startTime,
        output,
        output_dir,
        snapshot_id: createSnapshotId(finalContent),
    };
}

async function runProviderReview(
    providerType: LLMProviderType | undefined,
    messages: ChatMessage[],
    filesCount: number,
    startTime: number
): Promise<ReviewResult> {
    const provider = getLLMProvider(providerType);
    const llmResponse = await provider.chat(messages, {
        maxTokens: 65536, // GPT-5.2 支持更大的输出上限
        temperature: 0.3,
        thinking: true,
    });

    const parsedResult = parseReviewResponse(llmResponse.content);
    return validateAndEnrichResult(parsedResult, {
        filesReviewed: filesCount,
        provider: provider.name,
        model: llmResponse.model,
        tokensUsed: llmResponse.usage?.totalTokens,
        durationMs: Date.now() - startTime,
    });
}

function finalizeReviewTask(task: ReviewTask): void {
    if (task.combinedResult) {
        return;
    }

    if (task.providers.length === 1) {
        const singleResult = task.results[task.providers[0]];
        if (!singleResult) {
            return;
        }
        task.combinedResult = singleResult;
        task.report = generateMarkdownReport(singleResult);
    } else {
        const results = Object.values(task.results);
        if (results.length === 0) {
            return;
        }
        const combinedResult = combineReviewResults(
            results,
            task.filesCount,
            task.startTime
        );
        task.combinedResult = combinedResult;
        task.report = generateCombinedMarkdownReport(
            combinedResult,
            task.results
        );
    }

    if (task.output === "file" && task.report) {
        const outputDir = task.outputDir ?? DEFAULT_OUTPUT_DIR;
        // 异步写入，不阻塞任务状态更新
        writeReviewReport(outputDir, task.report)
            .then((outputPath) => {
                task.outputPath = outputPath;
            })
            .catch((error) => {
                console.error("[ProTools] 写入报告失败:", error);
            });
    }
}

/**
 * 执行代码审查
 */
export async function executeCodeReview(
    input: CodeReviewInput
): Promise<CodeReviewOutput> {
    const providerType = input.provider as LLMProviderType | undefined;
    const prepared = await prepareReviewRequest(input);
    const { messages, filesCount, startTime, output, output_dir } = prepared;

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
    const result = await runProviderReview(
        providerType,
        messages,
        filesCount,
        startTime
    );

    const report = generateMarkdownReport(result);

    let outputPath: string | undefined;
    if (output === "file") {
        const outputDir = output_dir ?? DEFAULT_OUTPUT_DIR;
        outputPath = await writeReviewReport(outputDir, report);
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
 * 使用 Promise.allSettled 确保部分失败不影响其他结果
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
        const result = await runProviderReview(
            providerType,
            messages,
            filesCount,
            startTime
        );
        return { providerType, result };
    });

    // 使用 allSettled 确保部分失败不影响整体
    const settledResults = await Promise.allSettled(reviewPromises);

    // 分离成功和失败的结果
    const providerResults: Record<string, ReviewResult> = {};
    const providerErrors: Record<string, string> = {};
    const successfulResults: ReviewResult[] = [];

    for (let i = 0; i < settledResults.length; i++) {
        const settled = settledResults[i];
        const providerType = providers[i];

        if (settled.status === "fulfilled") {
            providerResults[providerType] = settled.value.result;
            successfulResults.push(settled.value.result);
        } else {
            providerErrors[providerType] = settled.reason?.message ?? String(settled.reason);
        }
    }

    // 如果所有 provider 都失败了，抛出错误
    if (successfulResults.length === 0) {
        const errorMsg = Object.entries(providerErrors)
            .map(([p, e]) => `${p}: ${e}`)
            .join("; ");
        throw new Error(`所有 Provider 审查失败: ${errorMsg}`);
    }

    // 合并成功的结果
    const combinedResult = combineReviewResults(successfulResults, filesCount, startTime);

    // 生成合并报告（包含失败信息）
    const report = generateCombinedMarkdownReport(combinedResult, providerResults, providerErrors);

    let outputPath: string | undefined;
    if (output === "file") {
        const outputDir = output_dir ?? DEFAULT_OUTPUT_DIR;
        outputPath = await writeReviewReport(outputDir, report);
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
 * 启动异步代码审查任务
 */
export async function startCodeReviewTask(
    input: CodeReviewStartInput
): Promise<CodeReviewTaskStatusOutput> {
    cleanupReviewTasks();

    const prepared = await prepareReviewRequest(input);
    const providers = resolveReviewProviders(input);

    if (providers.length === 0) {
        throw new Error("未配置可用的 Provider");
    }

    const now = Date.now();
    const taskId = generateTaskId();
    const task: ReviewTask = {
        id: taskId,
        status: "pending",
        providers,
        startTime: prepared.startTime,
        filesCount: prepared.filesCount,
        snapshotId: prepared.snapshot_id,
        output: prepared.output,
        outputDir: prepared.output_dir,
        askUserFeedback: shouldAskUserFeedback(),
        createdAt: now,
        updatedAt: now,
        results: {} as Record<LLMProviderType, ReviewResult>,
        errors: {} as Record<LLMProviderType, string>,
    };

    saveTask(task);

    const runPromises = providers.map((providerType) =>
        runProviderReview(
            providerType,
            prepared.messages,
            prepared.filesCount,
            prepared.startTime
        )
            .then((result) => {
                task.results[providerType] = result;
                updateTaskStatus(task);
                // 检查是否需要 finalize
                const finishedCount = Object.keys(task.results).length + Object.keys(task.errors).length;
                if (finishedCount === task.providers.length && Object.keys(task.results).length > 0) {
                    finalizeReviewTask(task);
                }
            })
            .catch((error) => {
                task.errors[providerType] =
                    error instanceof Error ? error.message : String(error);
                updateTaskStatus(task);
                // 也需要检查是否需要 finalize（当最后一个 provider 失败时）
                const finishedCount = Object.keys(task.results).length + Object.keys(task.errors).length;
                if (finishedCount === task.providers.length && Object.keys(task.results).length > 0) {
                    finalizeReviewTask(task);
                }
            })
    );

    const waitFirstResultMs = input.wait_first_result_ms ?? 0;
    if (waitFirstResultMs > 0 && runPromises.length > 0) {
        await Promise.race([
            Promise.race(runPromises).then(() => undefined),
            new Promise<void>((resolve) =>
                setTimeout(resolve, waitFirstResultMs)
            ),
        ]);
    }

    return buildTaskStatusOutput(task);
}

/**
 * 查询异步代码审查任务状态
 */
export function getCodeReviewTaskStatus(
    input: CodeReviewStatusInput
): CodeReviewTaskStatusOutput {
    cleanupReviewTasks();

    const task = getTask(input.task_id);
    if (!task) {
        throw new Error("任务不存在或已过期");
    }

    return buildTaskStatusOutput(task);
}

/**
 * 验证输出目录是否安全
 * 防止路径遍历攻击（使用 path.relative 避免 startsWith 前缀绕过）
 */
function validateOutputDir(outputDir: string): string {
    // 规范化并解析路径
    const normalized = path.normalize(outputDir);
    const resolved = path.resolve(normalized);

    // 获取允许的根目录
    const allowedRoot = path.resolve(DEFAULT_OUTPUT_DIR, "..");

    // 使用 path.relative 校验目录包含关系（避免 startsWith 前缀绕过）
    const relative = path.relative(allowedRoot, resolved);

    // 如果相对路径以 .. 开头或是绝对路径，说明不在允许范围内
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(
            `输出目录必须在项目范围内: ${allowedRoot}，当前: ${resolved}`
        );
    }

    return resolved;
}

/**
 * 将审查报告写入文件（异步版本，避免阻塞事件循环）
 */
async function writeReviewReport(outputDir: string, report: string): Promise<string> {
    // 安全校验
    const safeOutputDir = validateOutputDir(outputDir);

    await fs.promises.mkdir(safeOutputDir, { recursive: true });

    const timestamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .slice(0, 19);
    const fileName = `review_${timestamp}.md`;
    const outputPath = path.join(safeOutputDir, fileName);

    await fs.promises.writeFile(outputPath, report, "utf-8");

    return outputPath;
}
