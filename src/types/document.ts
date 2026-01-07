/**
 * 文档生成相关类型定义
 */

import { z } from "zod";
import { ProviderSchema } from "./review.js";

// 文档类型
export const DocumentTypeSchema = z.enum([
    "spec", // 技术规范（配置格式、字段定义、约束规则）
    "decision", // 设计决策（为什么这么做、权衡考量）
    "changelog", // 变更日志（适合版本发布）
    "auto", // 自动推断最合适的类型
]);

export type DocumentType = z.infer<typeof DocumentTypeSchema>;

// 输出格式
export const DocumentFormatSchema = z.enum([
    "markdown", // 标准 Markdown
    "feishu", // 飞书优化格式（避免 HTML、标题不超 3 级）
]);

export type DocumentFormat = z.infer<typeof DocumentFormatSchema>;

// 输出语言
export const DocumentLanguageSchema = z.enum(["zh", "en"]);

export type DocumentLanguage = z.infer<typeof DocumentLanguageSchema>;

// 工具输入参数 Schema
export const DocumentSuggestInputSchema = z.object({
    /** 工作目录（多仓库工作区时指定项目路径） */
    cwd: z
        .string()
        .optional()
        .describe("工作目录，多仓库工作区时指定项目路径"),

    /** 要分析的文件/目录/glob 路径列表（与 git_mode 二选一） */
    inputs: z
        .array(z.string())
        .optional()
        .describe("要分析的文件/目录/glob 路径列表（与 git_mode 二选一）"),

    /** Git diff 模式：分析未提交的更改 */
    git_mode: z
        .enum(["staged", "unstaged", "all"])
        .optional()
        .describe("Git diff 模式：staged=已暂存 | unstaged=未暂存 | all=全部未提交"),

    /** 文档类型 */
    doc_type: DocumentTypeSchema.default("auto").describe(
        "文档类型：spec=技术规范 | decision=设计决策 | changelog=变更日志 | auto=自动推断"
    ),

    /** 附加上下文说明 */
    context: z
        .string()
        .optional()
        .describe("附加的上下文说明，帮助 LLM 理解变更背景"),

    /** 输出格式 */
    format: DocumentFormatSchema.default("feishu").describe(
        "输出格式：markdown=标准 Markdown | feishu=飞书优化格式"
    ),

    /** 输出语言 */
    language: DocumentLanguageSchema.default("zh").describe("输出语言：zh=中文 | en=英文"),

    /** LLM Provider */
    provider: ProviderSchema.optional().describe(
        "LLM Provider，默认 gemini（格式化更好）"
    ),

    /** 扩展名过滤 */
    extensions: z
        .array(z.string())
        .optional()
        .describe('过滤扩展名，如 [".yml", ".yaml"]'),

    /** 排除规则 */
    excludes: z
        .array(z.string())
        .optional()
        .describe('排除的 glob 模式'),
});

export type DocumentSuggestInput = z.infer<typeof DocumentSuggestInputSchema>;

// 提取的决策信息
export const ExtractedDecisionSchema = z.object({
    /** 决策内容 */
    decision: z.string(),
    /** 决策理由 */
    rationale: z.string(),
    /** 考虑过的替代方案（可选） */
    alternatives: z.array(z.string()).optional(),
});

export type ExtractedDecision = z.infer<typeof ExtractedDecisionSchema>;

// 提取的关键信息
export const ExtractedInfoSchema = z.object({
    /** 术语定义 */
    definitions: z.record(z.string()).optional(),
    /** 规则/约束 */
    rules: z.array(z.string()).optional(),
    /** 示例代码/配置 */
    examples: z.array(z.string()).optional(),
    /** 设计决策 */
    decisions: z.array(ExtractedDecisionSchema).optional(),
});

export type ExtractedInfo = z.infer<typeof ExtractedInfoSchema>;

// 元信息
export const DocumentMetaSchema = z.object({
    provider: z.string(),
    model: z.string(),
    tokens: z.object({
        input: z.number(),
        output: z.number(),
    }),
    duration_ms: z.number(),
});

export type DocumentMeta = z.infer<typeof DocumentMetaSchema>;

// 文档生成结果
export const DocumentSuggestResultSchema = z.object({
    /** 实际使用的文档类型（auto 会被推断为具体类型） */
    doc_type: DocumentTypeSchema.exclude(["auto"]),
    /** 文档标题 */
    title: z.string(),
    /** 简要摘要 */
    summary: z.string(),
    /** 主体 Markdown 内容 */
    content: z.string(),
    /** 提取的关键信息 */
    extracted: ExtractedInfoSchema,
    /** 元信息 */
    meta: DocumentMetaSchema,
});

export type DocumentSuggestResult = z.infer<typeof DocumentSuggestResultSchema>;

// 工具输出类型
export interface DocumentSuggestOutput {
    /** 结构化结果 */
    result: DocumentSuggestResult;
    /** 格式化的完整文档（可直接复制） */
    document: string;
}
