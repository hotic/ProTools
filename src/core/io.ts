import { glob } from "glob";
import * as fs from "node:fs";
import * as path from "node:path";
import type { GroupedFiles } from "../types/merge.js";

/**
 * 收集所有输入的文件
 * @param inputs 输入路径列表（文件/目录/glob）
 * @param extensions 扩展名白名单
 * @param excludes 排除的 glob 模式
 * @param groupByInput 是否按输入路径分组
 * @returns 分组后的文件映射或扁平文件列表
 */
export async function collectFiles(
    inputs: string[],
    extensions?: string[],
    excludes?: string[],
    groupByInput = false
): Promise<GroupedFiles | string[]> {
    const filesByInput: GroupedFiles = {};
    const allFiles = new Set<string>();

    // 标准化扩展名（确保带点号）
    const extSet = extensions
        ? new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
        : null;

    for (const input of inputs) {
        const inputPath = path.resolve(input);
        const inputFiles = new Set<string>();

        // 判断输入类型并收集文件
        if (fs.existsSync(inputPath)) {
            const stat = fs.statSync(inputPath);

            if (stat.isFile()) {
                // 直接文件
                inputFiles.add(inputPath);
            } else if (stat.isDirectory()) {
                // 递归目录
                const files = await glob("**/*", {
                    cwd: inputPath,
                    nodir: true,
                    absolute: true,
                    ignore: excludes,
                });
                files.forEach((f) => inputFiles.add(f));
            }
        } else {
            // 尝试作为 glob 模式
            const matched = await glob(input, {
                nodir: true,
                absolute: true,
                ignore: excludes,
            });
            matched.forEach((f) => inputFiles.add(f));
        }

        // 应用扩展名过滤
        const filteredFiles = [...inputFiles].filter((f) => {
            if (!extSet) return true;
            return extSet.has(path.extname(f).toLowerCase());
        });

        // 存储结果
        if (filteredFiles.length > 0) {
            filesByInput[inputPath] = filteredFiles.sort();
            filteredFiles.forEach((f) => allFiles.add(f));
        }
    }

    if (groupByInput) {
        return filesByInput;
    }
    return [...allFiles].sort();
}

/**
 * 读取文件内容
 * @param filePath 文件路径
 * @returns 文件内容，读取失败返回 null
 */
export function readFileContent(filePath: string): string | null {
    try {
        return fs.readFileSync(filePath, "utf-8");
    } catch {
        return null;
    }
}

/**
 * 将内容写入文件
 * @param outputDir 输出目录
 * @param content 文件内容
 * @returns 输出文件的完整路径
 */
export function writeOutputFile(outputDir: string, content: string): string {
    // 确保输出目录存在
    fs.mkdirSync(outputDir, { recursive: true });

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const fileName = `merged_${timestamp}.md`;
    const outputPath = path.join(outputDir, fileName);

    // 写入文件
    fs.writeFileSync(outputPath, content, "utf-8");

    return outputPath;
}

/**
 * 计算相对路径
 * @param filePath 文件绝对路径
 * @param basePath 基准路径
 * @returns 相对路径
 */
export function getRelativePath(filePath: string, basePath: string): string {
    try {
        return path.relative(basePath, filePath);
    } catch {
        return filePath;
    }
}
