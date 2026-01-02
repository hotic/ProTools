/**
 * Git 工具模块
 * 支持获取 git diff 内容用于代码审查
 */

import { execSync, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { processFile } from "./merge.js";
import type { MergeMode } from "../types/merge.js";

/** Git diff 模式 */
export type GitMode = "staged" | "unstaged" | "all";

/** Git diff 结果 */
export interface GitDiffResult {
    /** diff 内容 */
    content: string;
    /** 变更的文件列表 */
    files: string[];
    /** 变更统计 */
    stats: {
        additions: number;
        deletions: number;
        filesChanged: number;
    };
}

/**
 * 检查当前目录是否为 git 仓库
 */
export function isGitRepo(cwd?: string): boolean {
    try {
        execSync("git rev-parse --is-inside-work-tree", {
            cwd,
            stdio: "pipe",
            encoding: "utf-8",
        });
        return true;
    } catch {
        return false;
    }
}

/**
 * 获取 git diff 内容
 * @param mode - diff 模式：staged=已暂存, unstaged=未暂存, all=全部
 * @param cwd - 工作目录
 */
export function getGitDiff(mode: GitMode, cwd?: string): GitDiffResult {
    if (!isGitRepo(cwd)) {
        throw new Error("当前目录不是 git 仓库");
    }

    const execOptions = {
        cwd,
        encoding: "utf-8" as const,
        maxBuffer: 50 * 1024 * 1024, // 50MB
    };

    let diffContent: string;
    let fileList: string[];

    switch (mode) {
        case "staged":
            // 只获取已暂存的更改
            diffContent = execSync("git diff --cached", execOptions).toString();
            fileList = execSync("git diff --cached --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);
            break;

        case "unstaged":
            // 只获取未暂存的更改（不包括 untracked 文件）
            diffContent = execSync("git diff", execOptions).toString();
            fileList = execSync("git diff --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);
            break;

        case "all":
        default:
            // 获取所有未提交的更改（staged + unstaged）
            const stagedDiff = execSync("git diff --cached", execOptions).toString();
            const unstagedDiff = execSync("git diff", execOptions).toString();
            diffContent = stagedDiff + "\n" + unstagedDiff;

            const stagedFiles = execSync("git diff --cached --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);
            const unstagedFiles = execSync("git diff --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);

            // 去重
            fileList = [...new Set([...stagedFiles, ...unstagedFiles])];
            break;
    }

    // 解析统计信息
    const stats = parseGitStats(mode, cwd);

    return {
        content: diffContent.trim(),
        files: fileList,
        stats,
    };
}

/**
 * 获取带完整文件内容的 diff（用于更好的审查上下文）
 */
export function getGitDiffWithContext(mode: GitMode, cwd?: string): GitDiffResult {
    if (!isGitRepo(cwd)) {
        throw new Error("当前目录不是 git 仓库");
    }

    const execOptions = {
        cwd,
        encoding: "utf-8" as const,
        maxBuffer: 50 * 1024 * 1024,
    };

    // 获取变更文件列表
    let fileList: string[];

    switch (mode) {
        case "staged":
            fileList = execSync("git diff --cached --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);
            break;

        case "unstaged":
            fileList = execSync("git diff --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);
            break;

        case "all":
        default:
            const stagedFiles = execSync("git diff --cached --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);
            const unstagedFiles = execSync("git diff --name-only", execOptions)
                .toString()
                .trim()
                .split("\n")
                .filter(Boolean);
            fileList = [...new Set([...stagedFiles, ...unstagedFiles])];
            break;
    }

    // 构建带上下文的 diff
    const parts: string[] = [];

    for (const file of fileList) {
        parts.push(`\n${"=".repeat(60)}`);
        parts.push(`File: ${file}`);
        parts.push("=".repeat(60));

        // 获取该文件的 diff（使用 execFileSync 避免命令注入）
        try {
            let fileDiff: string;
            if (mode === "staged") {
                fileDiff = execFileSync("git", ["diff", "--cached", "--", file], execOptions).toString();
            } else if (mode === "unstaged") {
                fileDiff = execFileSync("git", ["diff", "--", file], execOptions).toString();
            } else {
                // all: 合并 staged 和 unstaged
                const staged = execFileSync("git", ["diff", "--cached", "--", file], execOptions).toString();
                const unstaged = execFileSync("git", ["diff", "--", file], execOptions).toString();
                fileDiff = staged + unstaged;
            }
            parts.push(fileDiff || "(无差异)");
        } catch {
            parts.push("(无法读取 diff)");
        }
    }

    const stats = parseGitStats(mode, cwd);

    return {
        content: parts.join("\n").trim(),
        files: fileList,
        stats,
    };
}

/**
 * 解析 git diff 统计信息
 */
function parseGitStats(mode: GitMode, cwd?: string): GitDiffResult["stats"] {
    const execOptions = {
        cwd,
        encoding: "utf-8" as const,
    };

    /** 从 --stat 输出解析统计数据 */
    function parseStatOutput(output: string): { files: number; additions: number; deletions: number } {
        const lines = output.trim().split("\n");
        const lastLine = lines[lines.length - 1] || "";

        const filesMatch = lastLine.match(/(\d+) files? changed/);
        const insertionsMatch = lastLine.match(/(\d+) insertions?/);
        const deletionsMatch = lastLine.match(/(\d+) deletions?/);

        return {
            files: filesMatch ? parseInt(filesMatch[1], 10) : 0,
            additions: insertionsMatch ? parseInt(insertionsMatch[1], 10) : 0,
            deletions: deletionsMatch ? parseInt(deletionsMatch[1], 10) : 0,
        };
    }

    try {
        switch (mode) {
            case "staged": {
                const output = execSync("git diff --cached --stat", execOptions).toString();
                const stats = parseStatOutput(output);
                return {
                    filesChanged: stats.files,
                    additions: stats.additions,
                    deletions: stats.deletions,
                };
            }
            case "unstaged": {
                const output = execSync("git diff --stat", execOptions).toString();
                const stats = parseStatOutput(output);
                return {
                    filesChanged: stats.files,
                    additions: stats.additions,
                    deletions: stats.deletions,
                };
            }
            case "all":
            default: {
                // 分别解析 staged 和 unstaged，然后相加
                const stagedOutput = execSync("git diff --cached --stat", execOptions).toString();
                const unstagedOutput = execSync("git diff --stat", execOptions).toString();
                const stagedStats = parseStatOutput(stagedOutput);
                const unstagedStats = parseStatOutput(unstagedOutput);

                // 文件数需要去重（同一文件可能同时有 staged 和 unstaged 变更）
                const stagedFiles = execSync("git diff --cached --name-only", execOptions)
                    .toString().trim().split("\n").filter(Boolean);
                const unstagedFiles = execSync("git diff --name-only", execOptions)
                    .toString().trim().split("\n").filter(Boolean);
                const uniqueFiles = new Set([...stagedFiles, ...unstagedFiles]);

                return {
                    filesChanged: uniqueFiles.size,
                    additions: stagedStats.additions + unstagedStats.additions,
                    deletions: stagedStats.deletions + unstagedStats.deletions,
                };
            }
        }
    } catch {
        return { filesChanged: 0, additions: 0, deletions: 0 };
    }
}

/**
 * 获取当前分支名
 */
export function getCurrentBranch(cwd?: string): string {
    try {
        return execSync("git branch --show-current", {
            cwd,
            encoding: "utf-8",
            stdio: "pipe",
        }).toString().trim();
    } catch {
        return "unknown";
    }
}

/**
 * 检查是否有未提交的更改
 */
export function hasUncommittedChanges(cwd?: string): boolean {
    try {
        const status = execSync("git status --porcelain", {
            cwd,
            encoding: "utf-8",
            stdio: "pipe",
        }).toString().trim();
        return status.length > 0;
    } catch {
        return false;
    }
}

/**
 * 获取变更文件的完整内容（当前工作区版本）
 * @param files 文件列表
 * @param cwd 工作目录
 * @param mode 压缩模式（默认 compact）
 */
export function getChangedFilesContent(
    files: string[],
    cwd?: string,
    mode: MergeMode = "compact"
): string {
    const parts: string[] = [];
    const basePath = cwd || process.cwd();
    const resolvedBase = path.resolve(basePath);

    for (const file of files) {
        const fullPath = path.join(basePath, file);
        const resolvedPath = path.resolve(fullPath);

        // 安全检查：确保路径不越界
        if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
            parts.push(`\n${"─".repeat(60)}`);
            parts.push(`📄 ${file}`);
            parts.push("─".repeat(60));
            parts.push("(路径越界，跳过)");
            continue;
        }

        parts.push(`\n${"─".repeat(60)}`);
        parts.push(`📄 ${file}`);
        parts.push("─".repeat(60));

        try {
            if (fs.existsSync(fullPath)) {
                // 使用 merge 模块处理文件（支持 compact/skeleton 压缩）
                const processed = processFile(fullPath, mode, basePath);
                if (processed) {
                    parts.push(processed.content);
                } else {
                    parts.push("(文件为空或无法处理)");
                }
            } else {
                parts.push("(文件已删除)");
            }
        } catch {
            parts.push("(无法读取文件)");
        }
    }

    return parts.join("\n");
}

/** 增强的 Git diff 结果 */
export interface EnhancedGitDiffResult extends GitDiffResult {
    /** 变更文件的完整内容 */
    fullFilesContent?: string;
}

/**
 * 获取增强的 git diff（可选包含完整文件内容）
 * @param mode diff 模式
 * @param options 选项
 */
export function getEnhancedGitDiff(
    mode: GitMode,
    options: {
        cwd?: string;
        includeFullFiles?: boolean;
        mergeMode?: MergeMode;
    } = {}
): EnhancedGitDiffResult {
    const { cwd, includeFullFiles = false, mergeMode = "compact" } = options;

    // 获取基本 diff
    const basicResult = getGitDiffWithContext(mode, cwd);

    // 如果需要完整文件内容
    if (includeFullFiles && basicResult.files.length > 0) {
        return {
            ...basicResult,
            fullFilesContent: getChangedFilesContent(basicResult.files, cwd, mergeMode),
        };
    }

    return basicResult;
}
