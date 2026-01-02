/**
 * LLM Provider 抽象基类
 * 提供重试逻辑和通用错误处理
 */

import type {
    ILLMProvider,
    ChatMessage,
    LLMRequestConfig,
    LLMResponse,
    LLMProviderType,
} from "./types.js";

/** 重试配置 */
interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 10000,
};

export abstract class BaseLLMProvider implements ILLMProvider {
    abstract readonly name: LLMProviderType;
    protected retryConfig: RetryConfig;

    constructor(retryConfig?: Partial<RetryConfig>) {
        this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    }

    abstract isConfigured(): boolean;

    protected abstract doChat(
        messages: ChatMessage[],
        config?: LLMRequestConfig
    ): Promise<LLMResponse>;

    /**
     * 带重试的聊天请求
     */
    async chat(
        messages: ChatMessage[],
        config?: LLMRequestConfig
    ): Promise<LLMResponse> {
        if (!this.isConfigured()) {
            throw new Error(
                `${this.name} provider 未配置，请检查 API Key 环境变量`
            );
        }

        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
            try {
                return await this.doChat(messages, config);
            } catch (error) {
                lastError =
                    error instanceof Error ? error : new Error(String(error));

                // 不重试的错误类型
                if (this.isNonRetryableError(lastError)) {
                    throw lastError;
                }

                if (attempt < this.retryConfig.maxRetries) {
                    const delay = Math.min(
                        this.retryConfig.baseDelayMs * Math.pow(2, attempt),
                        this.retryConfig.maxDelayMs
                    );
                    console.error(
                        `[${this.name}] 请求失败，${delay}ms 后重试 (${attempt + 1}/${this.retryConfig.maxRetries}): ${lastError.message}`
                    );
                    await this.sleep(delay);
                }
            }
        }

        throw lastError ?? new Error("LLM 请求失败：未知错误");
    }

    /** 判断是否为不可重试的错误 */
    protected isNonRetryableError(error: Error): boolean {
        const message = error.message.toLowerCase();
        return (
            message.includes("invalid api key") ||
            message.includes("invalid_api_key") ||
            message.includes("authentication") ||
            message.includes("unauthorized") ||
            message.includes("quota exceeded") ||
            message.includes("rate limit") ||
            message.includes("api_key")
        );
    }

    protected sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
