/**
 * OpenAI GPT-5.2 Provider
 * 使用 Responses API 并支持可配置的 reasoning effort
 */

import { BaseLLMProvider } from "./base-provider.js";
import type {
    ChatMessage,
    LLMRequestConfig,
    LLMResponse,
    LLMProviderType,
} from "./types.js";

// 默认配置
const DEFAULT_MODEL = "gpt-5.2";
const DEFAULT_MAX_TOKENS = 16384;
const API_ENDPOINT = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟（高推理模式需要较长时间）
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// reasoning effort 级别
type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh";

/** 获取配置的 reasoning effort */
function getReasoningEffort(): ReasoningEffort {
    const env = process.env.OPENAI_REASONING_EFFORT?.toLowerCase();
    if (env === "none" || env === "low" || env === "medium" || env === "high" || env === "xhigh") {
        return env;
    }
    return "xhigh"; // 默认最高
}

export class OpenAIProvider extends BaseLLMProvider {
    readonly name: LLMProviderType = "openai";
    private apiKey: string | undefined;

    constructor() {
        super();
        this.apiKey = process.env.OPENAI_API_KEY;
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

        // 构建请求体（Responses API 格式）
        const requestBody: Record<string, unknown> = {
            model,
            input: messages,
            max_output_tokens: maxTokens,
            // 强制 JSON 输出格式，避免非 JSON 前缀
            text: {
                format: { type: "json_object" },
            },
        };

        // 根据环境变量配置 reasoning effort
        const reasoningEffort = getReasoningEffort();
        if (config?.thinking !== false && reasoningEffort !== "none") {
            requestBody.reasoning = { effort: reasoningEffort };
        }

        // 注意：GPT-5.2 Responses API 使用 reasoning 时不支持 temperature

        // 带超时和重试的请求
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

            try {
                const response = await fetch(API_ENDPOINT, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.apiKey}`,
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
                            `OpenAI API 错误: ${statusCode} - ${JSON.stringify(errorData)}`
                        );
                        await this.delay(RETRY_DELAY_MS * Math.pow(2, attempt));
                        continue;
                    }

                    throw new Error(
                        `OpenAI API 错误: ${statusCode} - ${JSON.stringify(errorData)}`
                    );
                }

                const data = (await response.json()) as Record<string, unknown>;

                // 解析 Responses API 返回格式
                const outputText = this.extractOutputText(data);

                // 获取 usage 信息
                const usage = data.usage as Record<string, number> | undefined;

                return {
                    content: outputText,
                    model: (data.model as string) ?? model,
                    usage: usage
                        ? {
                              promptTokens: usage.input_tokens ?? 0,
                              completionTokens: usage.output_tokens ?? 0,
                              totalTokens:
                                  (usage.input_tokens ?? 0) +
                                  (usage.output_tokens ?? 0),
                          }
                        : undefined,
                };
            } catch (error) {
                clearTimeout(timeoutId);

                // 处理超时和网络错误
                if (error instanceof Error) {
                    if (error.name === "AbortError") {
                        lastError = new Error(`OpenAI API 请求超时 (${DEFAULT_TIMEOUT_MS / 1000}s)`);
                    } else if (error.message.includes("fetch")) {
                        lastError = new Error(`OpenAI API 网络错误: ${error.message}`);
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

        throw lastError ?? new Error("OpenAI API 请求失败");
    }

    private delay(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    /** 从 Responses API 返回中提取文本（跳过 reasoning 部分） */
    private extractOutputText(data: Record<string, unknown>): string {
        // Responses API 返回格式：output 数组包含 message 对象
        const output = data.output as
            | Array<{
                  type: string;
                  content?: Array<{
                      type: string;
                      text?: string;
                  }>;
              }>
            | undefined;

        if (output && Array.isArray(output)) {
            for (const item of output) {
                if (item.type === "message" && item.content) {
                    // 优先查找 output_text 类型
                    for (const block of item.content) {
                        if (block.type === "output_text" && block.text) {
                            return block.text;
                        }
                    }
                    // 兜底：查找 text 类型（跳过 reasoning）
                    for (const block of item.content) {
                        if (block.type === "text" && block.text) {
                            return block.text;
                        }
                    }
                }
            }
        }

        // 兜底：尝试其他可能的字段
        if (typeof data.output_text === "string") {
            return data.output_text;
        }

        // 最后尝试：直接从 choices 格式读取（兼容旧 API）
        const choices = data.choices as
            | Array<{ message?: { content?: string } }>
            | undefined;
        if (choices && choices[0]?.message?.content) {
            return choices[0].message.content;
        }

        throw new Error("无法从 OpenAI 响应中提取输出文本");
    }
}
