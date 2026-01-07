/**
 * 文档生成工具实现
 * 从代码/配置中提取隐含规范，生成结构化文档
 */

import { collectFiles } from "../core/io.js";
import { generateOutput } from "../core/merge.js";
import { getLLMProvider } from "../core/llm/index.js";
import { getEnhancedGitDiff, type GitMode, hasUncommittedChanges } from "../core/git.js";
import {
    buildDocumentPrompt,
    parseDocumentResponse,
    formatDocument,
} from "../prompts/document-prompt.js";
import type {
    DocumentSuggestInput,
    DocumentSuggestResult,
    DocumentSuggestOutput,
    DocumentType,
    DocumentFormat,
    DocumentLanguage,
} from "../types/document.js";
import type { LLMProviderType, ChatMessage } from "../core/llm/types.js";
import type { GroupedFiles, MergeMode } from "../types/merge.js";

// Token 估算（粗略：1 token ≈ 4 字符）
const CHARS_PER_TOKEN = 4;
const MAX_INPUT_TOKENS = 80000;
const MAX_INPUT_CHARS = MAX_INPUT_TOKENS * CHARS_PER_TOKEN;

// 默认使用 Gemini（格式化能力更好）
const DEFAULT_PROVIDER: LLMProviderType = "gemini";

interface PreparedDocumentRequest {
    messages: ChatMessage[];
    filesCount: number;
    startTime: number;
}

/**
 * 准备文档生成请求
 */
async function prepareDocumentRequest(
    input: DocumentSuggestInput
): Promise<PreparedDocumentRequest> {
    const startTime = Date.now();

    const cwd = input.cwd;
    const inputs = input.inputs;
    const gitMode = input.git_mode;
    const docType: DocumentType = input.doc_type ?? "auto";
    const context = input.context;
    const format: DocumentFormat = input.format ?? "feishu";
    const language: DocumentLanguage = input.language ?? "zh";
    const extensions = input.extensions;
    const excludes = input.excludes;

    // 智能默认：当未指定 inputs 和 git_mode 时，自动使用 git 变更模式
    let effectiveGitMode: GitMode | undefined = gitMode as GitMode | undefined;
    if ((!inputs || inputs.length === 0) && !gitMode) {
        if (hasUncommittedChanges(cwd)) {
            effectiveGitMode = "all";
        } else {
            throw new Error(
                "未指定分析目标。请指定 inputs（文件路径）或 git_mode（git diff 模式），" +
                    "或者确保有未提交的 git 变更"
            );
        }
    }

    let codeContent: string;
    let filesCount: number;

    // 根据模式获取代码内容
    if (effectiveGitMode) {
        // Git diff 模式
        const gitResult = getEnhancedGitDiff(effectiveGitMode, {
            cwd,
            includeFullFiles: true,
            mergeMode: "compact" as MergeMode,
        });

        if (!gitResult.content || gitResult.files.length === 0) {
            throw new Error(
                `没有${effectiveGitMode === "staged" ? "已暂存" : effectiveGitMode === "unstaged" ? "未暂存" : "未提交"}的更改`
            );
        }

        filesCount = gitResult.files.length;

        // 构建代码内容
        const parts: string[] = [];
        parts.push(`[Git 变更: ${effectiveGitMode}]`);
        parts.push(`变更文件: ${gitResult.files.join(", ")}`);
        parts.push(`统计: +${gitResult.stats.additions} -${gitResult.stats.deletions}`);
        parts.push("");

        if (gitResult.fullFilesContent) {
            parts.push("## 变更文件完整内容");
            parts.push(gitResult.fullFilesContent);
            parts.push("");
            parts.push("## Git Diff 详情");
        }

        parts.push(gitResult.content);
        codeContent = parts.join("\n");
    } else {
        // 文件路径模式
        const files = await collectFiles(inputs ?? [], extensions, excludes, false);
        const fileList = Array.isArray(files)
            ? files
            : Object.values(files as GroupedFiles).flat();

        if (fileList.length === 0) {
            throw new Error("未找到匹配的文件，请检查输入路径和过滤条件");
        }

        codeContent = generateOutput(fileList, "compact" as MergeMode, false);
        filesCount = fileList.length;
    }

    // 检查 token 限制
    const estimatedTokens = Math.round(codeContent.length / CHARS_PER_TOKEN);
    if (codeContent.length > MAX_INPUT_CHARS) {
        throw new Error(
            `代码内容超过 token 限制。` +
                `当前约 ${estimatedTokens} tokens，最大 ${MAX_INPUT_TOKENS} tokens。` +
                `请缩小文件范围。`
        );
    }

    // 构建 Prompt
    const { system, user } = buildDocumentPrompt({
        code: codeContent,
        docType,
        format,
        language,
        context,
    });

    const messages: ChatMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
    ];

    return {
        messages,
        filesCount,
        startTime,
    };
}

/**
 * 执行文档生成
 */
export async function executeDocumentSuggest(
    input: DocumentSuggestInput
): Promise<DocumentSuggestOutput> {
    // 默认使用 Gemini
    const providerType = (input.provider as LLMProviderType) ?? DEFAULT_PROVIDER;

    const prepared = await prepareDocumentRequest(input);
    const { messages, startTime } = prepared;

    // 调用 LLM
    const provider = getLLMProvider(providerType);
    const llmResponse = await provider.chat(messages, {
        maxTokens: 32768,
        temperature: 0.3,
        thinking: true,
    });

    // 解析响应
    const result = parseDocumentResponse(llmResponse.content);

    // 填充 meta 信息
    result.meta = {
        provider: provider.name,
        model: llmResponse.model,
        tokens: {
            input: llmResponse.usage?.promptTokens ?? 0,
            output: llmResponse.usage?.completionTokens ?? 0,
        },
        duration_ms: Date.now() - startTime,
    };

    // 格式化最终文档
    const document = formatDocument(result);

    return {
        result,
        document,
    };
}
