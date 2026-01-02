/**
 * 代码审查任务存储和状态管理
 */

import * as crypto from "node:crypto";
import type { LLMProviderType } from "../../core/llm/types.js";
import type {
    ReviewTaskStatus,
    ReviewResult,
    CodeReviewTaskStatusOutput,
    CodeReviewTaskSummary,
} from "../../types/review.js";
import { generateMarkdownReport } from "./report-generator.js";

// 任务配置常量
export const REVIEW_TASK_TTL_MS = 1000 * 60 * 30; // 30 分钟过期
export const REVIEW_TASK_POLL_AFTER_MS = 2000; // 轮询间隔
export const REVIEW_TASK_MAX_COUNT = 100; // 最大任务数
export const REVIEW_TASK_CLEANUP_INTERVAL_MS = 1000 * 60 * 5; // 5 分钟清理一次

/** 审查任务结构 */
export interface ReviewTask {
    id: string;
    status: ReviewTaskStatus;
    providers: LLMProviderType[];
    startTime: number;
    filesCount: number;
    snapshotId: string;
    output: "inline" | "file";
    outputDir?: string;
    askUserFeedback: boolean;
    createdAt: number;
    updatedAt: number;
    results: Record<LLMProviderType, ReviewResult>;
    errors: Record<LLMProviderType, string>;
    combinedResult?: ReviewResult;
    report?: string;
    outputPath?: string;
}

/** 任务存储 */
const reviewTaskStore: Map<string, ReviewTask> = new Map();

/** 生成任务 ID */
export function generateTaskId(): string {
    return crypto.randomUUID();
}

/** 生成内容快照 ID */
export function createSnapshotId(content: string): string {
    return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** 获取任务 */
export function getTask(taskId: string): ReviewTask | undefined {
    return reviewTaskStore.get(taskId);
}

/** 保存任务 */
export function saveTask(task: ReviewTask): void {
    reviewTaskStore.set(task.id, task);
}

/** 删除任务 */
export function deleteTask(taskId: string): boolean {
    return reviewTaskStore.delete(taskId);
}

/**
 * 清理过期任务并执行 LRU 淘汰
 */
export function cleanupReviewTasks(): void {
    const now = Date.now();

    // 1. 清理过期任务
    for (const [taskId, task] of reviewTaskStore.entries()) {
        if (now - task.updatedAt > REVIEW_TASK_TTL_MS) {
            reviewTaskStore.delete(taskId);
        }
    }

    // 2. 如果超过上限，按 updatedAt 排序淘汰最旧的
    if (reviewTaskStore.size > REVIEW_TASK_MAX_COUNT) {
        const tasks = Array.from(reviewTaskStore.entries())
            .sort((a, b) => a[1].updatedAt - b[1].updatedAt);

        const toRemove = tasks.slice(0, reviewTaskStore.size - REVIEW_TASK_MAX_COUNT);
        for (const [taskId] of toRemove) {
            reviewTaskStore.delete(taskId);
        }
    }
}

// 启动定时清理器（unref 确保不阻止进程退出）
setInterval(cleanupReviewTasks, REVIEW_TASK_CLEANUP_INTERVAL_MS).unref();

/** 去重 Provider 列表 */
export function normalizeProviders(providers: LLMProviderType[]): LLMProviderType[] {
    const seen = new Set<LLMProviderType>();
    const normalized: LLMProviderType[] = [];
    for (const provider of providers) {
        if (!seen.has(provider)) {
            seen.add(provider);
            normalized.push(provider);
        }
    }
    return normalized;
}

/** 更新任务状态 */
export function updateTaskStatus(task: ReviewTask): void {
    const readyProviders = Object.keys(task.results);
    const failedProviders = Object.keys(task.errors);
    const finishedCount = readyProviders.length + failedProviders.length;

    if (finishedCount === 0) {
        task.status = "pending";
    } else if (finishedCount < task.providers.length) {
        task.status = "partial";
    } else if (readyProviders.length === 0) {
        task.status = "failed";
    } else {
        task.status = "completed";
    }

    task.updatedAt = Date.now();
}

/** 构建任务摘要 */
export function buildTaskSummary(result: ReviewResult): CodeReviewTaskSummary {
    return {
        overall_score: result.overall_score,
        files_reviewed: result.meta.files_reviewed,
        total_issues: result.stats.total_issues,
        duration_ms: result.meta.duration_ms,
        provider: result.meta.provider,
    };
}

/** 构建任务状态输出 */
export function buildTaskStatusOutput(task: ReviewTask): CodeReviewTaskStatusOutput {
    const readyProviders = Object.keys(task.results) as LLMProviderType[];
    const failedProviders = Object.keys(task.errors) as LLMProviderType[];
    const pendingProviders = task.providers.filter(
        (provider) =>
            !readyProviders.includes(provider) &&
            !failedProviders.includes(provider)
    );

    // 如果还在等待中，返回精简信息以节省上下文 token
    if (task.status === "pending") {
        return {
            task_id: task.id,
            status: "pending",
            snapshot_id: task.snapshotId,
            providers: task.providers,
            ready_providers: [],
            pending_providers: task.providers,
            ask_user_feedback: task.askUserFeedback, // 修复：使用实际值而非 false
            is_concurrent: task.providers.length > 1,
            created_at: task.createdAt,
            updated_at: task.updatedAt,
            poll_after_ms: REVIEW_TASK_POLL_AFTER_MS,
        };
    }

    const summaryResult =
        task.combinedResult ??
        (readyProviders.length === 1
            ? task.results[readyProviders[0]]
            : undefined);

    const output: CodeReviewTaskStatusOutput = {
        task_id: task.id,
        status: task.status,
        snapshot_id: task.snapshotId,
        providers: task.providers,
        ready_providers: readyProviders,
        pending_providers: pendingProviders,
        failed_providers: failedProviders.length ? failedProviders : undefined,
        provider_errors: failedProviders.length ? task.errors : undefined,
        summary: summaryResult ? buildTaskSummary(summaryResult) : undefined,
        output_path: task.outputPath,
        ask_user_feedback: task.askUserFeedback,
        is_concurrent: task.providers.length > 1,
        created_at: task.createdAt,
        updated_at: task.updatedAt,
        poll_after_ms:
            task.status === "partial"
                ? REVIEW_TASK_POLL_AFTER_MS
                : undefined,
    };

    // 只要有已完成的 provider 就返回其报告（包括 partial 状态）
    if (readyProviders.length > 0) {
        // completed/failed 且有合并结果时，返回合并报告
        if ((task.status === "completed" || task.status === "failed") && task.combinedResult && task.report) {
            output.report = task.report;
            return output;
        }

        // 单个 provider 完成时直接返回其报告
        if (readyProviders.length === 1) {
            output.report = generateMarkdownReport(task.results[readyProviders[0]]);
            return output;
        }

        // 多个 provider 完成时返回各自的报告
        if (readyProviders.length > 1) {
            const providerReports: Record<string, string> = {};
            for (const provider of readyProviders) {
                providerReports[provider] = generateMarkdownReport(
                    task.results[provider]
                );
            }
            output.provider_reports = providerReports;
        }
    }

    return output;
}
