# 系统架构

## 组件边界

```text
React UI
  │ typed Tauri commands
Tauri + Rust ── WebView / OS / download / privacy / secure storage /
                local_documents + local_documents_fts (FTS5) /
                collections / tasks / ai_providers / downloads / history /
                bookmarks / workspaces / reading_activity / saved_credentials
  │ optional remote providers
AI Provider (OpenAI-compatible / Ollama，本地或远端)
```

- React 只负责交互和显示，不持有 API Key，不直接读写数据库。
- Rust 管理 WebView、系统权限、安全边界、所有本地数据与全文检索（FTS5）；不依赖任何本地 HTTP 服务。
- 桌面应用不暴露 HTTP API。如需多端协作，应在 Rust 端构建独立服务。
- AI Provider 仅指外部大模型 API（OpenAI-compatible / Ollama 等），所有调用均由 Rust 端直接发出。

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
BrowserPage.save()
  ├─ browser_snapshot(label) → URL + HTML（≤ 8 MiB）
  ├─ extractArticle(snapshot) → Markdown + metadata（失败则中止，不写占位）
  ├─ local_save_document(document)
  │    ├─ INSERT OR REPLACE INTO local_documents
  │    └─ AFTER INSERT 触发器同步 local_documents_fts
  └─ local_get_document(id) → 详情回显
```

文档保存即 READY（无 PENDING/PROCESSING 中间态）。后续 P1 计划加入后台任务队列（Rust 端 `tasks` 表 + 状态机）以承载 embedding / summary / 自动标签等长任务，失败不回滚已保存的正文。任务应具备幂等键、重试次数和最后错误信息。

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
