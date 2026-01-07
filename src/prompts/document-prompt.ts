/**
 * 文档生成 Prompt 构建器
 * 负责组装模板和解析响应
 */

import type {
    DocumentType,
    DocumentFormat,
    DocumentLanguage,
    DocumentSuggestResult,
} from "../types/document.js";
import {
    getSystemPrompt,
    buildUserPrompt as buildUserPromptFromTemplate,
} from "./templates/document.js";

export interface DocumentPromptParams {
    /** 代码/配置内容 */
    code: string;
    /** 文档类型 */
    docType: DocumentType;
    /** 输出格式 */
    format: DocumentFormat;
    /** 输出语言 */
    language: DocumentLanguage;
    /** 附加上下文 */
    context?: string;
}

export interface DocumentPromptMessages {
    system: string;
    user: string;
}

/**
 * 构建文档生成的 Prompt 消息
 */
export function buildDocumentPrompt(
    params: DocumentPromptParams
): DocumentPromptMessages {
    const { code, docType, format, language, context } = params;

    return {
        system: getSystemPrompt(docType, format),
        user: buildUserPromptFromTemplate(code, docType, context, language),
    };
}

/**
 * 解析 LLM 返回的 JSON 结果
 * 增强版：支持从混乱输出中提取有效 JSON
 */
export function parseDocumentResponse(response: string): DocumentSuggestResult {
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
        return validateAndEnrichResult(JSON.parse(jsonStr));
    } catch {
        // 解析失败，尝试修复常见问题
    }

    // 尝试修复：处理 JSON 字符串值内的实际换行符
    // LLM 经常在字符串值内输出实际换行而非 \n
    const fixedJson = fixJsonNewlines(jsonStr);

    try {
        return validateAndEnrichResult(JSON.parse(fixedJson));
    } catch {
        // 继续尝试其他修复
    }

    // 尝试修复：移除可能的控制字符
    const cleanedJson = fixedJson
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    try {
        return validateAndEnrichResult(JSON.parse(cleanedJson));
    } catch {
        // 继续尝试其他修复
    }

    // 尝试修复：使用平衡括号提取
    try {
        const extracted = extractBalancedJson(jsonStr);
        if (extracted) {
            return validateAndEnrichResult(JSON.parse(extracted));
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
 * 验证并补全结果结构
 */
function validateAndEnrichResult(
    raw: Record<string, unknown>
): DocumentSuggestResult {
    // 确保必需字段存在
    const docType = raw.doc_type as string;
    if (!docType || !["spec", "decision", "changelog"].includes(docType)) {
        throw new Error(`无效的 doc_type: ${docType}`);
    }

    const title = (raw.title as string) || "未命名文档";
    const summary = (raw.summary as string) || "";
    const content = (raw.content as string) || "";

    // 处理 extracted 字段
    const rawExtracted = (raw.extracted || {}) as Record<string, unknown>;
    const extracted = {
        definitions: rawExtracted.definitions as Record<string, string> | undefined,
        rules: rawExtracted.rules as string[] | undefined,
        examples: rawExtracted.examples as string[] | undefined,
        decisions: rawExtracted.decisions as Array<{
            decision: string;
            rationale: string;
            alternatives?: string[];
        }> | undefined,
    };

    return {
        doc_type: docType as "spec" | "decision" | "changelog",
        title,
        summary,
        content,
        extracted,
        // meta 将在调用层填充
        meta: {
            provider: "",
            model: "",
            tokens: { input: 0, output: 0 },
            duration_ms: 0,
        },
    };
}

/**
 * 修复 JSON 字符串值内的实际换行符
 * LLM 经常在字符串值内输出实际换行而非转义的 \n
 */
function fixJsonNewlines(jsonStr: string): string {
    const result: string[] = [];
    let inString = false;
    let escape = false;

    for (let i = 0; i < jsonStr.length; i++) {
        const char = jsonStr[i];

        if (escape) {
            result.push(char);
            escape = false;
            continue;
        }

        if (char === "\\") {
            result.push(char);
            escape = true;
            continue;
        }

        if (char === '"') {
            result.push(char);
            inString = !inString;
            continue;
        }

        // 如果在字符串内部遇到实际换行符，转义它
        if (inString && (char === "\n" || char === "\r")) {
            if (char === "\r" && jsonStr[i + 1] === "\n") {
                // CRLF → \n
                result.push("\\n");
                i++; // 跳过 \n
            } else {
                result.push("\\n");
            }
            continue;
        }

        result.push(char);
    }

    return result.join("");
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

/**
 * 格式化最终文档输出
 */
export function formatDocument(result: DocumentSuggestResult): string {
    const lines: string[] = [];

    // 标题
    lines.push(`# ${result.title}`);
    lines.push("");

    // 摘要
    if (result.summary) {
        lines.push(`> ${result.summary}`);
        lines.push("");
    }

    // 主体内容
    lines.push(result.content);

    return lines.join("\n");
}
