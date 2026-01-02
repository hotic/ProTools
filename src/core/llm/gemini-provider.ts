/**
 * Google Gemini 3 Flash Provider
 * 支持可配置的 thinking_level 参数
 */

import { BaseLLMProvider } from "./base-provider.js";
import type {
    ChatMessage,
    LLMRequestConfig,
    LLMResponse,
    LLMProviderType,
} from "./types.js";

// 默认配置
const DEFAULT_MODEL = "gemini-3-flash-preview";
const DEFAULT_MAX_TOKENS = 65536; // Gemini 3 Flash 最大输出
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 3 * 60 * 1000; // 3 分钟（Gemini 相对较快）
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// thinking level 级别
type ThinkingLevel = "NONE" | "LOW" | "MEDIUM" | "HIGH";

/** 获取配置的 thinking level */
function getThinkingLevel(): ThinkingLevel {
    const env = process.env.GEMINI_THINKING_LEVEL?.toUpperCase();
    if (env === "NONE" || env === "LOW" || env === "MEDIUM" || env === "HIGH") {
        return env;
    }
    return "HIGH"; // 默认最高
}

export class GeminiProvider extends BaseLLMProvider {
    readonly name: LLMProviderType = "gemini";
    private apiKey: string | undefined;

    constructor() {
        super();
        this.apiKey = process.env.GEMINI_API_KEY;
    }

    isConfigured(): boolean {
        return Boolean(this.apiKey);
    }

    protected async doChat(
        messages: ChatMessage[],
        config?: LLMRequestConfig
    ): Promise<LLMResponse> {
        const model = config?.model ?? DEFAULT_MODEL;
        const maxTokens = config?.maxTokens ?? DEFAULT_MAX_TOKENS;

        // 转换消息格式为 Gemini API 格式
        const contents = this.convertMessages(messages);

        // 构建请求体 - Gemini 3 格式
        const thinkingLevel = getThinkingLevel();
        const useThinking = config?.thinking !== false && thinkingLevel !== "NONE";

        const generationConfig: Record<string, unknown> = {
            max_output_tokens: maxTokens,
            // 开启推理模式时，官方建议 temperature 为 1.0
            temperature: useThinking ? 1.0 : (config?.temperature ?? 0.7),
            // 强制 JSON 格式输出
            response_mime_type: "application/json",
        };

        // Gemini 3 推理配置（在 generationConfig 内部）
        if (useThinking) {
            generationConfig.thinking_config = {
                include_thoughts: true,
                thinking_level: thinkingLevel,
            };
        }

        const requestBody: Record<string, unknown> = {
            contents,
            generationConfig,
        };

        const endpoint = `${API_BASE}/${model}:generateContent`;

        // 带超时和重试的请求
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

            try {
                const response = await fetch(endpoint, {
                    method: "POST",
                    headers: {
                        "x-goog-api-key": this.apiKey!,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(requestBody),
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    const statusCode = response.status;

                    // 可重试的状态码：429（限流）、5xx（服务器错误）
                    if ((statusCode === 429 || statusCode >= 500) && attempt < MAX_RETRIES) {
                        lastError = new Error(
                            `Gemini API 错误: ${statusCode} - ${JSON.stringify(errorData)}`
                        );
                        await this.delay(RETRY_DELAY_MS * Math.pow(2, attempt));
                        continue;
                    }

                    throw new Error(
                        `Gemini API 错误: ${statusCode} - ${JSON.stringify(errorData)}`
                    );
                }

                const data = (await response.json()) as Record<string, unknown>;

                // 解析 Gemini 返回格式
                const outputText = this.extractOutputText(data);

                // 获取 usage 信息
                const usageMetadata = data.usageMetadata as Record<string, number> | undefined;

                return {
                    content: outputText,
                    model,
                    usage: usageMetadata
                        ? {
                              promptTokens: usageMetadata.promptTokenCount ?? 0,
                              completionTokens:
                                  usageMetadata.candidatesTokenCount ?? 0,
                              totalTokens: usageMetadata.totalTokenCount ?? 0,
                          }
                        : undefined,
                };
            } catch (error) {
                clearTimeout(timeoutId);

                // 处理超时和网络错误
                if (error instanceof Error) {
                    if (error.name === "AbortError") {
                        lastError = new Error(`Gemini API 请求超时 (${DEFAULT_TIMEOUT_MS / 1000}s)`);
                    } else if (error.message.includes("fetch")) {
                        lastError = new Error(`Gemini API 网络错误: ${error.message}`);
                    } else {
                        lastError = error;
                    }
                } else {
                    lastError = new Error(String(error));
                }

                // 网络错误可重试
                if (attempt < MAX_RETRIES) {
                    await this.delay(RETRY_DELAY_MS * Math.pow(2, attempt));
                    continue;
                }
            }
        }

        throw lastError ?? new Error("Gemini API 请求失败");
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** 将 ChatMessage 转换为 Gemini 格式 */
    private convertMessages(
        messages: ChatMessage[]
    ): Array<{ role: string; parts: Array<{ text: string }> }> {
        const contents: Array<{
            role: string;
            parts: Array<{ text: string }>;
        }> = [];

        // Gemini 不支持 system 角色，需要将其合并到第一条 user 消息
        let systemPrompt = "";

        for (const msg of messages) {
            if (msg.role === "system") {
                systemPrompt += msg.content + "\n\n";
            } else {
                const role = msg.role === "assistant" ? "model" : "user";
                let content = msg.content;

                // 如果是第一条 user 消息且有 system prompt，合并它
                if (role === "user" && systemPrompt && contents.length === 0) {
                    content = systemPrompt + content;
                    systemPrompt = "";
                }

                contents.push({
                    role,
                    parts: [{ text: content }],
                });
            }
        }

        return contents;
    }

    /** 从 Gemini 返回中提取文本（过滤掉 thought 部分） */
    private extractOutputText(data: Record<string, unknown>): string {
        const candidates = data.candidates as
            | Array<{
                  content?: {
                      parts?: Array<{ text?: string; thought?: boolean }>;
                  };
              }>
            | undefined;

        if (candidates && candidates[0]?.content?.parts) {
            // 过滤掉 thought 部分，只保留最终输出
            const outputParts = candidates[0].content.parts.filter(
                (part) => !part.thought
            );

            if (outputParts.length > 0 && outputParts[0].text) {
                return outputParts[0].text;
            }
        }

        throw new Error("无法从 Gemini 响应中提取输出文本");
    }
}
