# AI Knowledge Browser

以浏览器为入口、知识库为核心、AI 为智能层的桌面知识浏览器。

## 当前进度

- React + TypeScript + Ant Design + SCSS 桌面端交互原型
- Go REST API（健康检查、文档 CRUD、搜索、知识库统计、AI 占位接口、插件占位接口）
- SQLite 数据结构迁移
- Tauri 2 / Rust 工程与插件权限模型占位
- 产品、架构、API 与迭代文档

## 本地运行

后端：

```bash
cd backend
go run ./cmd/server
```

桌面端开发服务器：

```bash
cd desktop
npm install
npm run dev
```

默认 API 地址为 `http://127.0.0.1:8787`。当前 UI 在后端不可用时会回退到内置演示数据，便于独立预览。

## 验证

```bash
cd backend && go test ./...
cd desktop && npm run test && npm run build
```

详细范围与技术决策见 [docs/PRD.md](docs/PRD.md) 和 [docs/architecture.md](docs/architecture.md)。
