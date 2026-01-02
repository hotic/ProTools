# AGENTS.md

ProTools MCP Server 项目指南，供 AI 代理参考。

## 项目概述

这是一个 MCP (Model Context Protocol) Server，提供代码合并和 AI 代码审查功能。

**技术栈**：TypeScript, Node.js, Zod, MCP SDK

## 核心模块

### LLM Provider (`src/core/llm/`)

支持两个 Provider：
- **OpenAI**: GPT-5.2，使用 Responses API，支持 JSON 格式约束
- **Gemini**: Gemini 3 Flash，支持 thinking_level 配置

两者都实现了：
- 超时控制（AbortController）
- 指数退避重试（429/5xx）
- JSON 格式强制输出

### 代码审查 (`src/tools/code-review.ts`)

主要功能：
- 同步审查：`executeCodeReview`
- 异步任务：`startCodeReviewTask` / `getCodeReviewTaskStatus`
- 支持 Git diff 模式和文件路径模式
- 多模型并发审查，使用 `Promise.allSettled` 容错

### 审查子模块 (`src/tools/review/`)

拆分的子模块：
- `task-store.ts`: 任务存储、状态管理、LRU 清理
- `report-generator.ts`: Markdown 报告生成
- `result-processor.ts`: 结果验证（Zod）和多模型合并

## 开发规范

### 代码风格

- 使用 ESM 模块（`import`，不用 `require`）
- 类型定义使用 Zod Schema
- 异步操作使用 `async/await`
- 文件操作优先使用 `fs.promises`

### 错误处理

- LLM 调用需要超时和重试
- 使用 `Promise.allSettled` 处理并发，允许部分失败
- Zod `safeParse` 校验外部输入，失败时尝试修复

### Prompt 设计

- 模板在 `src/prompts/templates/review.ts`
- 代码内容放在 Prompt 最后
- 强调务实审查，避免过度工程化建议

## 常见任务

### 添加新工具

1. 在 `src/types/` 创建输入 Schema
2. 在 `src/tools/` 实现工具逻辑
3. 在 `src/index.ts` 注册 `server.tool()`

### 添加新 LLM Provider

1. 继承 `BaseLLMProvider`
2. 实现 `doChat` 方法
3. 在 `src/core/llm/index.ts` 注册

### 修改审查 Prompt

编辑 `src/prompts/templates/review.ts` 中的模板常量。

## 测试

```bash
# 编译
npm run build

# 重启 MCP Server（在 IDE 中）后测试
```

## 注意事项

- 审查结果需要批判性分析，不是所有问题都需要修复
- 环境变量配置在 MCP 配置文件中，不在 `.env`
- 异步任务存储在内存中，服务重启后丢失
