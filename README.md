# ProTools MCP Server

可扩展的 MCP 工具盒，封装日常开发脚本。支持代码合并、AI 代码审查等功能。

## 功能特性

- **代码合并**：将多个源文件合并为单一上下文，支持压缩模式
- **AI 代码审查**：支持 OpenAI GPT-5.2 和 Google Gemini 3 Flash 双模型并发审查
- **文档生成**：从代码/配置变更中提取隐含规范，生成技术规范、设计决策、变更日志
- **异步任务**：长时间任务支持异步执行和轮询查询
- **智能默认**：未指定审查目标时自动检测 Git 变更

## 工具列表

### `protools_merge_files`

合并多个源代码文件，供对话模型作为上下文使用。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `inputs` | `string[]` | *必填* | 文件/目录/glob 路径列表 |
| `mode` | `full \| compact \| skeleton` | `compact` | 压缩模式 |
| `extensions` | `string[]` | - | 过滤扩展名，如 `[".ts", ".js"]` |
| `excludes` | `string[]` | - | 排除的 glob 模式 |
| `group` | `boolean` | `false` | 按输入路径分组输出 |
| `output` | `inline \| file` | `inline` | 输出方式 |
| `output_dir` | `string` | `output/` | 输出目录 |
| `max_bytes` | `number` | - | 超过此字节数强制落盘 |

**压缩模式**：
- `full`：保留全部内容
- `compact`：移除注释和 import
- `skeleton`：仅保留签名

### `protools_code_review`

使用 AI 对代码进行同步审查。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cwd` | `string` | - | 工作目录（多仓库工作区时指定项目路径） |
| `inputs` | `string[]` | - | 文件/目录/glob 路径（与 git_mode 二选一） |
| `git_mode` | `staged \| unstaged \| all` | - | Git diff 模式（未指定 inputs 时自动启用） |
| `include_full_files` | `boolean` | `true` | Git 模式下是否包含完整文件内容 |
| `include_project_context` | `boolean` | `true` | 是否包含项目上下文 |
| `focus` | `security \| performance \| quality \| maintainability \| all` | `all` | 审查关注领域 |
| `provider` | `openai \| gemini` | - | 指定单个 Provider |
| `mode` | `full \| compact \| skeleton` | `compact` | 代码压缩模式 |
| `context` | `string` | - | 附加审查说明 |
| `output` | `inline \| file` | `inline` | 输出方式 |

### `protools_code_review_start`

启动异步代码审查任务，返回任务 ID。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| 继承 `protools_code_review` 全部参数 |||
| `providers` | `string[]` | - | 并发使用的 Provider 列表 |
| `wait_first_result_ms` | `number` | `0` | 等待首个结果的超时时间（毫秒） |

> **提示**：未指定 `inputs` 和 `git_mode` 时，会自动检测 Git 变更并使用 `all` 模式。

### `protools_code_review_status`

查询异步代码审查任务状态。

| 参数 | 类型 | 说明 |
|------|------|------|
| `task_id` | `string` | 任务 ID |

### `protools_document_suggest`

从代码/配置变更中提取隐含规范，生成结构化文档。

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `cwd` | `string` | - | 工作目录 |
| `inputs` | `string[]` | - | 文件/目录/glob 路径（与 git_mode 二选一） |
| `git_mode` | `staged \| unstaged \| all` | - | Git diff 模式 |
| `doc_type` | `spec \| decision \| changelog \| auto` | `auto` | 文档类型 |
| `format` | `markdown \| feishu` | `feishu` | 输出格式 |
| `language` | `zh \| en` | `zh` | 输出语言 |
| `context` | `string` | - | 附加背景说明 |
| `provider` | `openai \| gemini` | `gemini` | LLM Provider |
| `extensions` | `string[]` | - | 过滤扩展名 |
| `excludes` | `string[]` | - | 排除的 glob 模式 |

**文档类型**：
- `spec`：技术规范（配置格式、字段定义、约束规则）
- `decision`：设计决策（技术选型、架构权衡）
- `changelog`：变更日志（按类别分组的变更记录）
- `auto`：自动推断最合适的类型

**输出格式**：
- `feishu`（默认）：针对飞书优化，避免 HTML，标题不超 3 级
- `markdown`：标准 Markdown

## 环境变量配置

```bash
# OpenAI 配置
OPENAI_API_KEY=sk-xxx           # OpenAI API Key
OPENAI_BASE_URL=                # 可选，自定义 API 地址
OPENAI_REASONING_EFFORT=medium  # 推理级别：none | low | medium | high | xhigh

# Gemini 配置
GEMINI_API_KEY=xxx              # Google AI API Key
GEMINI_THINKING_LEVEL=HIGH      # 思考级别：NONE | LOW | MEDIUM | HIGH

# Provider 配置
LLM_PROVIDER=openai,gemini      # 默认使用的 Provider（逗号分隔）
CONCURRENT_REVIEW=true          # 是否启用并发审查
ASK_USER_FEEDBACK=false         # 是否询问用户反馈
```

## MCP 配置示例

### Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "protools": {
      "command": "node",
      "args": ["/path/to/ProTools/dist/index.js"],
      "env": {
        "OPENAI_API_KEY": "sk-xxx",
        "OPENAI_REASONING_EFFORT": "medium",
        "GEMINI_API_KEY": "xxx",
        "LLM_PROVIDER": "openai,gemini",
        "CONCURRENT_REVIEW": "true",
        "GEMINI_THINKING_LEVEL": "HIGH"
      }
    }
  }
}
```

### 开发模式（使用 tsx）

```json
{
  "mcpServers": {
    "protools": {
      "command": "npx",
      "args": ["tsx", "/path/to/ProTools/src/index.ts"],
      "env": {
        "OPENAI_API_KEY": "sk-xxx",
        "OPENAI_REASONING_EFFORT": "medium",
        "GEMINI_API_KEY": "xxx",
        "LLM_PROVIDER": "openai,gemini",
        "CONCURRENT_REVIEW": "true"
      }
    }
  }
}
```

## 开发

```bash
# 安装依赖
npm install

# 开发运行
npm run dev

# 编译
npm run build

# 类型检查
npx tsc --noEmit
```

## 项目结构

```
src/
├── index.ts                 # MCP Server 入口
├── core/
│   ├── io.ts               # 文件 IO 工具
│   ├── merge.ts            # 代码合并逻辑
│   ├── git.ts              # Git 操作
│   ├── project-context.ts  # 项目上下文收集
│   └── llm/                # LLM Provider
│       ├── index.ts
│       ├── base-provider.ts
│       ├── openai-provider.ts
│       └── gemini-provider.ts
├── tools/
│   ├── merge-files.ts      # 合并文件工具
│   ├── code-review.ts      # 代码审查工具
│   ├── document-suggest.ts # 文档生成工具
│   └── review/             # 审查子模块
│       ├── task-store.ts   # 任务存储
│       ├── report-generator.ts
│       └── result-processor.ts
├── prompts/
│   ├── review-prompt.ts    # 审查 Prompt 构建器
│   ├── document-prompt.ts  # 文档 Prompt 构建器
│   └── templates/          # Prompt 模板
│       ├── review.ts
│       └── document.ts
└── types/
    ├── merge.ts
    ├── review.ts
    └── document.ts
```

## License

MIT
