# 系统架构

## 组件边界

```text
React UI
  │ typed HTTP / Tauri commands
Tauri + Rust ── WebView / OS / download / privacy / secure storage
  │ localhost authenticated HTTP
Go Backend ── document / reader / knowledge / search / AI / task
  │
SQLite + FTS5 ── P1: vector index ── optional remote providers
```

- React 只负责交互和显示，不持有 API Key，不直接读写数据库。
- Rust 管理 WebView、系统权限和安全边界，不承载 RAG 业务。
- Go 是领域逻辑与异步任务的唯一实现位置。
- 本地 HTTP 服务仅监听 loopback，并在正式版本使用每次启动生成的 bearer token。

## 前端工程结构

```text
desktop/src/
├── app/            # 路由、Provider、全局启动逻辑
├── layouts/        # 应用外壳和跨页面布局
├── pages/          # 路由级页面，按业务域拆分
├── features/       # 可复用业务功能（文档、搜索、AI 等）
├── services/       # HTTP、Tauri command、配置与持久化适配器
├── shared/         # 无业务依赖的通用组件和工具
└── styles/         # SCSS 变量、主题和全局样式
```

UI 基础设施采用 Ant Design，图标统一来自 `@ant-design/icons`；品牌色、圆角等通过 `ConfigProvider` token 覆盖，布局细节使用 SCSS。页面不能直接依赖具体网络实现，应通过 feature/service 层访问数据。

浏览器页面通过 `services/nativeBrowser.ts` 管理 Tauri 子 WebView。React 负责计算内容区域的逻辑坐标、Tab 生命周期与显示状态；Rust command 负责协议校验、导航、刷新和历史操作。非 Tauri 开发环境自动使用内置预览，不会因缺少原生 API 崩溃。

## 模块依赖规则

领域模块不依赖 HTTP；HTTP 只做校验、映射和错误响应。存储通过 Repository 接口注入。AI Provider、Embedding 和 Reranker 均为可替换接口。Reader 的浏览器侧提取与服务端标准化使用版本化 payload。

## 保存状态机

```text
POST document → PENDING → PROCESSING
                           ├─ extract
                           ├─ normalize/markdown
                           ├─ chunk + FTS index
                           ├─ async embedding/summary/tag
                           └─ READY | FAILED
```

正文持久化完成即可向用户返回；AI 任务失败不回滚文章。任务应具备幂等键、重试次数和最后错误信息。

## 搜索演进

- P0：FTS5/BM25，字段权重 title > tags > markdown。
- P1：并行关键词与向量召回，使用 RRF 融合，再交给 Reranker。
- 回答层只接收带 document/chunk 标识的上下文，输出必须保留引用映射。

## 安全边界

- WebView 页面与应用 UI 使用不同 origin，网页不能调用 privileged commands。
- Tauri command 使用最小 capability；文件路径需 canonicalize 后校验允许目录。
- Provider 密钥存系统 Keychain/Credential Manager/Secret Service。
- Agent tool 定义风险级别；写入、删除、外发内容经策略检查，高风险动作必须确认。
- 日志中间件统一清除密钥、cookie、authorization 和页面敏感正文。

## 插件预留

V1 只解析 Manifest 并显示注册信息。Runtime 接口默认返回 `not available`，不加载 JS/WASM。权限使用稳定字符串枚举，未来执行前由 `PluginContext.require(permission)` 统一授权。
