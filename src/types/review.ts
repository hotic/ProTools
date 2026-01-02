/**
 * 代码审查相关类型定义
 */

import { z } from "zod";

// 问题类别（用于 Issue，不包含 "all"）
export const IssueCategorySchema = z.enum([
    "security", // 安全漏洞
    "performance", // 性能问题
    "quality", // 代码质量
    "maintainability", // 可维护性
]);

export type IssueCategory = z.infer<typeof IssueCategorySchema>;

// 审查关注领域（用于工具输入，包含 "all"）
export const ReviewFocusSchema = z.enum([
    "security",
    "performance",
    "quality",
    "maintainability",
    "all", // 全面审查
]);

export type ReviewFocus = z.infer<typeof ReviewFocusSchema>;

// 问题严重程度
export const SeveritySchema = z.enum([
    "critical", // 严重：必须修复
    "major", // 重要：强烈建议修复
    "minor", // 轻微：建议改进
    "info", // 信息：供参考
]);

export type Severity = z.infer<typeof SeveritySchema>;

// 单个审查问题
export const ReviewIssueSchema = z.object({
    /** 问题所在文件 */
    file: z.string(),
    /** 起始行号（可选） */
    line_start: z.number().optional(),
    /** 结束行号（可选） */
    line_end: z.number().optional(),
    /** 严重程度 */
    severity: SeveritySchema,
    /** 问题类别（不包含 "all"） */
    category: IssueCategorySchema,
    /** 问题标题 */
    title: z.string(),
    /** 详细描述 */
    description: z.string(),
    /** 修复建议 */
    suggestion: z.string().optional(),
    /** 相关代码片段 */
    code_snippet: z.string().optional(),
});

export type ReviewIssue = z.infer<typeof ReviewIssueSchema>;

// 统计信息
export const ReviewStatsSchema = z.object({
    total_issues: z.number(),
    by_severity: z.record(z.number()),
    by_category: z.record(z.number()),
});

export type ReviewStats = z.infer<typeof ReviewStatsSchema>;

// 元信息
export const ReviewMetaSchema = z.object({
    files_reviewed: z.number(),
    provider: z.string(),
    model: z.string(),
    tokens_used: z.number().optional(),
    duration_ms: z.number(),
});

export type ReviewMeta = z.infer<typeof ReviewMetaSchema>;

// 审查结果输出
export const ReviewResultSchema = z.object({
    /** 总体评分（1-10） */
    overall_score: z.number().min(1).max(10),
    /** 总结 */
    summary: z.string(),
    /** 发现的问题列表 */
    issues: z.array(ReviewIssueSchema),
    /** 优点/亮点 */
    highlights: z.array(z.string()).optional(),
    /** 按类别统计 */
    stats: ReviewStatsSchema,
    /** 元信息 */
    meta: ReviewMetaSchema,
});

export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// Provider 类型
export const ProviderSchema = z.enum(["openai", "gemini"]);
export type Provider = z.infer<typeof ProviderSchema>;

// 工具输入参数 Schema
export const CodeReviewInputSchema = z.object({
    /** 要审查的文件/目录/glob 路径列表（与 git_mode 二选一） */
    inputs: z
        .array(z.string())
        .optional()
        .describe("要审查的文件/目录/glob 路径列表（与 git_mode 二选一）"),

    /** Git diff 模式：审查未提交的更改 */
    git_mode: z
        .enum(["staged", "unstaged", "all"])
        .optional()
        .describe("Git diff 模式：staged=已暂存 | unstaged=未暂存 | all=全部未提交"),

    /** 是否包含变更文件的完整内容（git_mode 时有效） */
    include_full_files: z
        .boolean()
        .default(true)
        .describe("Git diff 模式下，是否同时包含变更文件的完整内容以提供更好的上下文"),

    /** 是否包含项目上下文信息 */
    include_project_context: z
        .boolean()
        .default(true)
        .describe("是否包含项目信息（package.json、目录结构等）以帮助模型理解项目背景"),

    /** 审查关注领域 */
    focus: ReviewFocusSchema.default("all").describe(
        "审查关注领域：security | performance | quality | maintainability | all"
    ),

    /** 扩展名过滤 */
    extensions: z
        .array(z.string())
        .optional()
        .describe('过滤扩展名，如 [".ts", ".js"]'),

    /** 排除规则 */
    excludes: z
        .array(z.string())
        .optional()
        .describe('排除的 glob 模式，如 ["**/test/**", "**/*.test.ts"]'),

    /** 压缩模式 */
    mode: z
        .enum(["full", "compact"])
        .default("compact")
        .describe("代码压缩模式：full=完整代码 | compact=移除注释和import"),

    /** LLM Provider（单个） */
    provider: ProviderSchema.optional().describe(
        "LLM Provider，默认从 LLM_PROVIDER 环境变量读取"
    ),

    /** 附加审查上下文/说明 */
    context: z.string().optional().describe("附加的审查上下文或特殊说明"),

    /** 输出方式 */
    output: z
        .enum(["inline", "file"])
        .default("inline")
        .describe("输出方式：inline=直接返回 | file=写入文件"),

    /** 输出目录 */
    output_dir: z.string().optional().describe("输出目录（output=file 时使用）"),
});

export type CodeReviewInput = z.infer<typeof CodeReviewInputSchema>;

// 异步审查任务输入（启动）
export const CodeReviewStartInputSchema = CodeReviewInputSchema.extend({
    /** 并发审查使用的 provider 列表 */
    providers: z
        .array(ProviderSchema)
        .optional()
        .describe("并发审查使用的 provider 列表，默认使用 LLM_PROVIDER"),

    /** 等待首个结果的超时时间（毫秒） */
    wait_first_result_ms: z
        .number()
        .int()
        .min(0)
        .max(60000)
        .optional()
        .describe("等待首个模型结果的超时时间（毫秒），0 表示立即返回"),
});

export type CodeReviewStartInput = z.infer<typeof CodeReviewStartInputSchema>;

// 异步审查任务输入（查询状态）
export const CodeReviewStatusInputSchema = z.object({
    /** 任务 ID */
    task_id: z.string().describe("由 protools_code_review_start 返回的任务 ID"),
});

export type CodeReviewStatusInput = z.infer<typeof CodeReviewStatusInputSchema>;

// 工具输出类型
export interface CodeReviewOutput {
    /** 结构化审查结果 */
    result: ReviewResult;
    /** 格式化的 Markdown 报告 */
    report: string;
    /** 输出文件路径（如果落盘） */
    output_path?: string;
    /** 环境变量配置的 provider 列表（告知调用方应调用哪些） */
    configured_providers: string[];
    /** 是否需要询问用户反馈 */
    ask_user_feedback: boolean;
    /** 是否为并发模式执行 */
    is_concurrent: boolean;
    /** 各 provider 的独立结果（并发模式时存在） */
    provider_results?: Record<string, ReviewResult>;
}

export type ReviewTaskStatus = "pending" | "partial" | "completed" | "failed";

export interface CodeReviewTaskSummary {
    overall_score: number;
    files_reviewed: number;
    total_issues: number;
    duration_ms: number;
    provider: string;
}

export interface CodeReviewTaskStatusOutput {
    task_id: string;
    status: ReviewTaskStatus;
    snapshot_id: string;
    providers: string[];
    ready_providers: string[];
    pending_providers: string[];
    failed_providers?: string[];
    provider_errors?: Record<string, string>;
    summary?: CodeReviewTaskSummary;
    report?: string;
    provider_reports?: Record<string, string>;
    output_path?: string;
    ask_user_feedback: boolean;
    is_concurrent: boolean;
    created_at: number;
    updated_at: number;
    poll_after_ms?: number;
}
