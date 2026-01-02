/**
 * 代码审查 Prompt 模板常量
 * 将模板字符串与逻辑分离，便于维护和修改
 */

import type { ReviewFocus } from "../../types/review.js";

/** 关注领域描述映射 */
export const FOCUS_DESCRIPTIONS: Record<ReviewFocus, string> = {
    security:
        "安全性审查：检查注入漏洞（SQL、命令、XSS）、CSRF、敏感数据泄露、认证授权问题、不安全的依赖、硬编码凭证等",
    performance:
        "性能审查：检查算法复杂度、内存泄漏、不必要的计算、N+1 查询、阻塞操作、缓存机会、资源未释放等",
    quality:
        "代码质量审查：检查错误处理、类型安全、边界条件、代码重复、SOLID 原则遵循、设计模式使用等",
    maintainability:
        "可维护性审查：检查代码结构、模块化、文档完整性、测试覆盖、命名规范、圈复杂度等",
    all: "全面审查：综合检查安全性、性能、代码质量和可维护性",
};

/** 严重程度定义 */
export const SEVERITY_DEFINITIONS = `\
- critical: 严重问题，必须立即修复（安全漏洞、数据丢失风险、系统崩溃）
- major: 重要问题，强烈建议修复（性能瓶颈、逻辑错误、不良实践）
- minor: 轻微问题，建议改进（代码风格、命名规范、可读性）
- info: 信息性建议，供参考（最佳实践、优化建议）`;

/** 审查原则 */
export const REVIEW_PRINCIPLES = `\
1. 只报告真正影响功能或安全的问题，不要报告理论上可能但实际不太可能发生的问题
2. 考虑项目的实际使用场景（CLI 工具/内部工具 vs 生产服务），不要用"航天级"标准审查小工具
3. 不要建议过度工程化的优化，如：为不需要扩展的代码设计复杂抽象、为 CLI 工具添加复杂的并发限制
4. 如果代码已经合理处理了某个问题（如有超时、有清理机制），不要因为理论上可以更完美而报告
5. 避免报告这些常见的过度审查问题：
   - "建议添加更多输入验证" - 除非真的有安全风险
   - "建议添加配置化" - 除非确实需要
   - "建议使用更安全的随机数" - 除非用于加密场景
   - "建议添加速率限制" - 除非是面向公网的服务
6. 如果代码质量良好，应该给出高分（8-10），不要为了显得专业而刻意找问题
7. 宁可漏报一些 minor 问题，也不要报告一堆没实际意义的建议`;

/** 输出要求 */
export const OUTPUT_REQUIREMENTS = `\
- 必须输出合法的 JSON 格式，不要包含 markdown 代码块标记
- 所有描述使用中文
- 问题按严重程度排序（critical > major > minor > info）
- 评分标准：10=完美，7-9=优秀，5-6=合格，3-4=需改进，1-2=存在严重问题
- 如果代码质量很好，可以少报告问题，重点突出亮点`;

/** JSON 输出格式定义 */
export const OUTPUT_FORMAT = `{
  "overall_score": <1-10 分数>,
  "summary": "<总结性描述，100字以内>",
  "issues": [
    {
      "file": "<文件相对路径>",
      "line_start": <起始行号，可选>,
      "line_end": <结束行号，可选>,
      "severity": "<critical|major|minor|info>",
      "category": "<security|performance|quality|maintainability>",
      "title": "<问题标题，10字以内>",
      "description": "<详细描述>",
      "suggestion": "<修复建议>",
      "code_snippet": "<相关代码片段，可选>"
    }
  ],
  "highlights": ["<代码亮点1>", "<代码亮点2>"],
  "stats": {
    "total_issues": <总问题数>,
    "by_severity": { "critical": 0, "major": 0, "minor": 0, "info": 0 },
    "by_category": { "security": 0, "performance": 0, "quality": 0, "maintainability": 0 }
  }
}`;

/** 系统提示词模板 */
export const SYSTEM_PROMPT_TEMPLATE = `你是一位资深的代码审查专家，拥有丰富的软件工程经验。你的任务是对提供的代码进行专业、全面的审查。

## 审查重点
{{focusDesc}}

## 严重程度定义
${SEVERITY_DEFINITIONS}

## 审查原则
${REVIEW_PRINCIPLES}

## 输出要求
${OUTPUT_REQUIREMENTS}`;

/** 用户提示词模板 */
export const USER_PROMPT_TEMPLATE = `请审查以下代码，关注领域为：{{focusDesc}}

{{context}}## 输出格式
请严格按照以下 JSON 格式输出审查结果（不要包含 \`\`\`json 标记）：
${OUTPUT_FORMAT}

## 待审查代码
{{code}}`;
