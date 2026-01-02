/**
 * LLM Provider 统一导出和工厂函数
 */

import { OpenAIProvider } from "./openai-provider.js";
import { GeminiProvider } from "./gemini-provider.js";
import type { ILLMProvider, LLMProviderType } from "./types.js";

export * from "./types.js";
export { OpenAIProvider } from "./openai-provider.js";
export { GeminiProvider } from "./gemini-provider.js";

/** Provider 缓存（单例） */
const providerCache: Map<LLMProviderType, ILLMProvider> = new Map();

/**
 * 获取 LLM Provider 实例
 * @param type Provider 类型，默认从环境变量读取
 */
export function getLLMProvider(type?: LLMProviderType): ILLMProvider {
    // 从环境变量获取默认 Provider
    const providerType =
        type ?? (process.env.LLM_PROVIDER as LLMProviderType) ?? "openai";

    // 检查缓存
    if (providerCache.has(providerType)) {
        return providerCache.get(providerType)!;
    }

    // 创建新实例
    let provider: ILLMProvider;
    switch (providerType) {
        case "openai":
            provider = new OpenAIProvider();
            break;
        case "gemini":
            provider = new GeminiProvider();
            break;
        default:
            throw new Error(`未知的 LLM Provider: ${providerType}`);
    }

    providerCache.set(providerType, provider);
    return provider;
}

/**
 * 获取所有可用（已配置）的 Provider
 */
export function getAvailableProviders(): LLMProviderType[] {
    const providers: LLMProviderType[] = [];

    if (new OpenAIProvider().isConfigured()) {
        providers.push("openai");
    }
    if (new GeminiProvider().isConfigured()) {
        providers.push("gemini");
    }

    return providers;
}

/**
 * 获取环境变量配置的 Provider 列表
 * 支持逗号分隔的多个 provider，如 "openai,gemini"
 */
export function getConfiguredProviders(): LLMProviderType[] {
    const envValue = process.env.LLM_PROVIDER ?? "openai";
    const providers = envValue
        .split(",")
        .map((p) => p.trim().toLowerCase() as LLMProviderType)
        .filter((p) => p === "openai" || p === "gemini");

    return providers.length > 0 ? providers : ["openai"];
}
