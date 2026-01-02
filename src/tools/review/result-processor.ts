/**
 * 审查结果处理器
 * 负责验证、转换和合并审查结果
 */

import type { ReviewResult, ReviewIssue } from "../../types/review.js";
import { ReviewIssueSchema } from "../../types/review.js";

/** 结果元数据 */
export interface ResultMeta {
    filesReviewed: number;
    provider: string;
    model: string;
    tokensUsed?: number;
    durationMs: number;
}

/**
 * 验证并补充审查结果
 * 使用 Zod safeParse 校验每个 issue，过滤无效项
 */
export function validateAndEnrichResult(
    parsed: Record<string, unknown>,
    meta: ResultMeta
): ReviewResult {
    const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
    const validIssues: ReviewIssue[] = [];

    for (const rawIssue of rawIssues) {
        const result = ReviewIssueSchema.safeParse(rawIssue);
        if (result.success) {
            validIssues.push(result.data);
        } else {
            // 尝试修复常见问题：未知 severity/category 归为默认值
            const fixedIssue = {
                ...rawIssue,
                severity: ["critical", "major", "minor", "info"].includes(rawIssue?.severity)
                    ? rawIssue.severity
                    : "info",
                // category 不包含 "all"
                category: ["security", "performance", "quality", "maintainability"].includes(rawIssue?.category)
                    ? rawIssue.category
                    : "quality",
                file: rawIssue?.file || "unknown",
                title: rawIssue?.title || "未知问题",
                description: rawIssue?.description || "",
            };
            const retryResult = ReviewIssueSchema.safeParse(fixedIssue);
            if (retryResult.success) {
                validIssues.push(retryResult.data);
            }
            // 如果仍然失败，跳过该 issue
        }
    }

    // 计算统计信息
    const stats = calculateStats(validIssues);

    // 按严重程度排序
    const sortedIssues = sortIssuesBySeverity(validIssues);

    // 校验 overall_score 范围
    let overallScore = Number(parsed.overall_score);
    if (isNaN(overallScore) || overallScore < 1 || overallScore > 10) {
        overallScore = 5; // 默认中等分数
    }

    return {
        overall_score: overallScore,
        summary: String(parsed.summary || "审查完成"),
        issues: sortedIssues,
        highlights: Array.isArray(parsed.highlights)
            ? parsed.highlights.filter(h => typeof h === "string")
            : [],
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
 * 合并多个 provider 的审查结果
 */
export function combineReviewResults(
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
    const stats = calculateStats(combinedIssues);

    // 按严重程度排序
    const sortedIssues = sortIssuesBySeverity(combinedIssues);

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
        issues: sortedIssues,
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

/** 计算统计信息（category 不包含 "all"） */
function calculateStats(issues: ReviewIssue[]) {
    const stats = {
        total_issues: issues.length,
        by_severity: { critical: 0, major: 0, minor: 0, info: 0 },
        by_category: {
            security: 0,
            performance: 0,
            quality: 0,
            maintainability: 0,
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

    return stats;
}

/** 按严重程度排序 */
function sortIssuesBySeverity(issues: ReviewIssue[]): ReviewIssue[] {
    const severityOrder = { critical: 0, major: 1, minor: 2, info: 3 };
    return [...issues].sort((a, b) => {
        return (severityOrder[a.severity] ?? 4) - (severityOrder[b.severity] ?? 4);
    });
}
