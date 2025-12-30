import * as path from "node:path";
import { collectFiles, writeOutputFile } from "../core/io.js";
import { generateOutput } from "../core/merge.js";
import type { MergeFilesInput, MergeFilesOutput, GroupedFiles } from "../types/merge.js";

// 默认输出目录
const DEFAULT_OUTPUT_DIR = path.resolve(import.meta.dirname, "../../output");

// 默认最大内联字节数（100KB）
const DEFAULT_MAX_BYTES = 100 * 1024;

/**
 * 执行 merge_files 工具
 */
export async function executeMergeFiles(input: MergeFilesInput): Promise<MergeFilesOutput> {
    const {
        inputs,
        mode = "compact",
        extensions,
        excludes,
        group = false,
        output = "inline",
        output_dir,
        max_bytes = DEFAULT_MAX_BYTES,
    } = input;

    // 多输入时自动启用分组
    const shouldGroup = group || inputs.length > 1;

    // 收集文件
    const files = await collectFiles(inputs, extensions, excludes, shouldGroup);

    // 计算文件数量
    const filesCount = Array.isArray(files)
        ? files.length
        : Object.values(files).reduce((sum, arr) => sum + arr.length, 0);

    if (filesCount === 0) {
        return {
            files_count: 0,
            total_bytes: 0,
            mode,
            grouped: shouldGroup,
            generated_at: new Date().toISOString(),
        };
    }

    // 生成合并内容
    const content = generateOutput(files as GroupedFiles | string[], mode, shouldGroup);
    const totalBytes = Buffer.byteLength(content, "utf-8");

    // 决定输出方式
    const shouldWriteFile = output === "file" || (output === "inline" && totalBytes > max_bytes);

    const result: MergeFilesOutput = {
        files_count: filesCount,
        total_bytes: totalBytes,
        mode,
        grouped: shouldGroup,
        generated_at: new Date().toISOString(),
    };

    if (shouldWriteFile) {
        // 落盘
        const outputDir = output_dir || DEFAULT_OUTPUT_DIR;
        const outputPath = writeOutputFile(outputDir, content);
        result.output_path = outputPath;
    } else {
        // 内联返回
        result.content = content;
    }

    return result;
}
