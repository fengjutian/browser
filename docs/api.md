# HTTP API v1

Base URL：`http://127.0.0.1:8787/api/v1`。响应为 JSON；错误格式：

```json
{"error":{"code":"validation_error","message":"title is required"}}
```

## Health

- `GET /health` → `{"status":"ok","version":"0.1.0"}`

## Documents

- `POST /documents` 创建文章。请求：`title, url, content?, markdown?, author?, language?, tags?`。
- `GET /documents?q=&status=&limit=&offset=` 列表与过滤。
- `GET /documents/{id}` 获取详情。
- `PUT /documents/{id}` 更新可编辑字段。
- `DELETE /documents/{id}` 删除（桌面端负责用户确认）。

创建成功返回 `201`；不存在返回 `404`；请求非法返回 `400`。

## Search / Knowledge

- `GET /search?q=...` 当前执行关键词匹配。
- `POST /search` 请求体 `{"query":"...","mode":"keyword|semantic|hybrid"}`。
- `GET /knowledge` 返回文档、标签、集合等统计。
- `POST /knowledge/search` 与 Search 契约一致，为知识问答召回入口。

## AI

- `POST /ai/chat`：`message, documentId?, context?`。
- `POST /ai/summary`：`documentId? | content`、`style`。
- `POST /ai/translate`：`content, targetLanguage`。

未配置 Provider 时返回 `501 provider_not_configured`，不伪造 AI 内容。

## Agent / MCP / Plugin

- `POST /agent/run`：P1，占位返回 `501`。
- `GET /agent/{id}`：P1。
- `GET|POST /mcp/servers`：P1。
- `GET /plugins`：V1 返回 `{"items":[],"runtimeAvailable":false}`。
