/**
 * LLM Provider 类型定义
 */

/** 支持的 Provider 类型 */
export type LLMProviderType = "openai" | "gemini";

/** 聊天消息格式 */
export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/** LLM 请求配置 */
export interface LLMRequestConfig {
    /** 模型名称（可选，使用默认） */
    model?: string;
    /** 最大输出 token 数 */
    maxTokens?: number;
    /** 温度参数 */
    temperature?: number;
    /** 是否启用思考模式 */
    thinking?: boolean;
}

/** Token 使用统计 */
export interface TokenUsage {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
}

/** LLM 响应结构 */
export interface LLMResponse {
    /** 生成的文本内容 */
    content: string;
    /** 使用的 token 数 */
    usage?: TokenUsage;
    /** 模型名称 */
    model: string;
}

/** Provider 接口 */
export interface ILLMProvider {
    /** Provider 名称 */
    readonly name: LLMProviderType;

    /** 发送聊天请求 */
    chat(messages: ChatMessage[], config?: LLMRequestConfig): Promise<LLMResponse>;

    /** 验证 API Key 是否配置 */
    isConfigured(): boolean;
}
