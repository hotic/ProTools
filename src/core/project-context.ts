/**
 * 项目上下文收集模块
 * 为代码审查提供项目级别的上下文信息
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

/** 项目上下文信息 */
export interface ProjectContext {
    /** 项目名称 */
    name?: string;
    /** 项目描述 */
    description?: string;
    /** 技术栈 */
    techStack: string[];
    /** 主要依赖 */
    dependencies: string[];
    /** 开发依赖 */
    devDependencies: string[];
    /** 目录结构概览 */
    structure: string;
    /** Git 分支 */
    branch?: string;
    /** 项目类型 */
    projectType: string;
}

/**
 * 收集项目上下文信息
 * @param cwd 工作目录，默认为当前目录
 */
export function collectProjectContext(cwd: string = process.cwd()): ProjectContext {
    const context: ProjectContext = {
        techStack: [],
        dependencies: [],
        devDependencies: [],
        structure: "",
        projectType: "unknown",
    };

    // 读取 package.json
    const packageJsonPath = path.join(cwd, "package.json");
    if (fs.existsSync(packageJsonPath)) {
        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
            context.name = packageJson.name;
            context.description = packageJson.description;
            context.projectType = detectProjectType(packageJson);
            context.techStack = detectTechStack(packageJson);
            context.dependencies = Object.keys(packageJson.dependencies ?? {}).slice(0, 20);
            context.devDependencies = Object.keys(packageJson.devDependencies ?? {}).slice(0, 15);
        } catch {
            // 忽略解析错误
        }
    }

    // 获取 Git 分支
    try {
        context.branch = execSync("git branch --show-current", {
            cwd,
            encoding: "utf-8",
            stdio: "pipe",
        }).trim();
    } catch {
        // 忽略 git 错误
    }

    // 生成目录结构
    context.structure = generateDirectoryTree(cwd, 3);

    return context;
}

/**
 * 检测项目类型
 */
function detectProjectType(packageJson: Record<string, unknown>): string {
    const deps = {
        ...(packageJson.dependencies as Record<string, string> ?? {}),
        ...(packageJson.devDependencies as Record<string, string> ?? {}),
    };

    // 框架检测
    if (deps["next"]) return "Next.js";
    if (deps["nuxt"]) return "Nuxt";
    if (deps["@angular/core"]) return "Angular";
    if (deps["vue"]) return "Vue";
    if (deps["react"]) return "React";
    if (deps["express"] || deps["fastify"] || deps["koa"]) return "Node.js Backend";
    if (deps["electron"]) return "Electron";
    if (deps["react-native"]) return "React Native";

    // 工具类型
    if (packageJson.bin) return "CLI Tool";
    if (deps["@modelcontextprotocol/sdk"]) return "MCP Server";

    return "Node.js";
}

/**
 * 检测技术栈
 */
function detectTechStack(packageJson: Record<string, unknown>): string[] {
    const stack: string[] = [];
    const deps = {
        ...(packageJson.dependencies as Record<string, string> ?? {}),
        ...(packageJson.devDependencies as Record<string, string> ?? {}),
    };

    // 语言
    if (deps["typescript"]) stack.push("TypeScript");
    else stack.push("JavaScript");

    // 运行时
    if (deps["bun"]) stack.push("Bun");
    else stack.push("Node.js");

    // 框架
    if (deps["react"]) stack.push("React");
    if (deps["vue"]) stack.push("Vue");
    if (deps["express"]) stack.push("Express");
    if (deps["fastify"]) stack.push("Fastify");
    if (deps["next"]) stack.push("Next.js");

    // 工具
    if (deps["zod"]) stack.push("Zod");
    if (deps["prisma"] || deps["@prisma/client"]) stack.push("Prisma");
    if (deps["drizzle-orm"]) stack.push("Drizzle");
    if (deps["@modelcontextprotocol/sdk"]) stack.push("MCP SDK");

    // 测试
    if (deps["jest"]) stack.push("Jest");
    if (deps["vitest"]) stack.push("Vitest");
    if (deps["mocha"]) stack.push("Mocha");

    return stack;
}

/**
 * 生成目录树结构
 * @param dir 目录路径
 * @param maxDepth 最大深度
 * @param currentDepth 当前深度
 * @param prefix 前缀字符
 */
function generateDirectoryTree(
    dir: string,
    maxDepth: number = 3,
    currentDepth: number = 0,
    prefix: string = ""
): string {
    if (currentDepth >= maxDepth) return "";

    const lines: string[] = [];

    // 忽略的目录和文件
    const ignorePatterns = [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        ".nuxt",
        "coverage",
        ".cache",
        ".DS_Store",
        "*.log",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
    ];

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        // 过滤并排序
        const filtered = entries
            .filter((entry) => {
                const name = entry.name;
                return !ignorePatterns.some((pattern) => {
                    if (pattern.includes("*")) {
                        const regex = new RegExp(pattern.replace("*", ".*"));
                        return regex.test(name);
                    }
                    return name === pattern;
                });
            })
            .sort((a, b) => {
                // 目录优先
                if (a.isDirectory() && !b.isDirectory()) return -1;
                if (!a.isDirectory() && b.isDirectory()) return 1;
                return a.name.localeCompare(b.name);
            });

        // 限制每层显示数量
        const maxItems = 15;
        const items = filtered.slice(0, maxItems);
        const hasMore = filtered.length > maxItems;

        items.forEach((entry, index) => {
            const isLast = index === items.length - 1 && !hasMore;
            const connector = isLast ? "└── " : "├── ";
            const childPrefix = isLast ? "    " : "│   ";

            if (entry.isDirectory()) {
                lines.push(`${prefix}${connector}${entry.name}/`);
                const subTree = generateDirectoryTree(
                    path.join(dir, entry.name),
                    maxDepth,
                    currentDepth + 1,
                    prefix + childPrefix
                );
                if (subTree) lines.push(subTree);
            } else {
                lines.push(`${prefix}${connector}${entry.name}`);
            }
        });

        if (hasMore) {
            lines.push(`${prefix}└── ... (${filtered.length - maxItems} more)`);
        }
    } catch {
        // 忽略读取错误
    }

    return lines.join("\n");
}

/**
 * 格式化项目上下文为字符串
 */
export function formatProjectContext(ctx: ProjectContext): string {
    const parts: string[] = [];

    parts.push("## 项目信息");
    if (ctx.name) parts.push(`- 名称: ${ctx.name}`);
    if (ctx.description) parts.push(`- 描述: ${ctx.description}`);
    parts.push(`- 类型: ${ctx.projectType}`);
    if (ctx.branch) parts.push(`- 分支: ${ctx.branch}`);

    if (ctx.techStack.length > 0) {
        parts.push(`- 技术栈: ${ctx.techStack.join(", ")}`);
    }

    if (ctx.dependencies.length > 0) {
        parts.push(`- 主要依赖: ${ctx.dependencies.slice(0, 10).join(", ")}${ctx.dependencies.length > 10 ? "..." : ""}`);
    }

    parts.push("");
    parts.push("## 目录结构");
    parts.push("```");
    parts.push(ctx.structure || "(无法读取)");
    parts.push("```");

    return parts.join("\n");
}
