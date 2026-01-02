/**
 * 代码审查 Prompt 构建器
 * 负责组装模板和解析响应
 */

import type { ReviewFocus } from "../types/review.js";
import {
    FOCUS_DESCRIPTIONS,
    SYSTEM_PROMPT_TEMPLATE,
    USER_PROMPT_TEMPLATE,
} from "./templates/review.js";

export interface PromptParams {
    /** 代码内容 */
    code: string;
    /** 关注领域 */
    focus: ReviewFocus;
    /** 附加上下文 */
    context?: string;
}

/**
 * 生成代码审查的系统提示词
 */
export function buildSystemPrompt(focus: ReviewFocus): string {
    const focusDesc = FOCUS_DESCRIPTIONS[focus];
    return SYSTEM_PROMPT_TEMPLATE.replace("{{focusDesc}}", focusDesc);
}

/**
 * 生成代码审查的用户提示词
 */
export function buildUserPrompt(params: PromptParams): string {
    const { code, focus, context } = params;
    const focusDesc = FOCUS_DESCRIPTIONS[focus];

    // 构建上下文部分
    const contextSection = context ? `## 附加说明\n${context}\n\n` : "";

    return USER_PROMPT_TEMPLATE
        .replace("{{focusDesc}}", focusDesc)
        .replace("{{context}}", contextSection)
        .replace("{{code}}", code);
}

/**
 * 解析 LLM 返回的 JSON 结果
 */
export function parseReviewResponse(response: string): Record<string, unknown> {
    // 尝试提取 JSON 块（如果被 markdown 包裹）
    const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    let jsonStr = jsonMatch ? jsonMatch[1] : response;

    // 清理可能的前后缀
    jsonStr = jsonStr.trim();

    // 找到第一个 { 和最后一个 }
    const startIndex = jsonStr.indexOf("{");
    const endIndex = jsonStr.lastIndexOf("}");

    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        jsonStr = jsonStr.slice(startIndex, endIndex + 1);
    }

    try {
        return JSON.parse(jsonStr);
    } catch (error) {
        throw new Error(
            `JSON 解析失败: ${error instanceof Error ? error.message : error}\n原始响应: ${response.slice(0, 500)}...`
        );
    }
}
