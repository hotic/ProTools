#!/usr/bin/env node
/**
 * ProTools MCP Server 入口
 * 提供可扩展的工具盒，封装日常脚本
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MergeFilesInputSchema } from "./types/merge.js";
import { CodeReviewInputSchema } from "./types/review.js";
import { executeMergeFiles } from "./tools/merge-files.js";
import { executeCodeReview } from "./tools/code-review.js";

// 创建 MCP Server 实例
const server = new McpServer({
    name: "protools",
    version: "1.0.0",
});

// 注册工具

// protools_merge_files - 合并多个源代码文件
server.tool(
    "protools_merge_files",
    "合并多个源代码文件，供对话模型作为上下文使用。支持压缩模式（full/compact/skeleton）、扩展名过滤、排除规则、分组输出。",
    MergeFilesInputSchema.shape,
    async (params) => {
        try {
            const result = await executeMergeFiles(params);

            // 构建返回消息
            let message = `✅ 已处理 ${result.files_count} 个文件\n`;
            message += `📊 模式: ${result.mode} | 分组: ${result.grouped ? "是" : "否"}\n`;
            message += `📦 大小: ${(result.total_bytes / 1024).toFixed(1)} KB\n`;

            if (result.output_path) {
                message += `📁 输出文件: ${result.output_path}\n`;
            }

            // 如果有内联内容，返回内容
            if (result.content) {
                return {
                    content: [
                        { type: "text", text: message },
                        { type: "text", text: result.content },
                    ],
                };
            }

            // 否则只返回元信息
            return {
                content: [{ type: "text", text: message }],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `❌ 错误: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// 启动服务器

// protools_code_review - 代码审查
server.tool(
    "protools_code_review",
    "使用 AI 对代码进行审查，支持安全性、性能、质量和可维护性分析。支持 OpenAI GPT-5.2 和 Google Gemini 3 Flash。",
    CodeReviewInputSchema.shape,
    async (params) => {
        try {
            const result = await executeCodeReview(params);

            // 构建返回消息
            let message = `代码审查完成\n`;
            message += `评分: ${result.result.overall_score}/10\n`;
            message += `审查文件: ${result.result.meta.files_reviewed} 个\n`;
            message += `发现问题: ${result.result.stats.total_issues} 个\n`;
            message += `耗时: ${result.result.meta.duration_ms}ms\n`;
            message += `Provider: ${result.result.meta.provider}\n`;
            message += `执行模式: ${result.is_concurrent ? "并发" : "单一"}\n`;

            if (result.output_path) {
                message += `报告文件: ${result.output_path}\n`;
            }

            // 配置信息（告知调用方）
            message += `\n--- 配置信息 ---\n`;
            message += `配置的 Providers: ${result.configured_providers.join(", ")}\n`;
            message += `询问用户反馈: ${result.ask_user_feedback ? "是" : "否"}\n`;

            return {
                content: [
                    { type: "text", text: message },
                    { type: "text", text: result.report },
                ],
            };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `审查失败: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// 启动服务器

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[ProTools] MCP Server 已启动");
}

main().catch((error) => {
    console.error("[ProTools] 启动失败:", error);
    process.exit(1);
});
