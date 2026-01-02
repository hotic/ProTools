/**
 * Markdown 报告生成器
 */

import type { ReviewResult } from "../../types/review.js";

/**
 * 生成单 Provider 的 Markdown 审查报告
 */
export function generateMarkdownReport(result: ReviewResult): string {
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

    // 按严重程度显示统计
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

    // 代码亮点
    if (result.highlights && result.highlights.length > 0) {
        parts.push("## 代码亮点");
        parts.push("");
        for (const highlight of result.highlights) {
            parts.push(`- ${highlight}`);
        }
        parts.push("");
    }

    // 问题详情
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
 * 生成多 Provider 对比的 Markdown 报告
 */
export function generateCombinedMarkdownReport(
    combined: ReviewResult,
    providerResults: Record<string, ReviewResult>,
    providerErrors?: Record<string, string>
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
    // 显示失败的 provider
    if (providerErrors && Object.keys(providerErrors).length > 0) {
        for (const [name] of Object.entries(providerErrors)) {
            parts.push(`| ${name} | ❌ 失败 | - | - |`);
        }
    }
    parts.push(`| **综合** | **${combined.overall_score}/10** | **${combined.stats.total_issues}** | ${combined.meta.duration_ms}ms |`);
    parts.push("");

    // 显示失败的 provider 详情
    if (providerErrors && Object.keys(providerErrors).length > 0) {
        parts.push("## ⚠️ 部分模型审查失败");
        parts.push("");
        for (const [name, error] of Object.entries(providerErrors)) {
            parts.push(`- **${name}**: ${error}`);
        }
        parts.push("");
    }

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
