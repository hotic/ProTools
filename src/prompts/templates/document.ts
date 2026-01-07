/**
 * 文档生成 Prompt 模板常量
 */

import type { DocumentType, DocumentFormat, DocumentLanguage } from "../../types/document.js";

/** 文档类型描述映射 */
export const DOC_TYPE_DESCRIPTIONS: Record<DocumentType, string> = {
    spec: "技术规范文档：提取配置格式、字段定义、类型约束、默认值、命名规范、目录结构约定等",
    decision: "设计决策文档：分析为什么这么实现、权衡和取舍、考虑过的替代方案、约束条件和背景",
    changelog: "变更日志：按类别分组（新增/修改/修复/移除），面向用户/运维的描述，包含影响范围",
    auto: "自动推断最合适的文档类型",
};

/** 文档类型中文名 */
export const DOC_TYPE_NAMES: Record<Exclude<DocumentType, "auto">, string> = {
    spec: "技术规范",
    decision: "设计决策",
    changelog: "变更日志",
};

/** 飞书格式约束 */
export const FEISHU_FORMAT_CONSTRAINTS = `\
- 使用标准 Markdown 语法，避免 HTML 标签
- 标题层级不超过 3 级（#、##、###）
- 表格使用标准 Markdown 格式
- 代码块使用 \`\`\` 语法
- 列表使用 - 或 1. 格式
- 避免嵌套超过 2 层的列表`;

/** JSON 输出格式定义 */
export const OUTPUT_FORMAT = `{
  "doc_type": "<spec|decision|changelog>",
  "title": "<文档标题>",
  "summary": "<简要摘要，50字以内>",
  "content": "<主体 Markdown 内容>",
  "extracted": {
    "definitions": { "<术语>": "<定义>", ... },
    "rules": ["<规则1>", "<规则2>", ...],
    "examples": ["<示例1>", ...],
    "decisions": [
      {
        "decision": "<决策内容>",
        "rationale": "<决策理由>",
        "alternatives": ["<替代方案1>", ...]
      }
    ]
  }
}`;

/** spec 类型的内容结构指导 */
export const SPEC_CONTENT_GUIDE = `\
## 内容结构
1. **概述**：模块/配置的用途说明
2. **目录结构**（如适用）：文件组织方式
3. **配置字段**：使用表格列出字段名、类型、默认值、说明
4. **约束规则**：数值限制、格式要求、依赖关系
5. **命名规范**：ID、文件名等命名规则
6. **示例**：典型配置示例`;

/** decision 类型的内容结构指导 */
export const DECISION_CONTENT_GUIDE = `\
## 内容结构
1. **背景**：为什么需要做这个改动
2. **决策**：做了什么决定
3. **理由**：为什么这样决定，考虑了哪些因素
4. **替代方案**：考虑过但没采用的方案及原因
5. **影响范围**：涉及的文件/模块/功能
6. **后续事项**：需要关注或跟进的点`;

/** changelog 类型的内容结构指导 */
export const CHANGELOG_CONTENT_GUIDE = `\
## 内容结构
按以下类别组织：
1. **新增 (Added)**：新功能、新配置
2. **变更 (Changed)**：对现有功能的修改
3. **修复 (Fixed)**：问题修复
4. **移除 (Removed)**：删除的功能或配置
5. **注意事项**：升级/迁移需要关注的点`;

/** 获取内容结构指导 */
export function getContentGuide(docType: Exclude<DocumentType, "auto">): string {
    switch (docType) {
        case "spec":
            return SPEC_CONTENT_GUIDE;
        case "decision":
            return DECISION_CONTENT_GUIDE;
        case "changelog":
            return CHANGELOG_CONTENT_GUIDE;
    }
}

/** 生成原则 */
export const GENERATION_PRINCIPLES = `\
1. 只提取代码/配置中实际存在的规范，不要臆造或过度推断
2. 如果某个信息不够明确，在文档中标注 [待确认]
3. 保持简洁，避免冗余描述
4. 使用具体的例子说明抽象的规则
5. 对于技术规范，优先使用表格展示结构化信息
6. 对于设计决策，重点说明"为什么"而非"是什么"`;

/** 系统提示词模板 - spec */
export const SYSTEM_PROMPT_SPEC = `你是一位技术文档专家，擅长从代码和配置中提取技术规范。

## 任务
分析提供的代码/配置，提取其中隐含的技术规范，生成结构化的技术规范文档。

${SPEC_CONTENT_GUIDE}

## 生成原则
${GENERATION_PRINCIPLES}

## 输出格式
输出合法的 JSON 格式，不要包含 markdown 代码块标记。
{{formatConstraints}}`;

/** 系统提示词模板 - decision */
export const SYSTEM_PROMPT_DECISION = `你是一位软件架构师，擅长分析和记录设计决策。

## 任务
分析提供的代码/配置变更，提取其中的设计决策和背后的考量，生成设计决策文档。

${DECISION_CONTENT_GUIDE}

## 生成原则
${GENERATION_PRINCIPLES}

## 输出格式
输出合法的 JSON 格式，不要包含 markdown 代码块标记。
{{formatConstraints}}`;

/** 系统提示词模板 - changelog */
export const SYSTEM_PROMPT_CHANGELOG = `你是一位技术写作专家，擅长编写面向用户的变更日志。

## 任务
分析提供的代码/配置变更，生成清晰易读的变更日志。

${CHANGELOG_CONTENT_GUIDE}

## 生成原则
${GENERATION_PRINCIPLES}
- 变更日志应面向使用者，避免过于技术化的描述
- 说明变更对用户的影响

## 输出格式
输出合法的 JSON 格式，不要包含 markdown 代码块标记。
{{formatConstraints}}`;

/** 系统提示词模板 - auto */
export const SYSTEM_PROMPT_AUTO = `你是一位技术文档专家，擅长从代码和配置中提取有价值的文档。

## 任务
分析提供的代码/配置，自动判断最合适的文档类型并生成相应文档。

### 类型选择指南
- **spec（技术规范）**：当内容主要是配置定义、字段说明、格式约束时
- **decision（设计决策）**：当内容涉及架构选择、权衡取舍、实现策略时
- **changelog（变更日志）**：当内容是明确的功能变更、bug 修复、版本更新时

## 生成原则
${GENERATION_PRINCIPLES}

## 输出格式
输出合法的 JSON 格式，不要包含 markdown 代码块标记。先在 doc_type 字段指明你选择的文档类型。
{{formatConstraints}}`;

/** 获取系统提示词 */
export function getSystemPrompt(
    docType: DocumentType,
    format: DocumentFormat
): string {
    const formatConstraints =
        format === "feishu"
            ? `\n## 飞书格式约束\n${FEISHU_FORMAT_CONSTRAINTS}`
            : "";

    let template: string;
    switch (docType) {
        case "spec":
            template = SYSTEM_PROMPT_SPEC;
            break;
        case "decision":
            template = SYSTEM_PROMPT_DECISION;
            break;
        case "changelog":
            template = SYSTEM_PROMPT_CHANGELOG;
            break;
        case "auto":
            template = SYSTEM_PROMPT_AUTO;
            break;
    }

    return template.replace("{{formatConstraints}}", formatConstraints);
}

/** 用户提示词模板 */
export const USER_PROMPT_TEMPLATE = `请分析以下代码/配置，生成{{docTypeName}}文档。

{{context}}## 输出格式
请严格按照以下 JSON 格式输出（不要包含 \`\`\`json 标记）：
${OUTPUT_FORMAT}

## 待分析内容
{{code}}`;

/** 构建用户提示词 */
export function buildUserPrompt(
    code: string,
    docType: DocumentType,
    context?: string,
    language: DocumentLanguage = "zh"
): string {
    const docTypeName =
        docType === "auto"
            ? "合适类型的"
            : DOC_TYPE_NAMES[docType as Exclude<DocumentType, "auto">];

    const contextSection = context ? `## 背景说明\n${context}\n\n` : "";

    const langNote =
        language === "en" ? "\n- Output all content in English\n" : "";

    return USER_PROMPT_TEMPLATE.replace("{{docTypeName}}", docTypeName)
        .replace("{{context}}", contextSection)
        .replace("{{code}}", code)
        .replace(
            "## 输出格式",
            `## 输出格式${langNote}`
        );
}
