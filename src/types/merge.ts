import { z } from "zod";

// 输入类型

/** 压缩模式 */
export type MergeMode = "full" | "compact" | "skeleton";

/** 输出方式 */
export type OutputTarget = "inline" | "file";

/** merge_files 工具的输入参数 Schema */
export const MergeFilesInputSchema = z.object({
    /** 文件/目录/glob 列表 */
    inputs: z.array(z.string()).min(1).describe("文件/目录/glob 路径列表"),

    /** 压缩模式 */
    mode: z
        .enum(["full", "compact", "skeleton"])
        .default("compact")
        .describe("压缩模式：full=保留全部 | compact=移除注释和import | skeleton=仅保留签名"),

    /** 扩展名白名单 */
    extensions: z
        .array(z.string())
        .optional()
        .describe("过滤扩展名，如 [\".kt\", \".java\"]"),

    /** 排除规则 */
    excludes: z
        .array(z.string())
        .optional()
        .describe("排除的 glob 模式列表"),

    /** 是否按输入路径分组 */
    group: z
        .boolean()
        .default(false)
        .describe("按输入路径分组输出"),

    /** 输出方式 */
    output: z
        .enum(["inline", "file"])
        .default("inline")
        .describe("输出方式：inline=直接返回内容 | file=写入文件并返回路径"),

    /** 输出目录（仅 output=file 时生效） */
    output_dir: z
        .string()
        .optional()
        .describe("输出目录，默认 ProTools/output"),

    /** 最大内联字节数 */
    max_bytes: z
        .number()
        .optional()
        .describe("超过此字节数强制落盘（即使 output=inline）"),
});

export type MergeFilesInput = z.infer<typeof MergeFilesInputSchema>;

// 输出类型

/** merge_files 工具的输出结果 */
export interface MergeFilesOutput {
    /** 合并后的文本（仅 inline 模式） */
    content?: string;

    /** 落盘文件路径（仅 file 模式或超出 max_bytes） */
    output_path?: string;

    /** 处理的文件数量 */
    files_count: number;

    /** 输出总字节数 */
    total_bytes: number;

    /** 使用的压缩模式 */
    mode: MergeMode;

    /** 是否分组输出 */
    grouped: boolean;

    /** 生成时间 ISO 8601 */
    generated_at: string;
}

// 内部类型

/** 文件处理结果 */
export interface ProcessedFile {
    /** 原始文件路径 */
    path: string;

    /** 相对路径（用于输出显示） */
    relativePath: string;

    /** 处理后的内容 */
    content: string;

    /** 语言标识 */
    language: string;
}

/** 分组后的文件集合 */
export interface GroupedFiles {
    [inputPath: string]: string[];
}
