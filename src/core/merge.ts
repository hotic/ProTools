import * as path from "node:path";
import type { MergeMode, ProcessedFile, GroupedFiles } from "../types/merge.js";
import { readFileContent, getRelativePath } from "./io.js";

// 语言映射表

const LANG_MAP: Record<string, string> = {
    ".kt": "kotlin",
    ".kts": "kotlin",
    ".java": "java",
    ".py": "python",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".yml": "yaml",
    ".yaml": "yaml",
    ".json": "json",
    ".md": "markdown",
    ".sh": "bash",
    ".rs": "rust",
    ".go": "go",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".css": "css",
    ".scss": "scss",
    ".html": "html",
    ".xml": "xml",
    ".sql": "sql",
    ".lua": "lua",
    ".rb": "ruby",
    ".swift": "swift",
};

/**
 * 根据扩展名获取语言标识
 */
function getLanguage(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    return LANG_MAP[ext] || "";
}

// 内容处理函数

/**
 * full 模式：仅规范化空行
 */
function processFull(content: string): string {
    // 连续空行 → 单空行
    return content.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * compact 模式：移除注释、import、多余空行
 */
function processCompact(content: string, lang: string): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let inMultilineComment = false;

    for (const line of lines) {
        const stripped = line.trim();

        // 跳过空行
        if (!stripped) continue;

        // 处理 C 风格多行注释
        if (["kotlin", "java", "javascript", "typescript", "c", "cpp", "go", "rust"].includes(lang)) {
            if (stripped.includes("/*") && !stripped.includes("*/")) {
                inMultilineComment = true;
                continue;
            }
            if (inMultilineComment) {
                if (stripped.includes("*/")) {
                    inMultilineComment = false;
                }
                continue;
            }
            // 单行 /* ... */
            if (stripped.startsWith("/*") && stripped.endsWith("*/")) continue;
            // 单行注释
            if (stripped.startsWith("//")) continue;
            // import/package
            if (stripped.startsWith("import ") || stripped.startsWith("package ")) continue;
        } else if (lang === "python") {
            // Python # 注释
            if (stripped.startsWith("#")) continue;
            // import/from
            if (stripped.startsWith("import ") || stripped.startsWith("from ")) continue;
        } else if (["yaml", "bash", "ruby"].includes(lang)) {
            // # 注释
            if (stripped.startsWith("#")) continue;
        }

        result.push(line);
    }

    // 移除连续空行
    return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * skeleton 模式：仅保留类/方法签名
 */
function processSkeleton(content: string, lang: string): string {
    const lines = content.split("\n");
    const result: string[] = [];
    let braceDepth = 0;
    let inMethodBody = false;
    let methodStartDepth = 0;

    if (lang === "kotlin" || lang === "java") {
        for (const line of lines) {
            const stripped = line.trim();

            // 跳过空行、注释、import/package
            if (!stripped) continue;
            if (stripped.startsWith("//") || stripped.startsWith("/*") || stripped.startsWith("*")) continue;
            if (stripped.startsWith("import ") || stripped.startsWith("package ")) continue;

            // 计算大括号变化
            const openBraces = (line.match(/{/g) || []).length;
            const closeBraces = (line.match(/}/g) || []).length;

            // 检测类/接口/对象声明
            const isClassLike = ["class ", "interface ", "object ", "enum ", "sealed ", "data class "].some(
                (kw) => stripped.includes(kw)
            );
            // 检测方法/函数声明
            const isMethod =
                stripped.includes("fun ") ||
                (stripped.includes("(") &&
                    stripped.includes(")") &&
                    !stripped.startsWith("if") &&
                    !stripped.startsWith("for") &&
                    !stripped.startsWith("while"));

            if (!inMethodBody) {
                if (isClassLike) {
                    result.push(line);
                } else if (isMethod) {
                    // 提取方法签名
                    if (stripped.includes("{")) {
                        const sig = stripped.split("{")[0].trim();
                        const indent = line.slice(0, line.indexOf(stripped));
                        result.push(`${indent}${sig}`);
                        if (closeBraces <= openBraces) {
                            inMethodBody = true;
                            methodStartDepth = braceDepth + openBraces - closeBraces;
                        }
                    } else {
                        result.push(line);
                    }
                } else if (closeBraces > 0) {
                    // 类/接口的结束大括号
                    if (braceDepth + openBraces - closeBraces <= 1) {
                        result.push(line);
                    }
                }
            } else {
                // 在方法体内，检查是否结束
                const newDepth = braceDepth + openBraces - closeBraces;
                if (newDepth < methodStartDepth) {
                    inMethodBody = false;
                }
            }

            braceDepth += openBraces - closeBraces;
        }
    } else if (lang === "python") {
        for (const line of lines) {
            const stripped = line.trim();

            // 跳过空行、注释、import
            if (!stripped) continue;
            if (stripped.startsWith("#")) continue;
            if (stripped.startsWith("import ") || stripped.startsWith("from ")) continue;
            if (stripped.startsWith('"""') || stripped.startsWith("'''")) continue;

            // 保留类和函数定义
            if (stripped.startsWith("class ") || stripped.startsWith("def ")) {
                result.push(line);
            } else if (stripped.startsWith("@")) {
                // 装饰器
                result.push(line);
            }
        }
    } else if (lang === "typescript" || lang === "javascript") {
        for (const line of lines) {
            const stripped = line.trim();

            if (!stripped) continue;
            if (stripped.startsWith("//") || stripped.startsWith("/*") || stripped.startsWith("*")) continue;
            if (stripped.startsWith("import ") || stripped.startsWith("export ")) {
                if (
                    stripped.includes("class ") ||
                    stripped.includes("interface ") ||
                    stripped.includes("function ")
                ) {
                    result.push(line);
                }
                continue;
            }

            // 保留类、接口、函数声明
            if (
                ["class ", "interface ", "type ", "function ", "const ", "let ", "var "].some((kw) =>
                    stripped.includes(kw)
                )
            ) {
                if (stripped.includes("{")) {
                    const sig = stripped.split("{")[0].trim();
                    const indent = line.slice(0, line.indexOf(stripped));
                    result.push(`${indent}${sig} { ... }`);
                } else {
                    result.push(line);
                }
            }
        }
    } else {
        // 其他语言：返回 compact 模式结果
        return processCompact(content, lang);
    }

    return result.join("\n");
}

// 主要导出函数

/**
 * 处理单个文件
 */
export function processFile(
    filePath: string,
    mode: MergeMode,
    basePath?: string
): ProcessedFile | null {
    const content = readFileContent(filePath);
    if (content === null) return null;

    const lang = getLanguage(filePath);

    // 根据模式处理内容
    let processed: string;
    switch (mode) {
        case "full":
            processed = processFull(content);
            break;
        case "compact":
            processed = processCompact(content, lang);
            break;
        case "skeleton":
            processed = processSkeleton(content, lang);
            break;
        default:
            processed = content;
    }

    if (!processed.trim()) return null;

    // 计算相对路径
    const relativePath = basePath ? getRelativePath(filePath, basePath) : path.basename(filePath);

    return {
        path: filePath,
        relativePath,
        content: processed,
        language: lang,
    };
}

/**
 * 生成合并后的输出内容
 */
export function generateOutput(
    files: GroupedFiles | string[],
    mode: MergeMode,
    groupByInput = false,
    basePath?: string
): string {
    const parts: string[] = [];

    const formatFileBlock = (file: ProcessedFile): string => {
        const langTag = file.language || "";
        return `# File: ${file.relativePath}\n\`\`\`${langTag}\n${file.content}\n\`\`\``;
    };

    if (groupByInput && !Array.isArray(files)) {
        // 按输入目录分组
        for (const [inputPath, fileList] of Object.entries(files)) {
            const inputName = path.basename(inputPath) || inputPath;
            parts.push(`## Directory: ${inputName}\n`);
            parts.push(`*Source: \`${inputPath}\`*\n`);

            const groupParts: string[] = [];
            for (const filePath of fileList) {
                const processed = processFile(filePath, mode, inputPath);
                if (processed) {
                    groupParts.push(formatFileBlock(processed));
                }
            }

            if (groupParts.length > 0) {
                parts.push(...groupParts);
                parts.push(""); // 分组间空行
            }
        }
    } else {
        // 扁平列表模式
        const fileList = Array.isArray(files)
            ? files
            : Object.values(files).flat();

        for (const filePath of fileList) {
            const processed = processFile(filePath, mode, basePath);
            if (processed) {
                parts.push(formatFileBlock(processed));
            }
        }
    }

    return parts.join("\n\n");
}
