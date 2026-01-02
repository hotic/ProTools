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
 * 增强版：支持从混乱输出中提取有效 JSON
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

    // 第一次尝试直接解析
    try {
        return JSON.parse(jsonStr);
    } catch {
        // 解析失败，尝试修复常见问题
    }

    // 尝试修复：移除可能的控制字符和无效 Unicode
    const cleanedJson = jsonStr
        .replace(/[\x00-\x1F\x7F]/g, " ") // 移除控制字符
        .replace(/\r\n/g, "\\n")          // 统一换行符
        .replace(/\r/g, "\\n");

    try {
        return JSON.parse(cleanedJson);
    } catch {
        // 继续尝试其他修复
    }

    // 尝试修复：使用平衡括号提取
    try {
        const extracted = extractBalancedJson(jsonStr);
        if (extracted) {
            return JSON.parse(extracted);
        }
    } catch {
        // 继续
    }

    // 最终失败
    throw new Error(
        `JSON 解析失败: 无法从响应中提取有效 JSON\n原始响应: ${response.slice(0, 500)}...`
    );
}

/**
 * 使用括号平衡算法提取 JSON
 */
function extractBalancedJson(str: string): string | null {
    const start = str.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < str.length; i++) {
        const char = str[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (char === "\\") {
            escape = true;
            continue;
        }

        if (char === '"' && !escape) {
            inString = !inString;
            continue;
        }

        if (!inString) {
            if (char === "{") depth++;
            else if (char === "}") {
                depth--;
                if (depth === 0) {
                    return str.slice(start, i + 1);
                }
            }
        }
    }

    return null;
}
