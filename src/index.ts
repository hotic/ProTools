#!/usr/bin/env node
/**
 * ProTools MCP Server 入口
 * 提供可扩展的工具盒，封装日常脚本
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MergeFilesInputSchema } from "./types/merge.js";
import {
    CodeReviewInputSchema,
    CodeReviewStartInputSchema,
    CodeReviewStatusInputSchema,
} from "./types/review.js";
import { executeMergeFiles } from "./tools/merge-files.js";
import {
    executeCodeReview,
    startCodeReviewTask,
    getCodeReviewTaskStatus,
} from "./tools/code-review.js";
import type { CodeReviewTaskStatusOutput } from "./types/review.js";

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

function formatReviewTaskMessage(
    title: string,
    status: CodeReviewTaskStatusOutput
): string {
    const lines: string[] = [];

    lines.push(title);
    lines.push(`状态: ${status.status}`);
    lines.push(`任务ID: ${status.task_id}`);
    lines.push(`快照: ${status.snapshot_id}`);
    lines.push(`模型: ${status.providers.join(", ")}`);

    if (status.ready_providers.length > 0) {
        lines.push(`已完成: ${status.ready_providers.join(", ")}`);
    }
    if (status.pending_providers.length > 0) {
        lines.push(`待完成: ${status.pending_providers.join(", ")}`);
    }
    if (status.failed_providers && status.failed_providers.length > 0) {
        lines.push(`失败: ${status.failed_providers.join(", ")}`);
    }

    if (status.summary) {
        lines.push(`评分: ${status.summary.overall_score}/10`);
        lines.push(`发现问题: ${status.summary.total_issues} 个`);
        lines.push(`耗时: ${status.summary.duration_ms}ms`);
        lines.push(`Provider: ${status.summary.provider}`);
    }

    lines.push(`询问用户反馈: ${status.ask_user_feedback ? "是" : "否"}`);

    if (status.provider_errors && Object.keys(status.provider_errors).length > 0) {
        const errorList = Object.entries(status.provider_errors)
            .map(([provider, message]) => `${provider}: ${message}`)
            .join(" | ");
        lines.push(`错误: ${errorList}`);
    }

    if (status.output_path) {
        lines.push(`报告文件: ${status.output_path}`);
    }

    if (
        (status.status === "pending" || status.status === "partial") &&
        status.poll_after_ms
    ) {
        lines.push(
            `建议 ${status.poll_after_ms}ms 后使用 protools_code_review_status 查询`
        );
    }

    const quickStatus = {
        task_id: status.task_id,
        status: status.status,
        ready_providers: status.ready_providers,
        pending_providers: status.pending_providers,
        failed_providers: status.failed_providers,
        snapshot_id: status.snapshot_id,
    };

    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(quickStatus, null, 2));
    lines.push("```");

    return lines.join("\n");
}

// protools_code_review_start - 异步代码审查（启动）
server.tool(
    "protools_code_review_start",
    `启动异步代码审查任务，返回任务 ID 并支持查询进度或获取部分结果。

**重要：审查结果需要批判性分析**
- 不是所有报告的问题都需要修复，需根据项目实际情况判断
- 区分真正的问题 vs 过度工程化建议（如"建议添加更多配置"）
- INFO 级别通常可忽略，MINOR 需权衡成本，MAJOR/CRITICAL 才是重点
- 如果多个模型报告相同问题，可信度更高

**高效等待（避免轮询）**
- 设置较大的 wait_first_result_ms（如 60000）一次性等待首个结果
- 或在查询 status 前用 Bash sleep 间隔等待（如 sleep 15）
- 不要疯狂轮询 status，每次调用都消耗 token`,
    CodeReviewStartInputSchema.shape,
    async (params) => {
        try {
            const status = await startCodeReviewTask(params);
            const message = formatReviewTaskMessage("代码审查任务已创建", status);

            const content: Array<{ type: "text"; text: string }> = [
                { type: "text", text: message },
            ];

            if (status.report) {
                content.push({ type: "text", text: status.report });
            } else if (status.provider_reports) {
                for (const [provider, report] of Object.entries(
                    status.provider_reports
                )) {
                    content.push({
                        type: "text",
                        text: `【${provider}】\n\n${report}`,
                    });
                }
            }

            return { content };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `审查启动失败: ${errorMessage}` }],
                isError: true,
            };
        }
    }
);

// protools_code_review_status - 异步代码审查（状态查询）
server.tool(
    "protools_code_review_status",
    `查询异步代码审查任务状态，可获取部分或最终结果。

注意：审查结果需批判性分析，详见 protools_code_review_start 的说明。`,
    CodeReviewStatusInputSchema.shape,
    async (params) => {
        try {
            const status = getCodeReviewTaskStatus(params);
            const message = formatReviewTaskMessage("代码审查任务状态", status);

            const content: Array<{ type: "text"; text: string }> = [
                { type: "text", text: message },
            ];

            if (status.report) {
                content.push({ type: "text", text: status.report });
            } else if (status.provider_reports) {
                for (const [provider, report] of Object.entries(
                    status.provider_reports
                )) {
                    content.push({
                        type: "text",
                        text: `【${provider}】\n\n${report}`,
                    });
                }
            }

            return { content };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text", text: `状态查询失败: ${errorMessage}` }],
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
