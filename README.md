# ProTools MCP Server

可扩展的 MCP 工具盒，封装日常脚本。

## 工具列表

### `protools_merge_files`

合并多个源代码文件，供对话模型作为上下文使用。

**参数**：

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `inputs` | `string[]` | *必填* | 文件/目录/glob 路径列表 |
| `mode` | `"full" \| "compact" \| "skeleton"` | `compact` | 压缩模式 |
| `extensions` | `string[]` | - | 过滤扩展名，如 `[".kt", ".java"]` |
| `excludes` | `string[]` | - | 排除的 glob 模式列表 |
| `group` | `boolean` | `false` | 按输入路径分组输出 |
| `output` | `"inline" \| "file"` | `inline` | 输出方式 |
| `output_dir` | `string` | `ProTools/output` | 输出目录（仅 file 模式） |
| `max_bytes` | `number` | `102400` | 超过此字节数强制落盘 |

**压缩模式**：
- `full`：保留全部内容，仅规范化空行
- `compact`：移除注释、import/package、多余空行
- `skeleton`：仅保留类/方法签名

## MCP 配置

```json
{
  "mcpServers": {
    "protools": {
      "command": "npx",
      "args": ["tsx", "/home/hotic/Work/ProTools/src/index.ts"]
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
```
