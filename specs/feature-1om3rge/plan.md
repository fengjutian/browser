# 新建需求 3 实施计划

## 摘要

规格「新建需求 3」用户场景为「分析项目代码」，但功能需求、验收标准和非目标均为「待补充」占位。基于当前代码索引（132 文件 / 184 符号 / 32 模块依赖 / 391 调用关系）与已落地实现（Go + SQLite + FTS5 后端 / React + Tauri 2 前端 / Reader 流水线 / 多标签浏览器），本分析推断该需求为「对当前代码库进行结构化梳理并输出可观察的架构与流程描述」，不修改代码，仅给出架构、影响范围、分阶段实施步骤、可验证验收标准与风险点，所有结论均带引用。

## 技术上下文

- 后端进程入口链：backend/cmd/server/main.go:17 → signal.NotifyContext 监听 SIGINT/TERM → 读取 AKB_ADDR（默认 127.0.0.1:8787）/AKB_DATA_DIR（默认 data） → storage.Open 启用 WAL/foreign_keys/busy_timeout=5000（backend/internal/storage/sqlite.go:13-31） → migrate 创建 documents/tags/document_tags + documents_fts(unicode61) 虚拟表（backend/internal/storage/sqlite.go:32-39） → NewSQLiteRepository（backend/internal/document/sqlite_repository.go:13-21） → NewProcessor 容量 128（backend/internal/document/processor.go:16-21） → go processor.Run 单消费者（backend/internal/document/processor.go:34-43） → NewServerWithProcessor 注入仓库+处理器（backend/internal/httpapi/server.go:25-28） → http.ListenAndServe 暴露 ServeMux（backend/cmd/server/main.go:36-38）
- 后端领域分层：model.go 定义 5 状态枚举（PENDING/PROCESSING/READY/FAILED/ARCHIVED）与 Document/CreateInput/UpdateInput（backend/internal/document/model.go:5-55） → Repository 接口（backend/internal/document/repository.go:15-21） → MemoryRepository 测试实现（backend/internal/document/repository.go:23-30） + SQLiteRepository 生产实现（backend/internal/document/sqlite_repository.go:13-21） → Processor 单消费者内存队列 + sync.Map 去重（backend/internal/document/processor.go:10-43）
- 后端 HTTP 路由清单（backend/internal/httpapi/server.go:33-52）：GET /api/v1/health、GET/POST /api/v1/documents、GET/PUT/DELETE /api/v1/documents/{id}、GET/POST /api/v1/search、POST /api/v1/knowledge/search、GET /api/v1/knowledge、GET /api/v1/plugins + 4 条 501 AI 占位（POST /api/v1/ai/chat|summary|translate 与 /api/v1/agent/run）；解码上限 1 MiB + DisallowUnknownFields（backend/internal/httpapi/server.go:131-135）；CORS 仅放行 http://localhost:1420 + OPTIONS 204（backend/internal/httpapi/server.go:148-156）
- 后端 FTS5 检索：List 通过 documents_fts MATCH + LEFT JOIN tags GROUP BY 聚合标签（backend/internal/document/sqlite_repository.go:47-67）；ftsQuery 使用 strings.Fields 切词后每项包装为 "term"* 前缀通配并以 AND 连接（backend/internal/document/sqlite_repository.go:195-201）
- AI 抽象层（backend/internal/ai/provider.go:1-27）：声明 ChatRequest/Message/ChatResponse 与 LLM.Chat/Embedding.Embed/Reranker.Rerank 接口；4 条 AI 路由统一返回 501 provider_not_configured（backend/internal/httpapi/server.go:50-52）
- 前端入口链：desktop/src/main.tsx:1-7 → StrictMode + createRoot → App.tsx ConfigProvider（zh_CN，深绿 #347851，侧栏 #16241f，desktop/src/App.tsx:4） → AppRouter view useState（browser/library/search/ai/settings，desktop/src/app/AppRouter.tsx:11-15） → AppLayout 侧栏可拖拽 72-320px 并写入 CSS 变量 --sider-width（desktop/src/layouts/AppLayout.tsx:11-58） → 5 个 lazy 页面（desktop/src/app/AppRouter.tsx:5-10）
- 前端浏览器视图：BrowserPage（desktop/src/pages/browser/BrowserPage.tsx:11-235）持有 tabs/activeTabId/address/aiOpen/nativeMode/readerArticle 6 个 useState + 5 个 useRef（surfaceRef/addressRef/previousTab/activeTabIdRef/tabsRef）；5 大动作 navigate/openNewTab/activateTab/closeTab/save + 750ms setInterval sync + ResizeObserver + window 键盘快捷键（Ctrl+T/W/L/Tab/1-9/R + Alt+←/→ + Esc + F5）
- 前端原生适配层：desktop/src/services/nativeBrowser.ts:10-130 定义 labels Map + labelFor(tabId.replace(/[^a-zA-Z0-9-]/g, '-')) → 暴露 openNativeTab/show/hide/close/resize/reload/stop/navigateHistory/readNativeState/captureNativePage/onNativeNewTab；走 Tauri invoke 'browser_create/browser_navigate/browser_reload/browser_stop/browser_history/browser_state/browser_snapshot' 与 listen('browser://new-tab')
- 前端阅读器流水线：BrowserPage.openReader → captureNativePage（desktop/src/services/nativeBrowser.ts:36-38） → extractArticle（desktop/src/features/reader/extractArticle.ts:7-33）→ DOMParser + Readability（@mozilla/readability@0.6） → 移除 script/style/noscript/iframe/object/embed/form 与 on* 属性 → 仅保留 http(s) 的 src/href → turndown 转 Markdown → 返回 ReaderArticle{title,byline,excerpt,siteName,language,contentHtml,markdown,textContent,wordCount}（desktop/src/features/reader/types.ts:1-2）
- 前端 API 客户端：desktop/src/api.ts:3-39 指向 http://127.0.0.1:8787/api/v1；提供 listDocuments/saveDocument/getDocument/deleteDocument；Tauri 环境走 invoke 'local_*'，非 Tauri 环境回退空集合/原对象；documentService.ts 在 API 失败时回退 demoDocuments（desktop/src/features/documents/documentService.ts:1-6）
- 前端持久化展示：LibraryPage 使用 documentService 加载并展示 3 项 Statistic（文档/集合数/已保存字数，desktop/src/pages/library/LibraryPage.tsx:8-26） + DocumentCard（标题/前 3 标签/摘要前 2 行，desktop/src/features/documents/DocumentCard.tsx:4）+ DocumentDetailDrawer 渲染 react-markdown + remark-gfm（desktop/src/features/documents/DocumentDetailDrawer.tsx:7）
- 前端搜索链路：SearchPage 250ms setTimeout 防抖（desktop/src/pages/search/SearchPage.tsx:17-25）→ listDocuments(query) → 后端 List → ftsQuery → documents_fts MATCH；失败时 setUnavailable(true) 展示「本地数据服务未连接」
- 桌面壳：desktop/src-tauri/src/main.rs:1-3 仅 fn main() 调用 ai_knowledge_browser_lib::run()；README.md 描述 lib.rs 中注册 browser_create/browser_navigate/browser_state/browser_snapshot/browser_reload/browser_stop/browser_history 与 local_list_documents/local_save_document/local_get_document/local_delete_document 等 Tauri command，但当前 src-tauri 业务文件未在索引内出现
- 测试矩阵：HTTP 层 TestHealth/TestDocumentLifecycle/TestCreateValidation（backend/internal/httpapi/server_test.go:13-43） + Processor 单测 TestProcessorMarksDocumentReady/TestProcessorMarksEmptyDocumentFailed（backend/internal/document/processor_test.go:9-49） + SQLite 持久化 TestSQLiteRepositoryPersistsAndSearches（backend/internal/document/sqlite_repository_test.go:12-49） + desktop/src/features/documents/documentService.ts:1-6 mock 离线降级；无 UI/端到端测试

## 宪章检查

- [x] 保持本地优先和显式上下文
- [x] 所有写入经过受控 Runtime
- [x] 变更保持最小且可验证

## 影响范围

- `backend/cmd/server/main.go`（LOW）— 仅作为分析对象（入口链 path:line），不修改代码
- `backend/internal/storage/sqlite.go`（LOW）— 存储层仅引用 schema 与 PRAGMA，不修改
- `backend/internal/document/model.go`（LOW）— 领域模型仅引用 5 状态枚举与 Document 字段，不修改
- `backend/internal/document/processor.go`（LOW）— Processor 仅作为流程图节点与差距清单来源，不修改
- `backend/internal/document/sqlite_repository.go`（LOW）— SQLite 仓库仅引用 List/ftsQuery/cleanTags/replaceTags/replaceFTS，不修改
- `backend/internal/httpapi/server.go`（LOW）— HTTP 路由清单仅用于跨层调用矩阵与差距清单，不修改
- `backend/internal/ai/provider.go`（LOW）— AI 接口仅在差距清单中提及，不修改
- `desktop/src/pages/browser/BrowserPage.tsx`（LOW）— 浏览器页面作为核心流程图来源与差距清单来源，仅阅读不修改
- `desktop/src/features/reader/extractArticle.ts`（LOW）— 阅读器作为流程图节点与安全差距清单来源，不修改
- `desktop/src/services/nativeBrowser.ts`（LOW）— 原生适配层作为 invoke 契约与差距清单来源，不修改
- `desktop/src/api.ts`（LOW）— API 客户端仅作为契约证据，不修改
- `desktop/src/layouts/AppLayout.tsx`（LOW）— 外壳仅在架构描述中提及 CSS 变量 --sider-width，不修改
- `desktop/src/app/AppRouter.tsx`（LOW）— 路由仅在架构与路由流程图中提及 5 个 lazy view，不修改
- `desktop/src-tauri/src/main.rs`（LOW）— Tauri 壳仅在差距清单中提及 commands 未注册，不修改

## 实施策略

- 阶段 0（澄清边界）：与产品/研发对齐范围（仅文档 / 含工具链 / 含量化指标）；确认产出格式（Markdown + Mermaid）与放置路径（specs/feature-/docs/）；明确非目标（不改代码、不新增依赖、不改 build 脚本）
- 阶段 1（架构骨架）：以引用为节点撰写分层说明，每条引用 path:line 均可点击；7 个分层分别为：后端入口（backend/cmd/server/main.go:17-39）/ 存储层（backend/internal/storage/sqlite.go:13-31）/ 领域层（backend/internal/document/* 5 文件）/ 传输层（backend/internal/httpapi/server.go:33-156）/ AI 抽象（backend/internal/ai/provider.go:1-27）/ 前端入口链（desktop/src/main.tsx → App.tsx → AppRouter → AppLayout）/ 桌面壳（desktop/src-tauri/src/main.rs:1-3 + nativeBrowser.ts:20-80）
- 阶段 2（关键流程图）：图 A 文档生命周期（client → POST /api/v1/documents → createDocument 校验 title/url 非空 → TrimSpace → Repository.Create 事务写 documents/tags/document_tags/documents_fts → processor.Enqueue LoadOrStore 去重 → 容量 128 chan 满 → 503 queue_full → Run loop → Update status=PROCESSING → Get → Markdown 空则用 Content → 仍空置 FAILED → 否则 Update Markdown=body, status=READY → client 30×200ms poll GET → FTS5 检索）；图 B 浏览器多标签状态机（newTab/openNewTab/activateTab/closeTab/sync timer 750ms/ResizeObserver/onKeyDown window）；图 C 阅读器流水线（captureNativePage → DOMParser + Readability → 净化 → Turndown → ReaderArticle）
- 阶段 3（符号清单）：按模块分组输出每条 SYMBOL 的 path:line 与一句话职责：backend/cmd/server（main.go:17 func main）、backend/internal/ai（ChatRequest/Message/ChatResponse/LLM/Embedding/Reranker）、backend/internal/document（Status/Document/CreateInput/UpdateInput/Processor/Repository/MemoryRepository/SQLiteRepository/scanner）、backend/internal/httpapi（Server/Handler/routes/listDocuments/createDocument/getDocument/updateDocument/deleteDocument/search/searchPost/writeSearch/knowledge/decode/writeJSON/writeError/notImplemented/cors）、backend/internal/storage（Open/migrate）、desktop/src（App/AppRouter/AppLayout + 5 视图 Page + DocumentCard/DocumentDetailDrawer/documentService + extractArticle/types + nativeBrowser + api/types）
- 阶段 4（跨层调用矩阵）：5 行 × N 列表，行=backend/cmd/server/main.go、storage、document、httpapi、ai，列=Document 模型、Tauri command 'local_*'、REST 端点 '/api/v1/{health,documents,documents/{id},search,knowledge,plugins,ai/*}'、共享状态枚举
- 阶段 5（差距清单）：AI Provider 接口已声明但未实现（backend/internal/ai/provider.go:1-27 vs server.go:50-52）、Tauri commands 调用方已写但注册未覆盖（desktop/src/services/nativeBrowser.ts:20-80 vs desktop/src-tauri/src/main.rs:1-3）、浏览器 saveDocument 提交 markdown 占位（desktop/src/pages/browser/BrowserPage.tsx:205）、FTS5 query 未转义操作符（backend/internal/document/sqlite_repository.go:195-201）、CORS 仅放行 http://localhost:1420（backend/internal/httpapi/server.go:149）、Processor 错误仅 log.Printf 不上报（backend/internal/document/processor.go:48,66）、collections/ARCHIVED 接口缺失（backend/internal/document/model.go:12 vs server.go 路由）、双存储未同步（README.md:14 vs backend/internal/storage/sqlite.go:13）
- 阶段 6（验证）：文档章节存在性（grep 校验 7 个分层 + 3 张流程图 + 符号清单 + 调用矩阵 + 差距清单 + 非目标 + 待确认）、引用有效性（脚本校验 path:line 是否命中索引）、流程图可渲染（Mermaid Live 逐图校验）、非目标保持（git diff 确认无业务代码变更）
- 阶段 7（交付）：在 PR 描述中附「分析交付物链接 + 引用清单 + 流程图缩略图」，由产品/研发 review；保留产物可被后续 feature-1811ek3/feature-17r1sv4 复用

## 风险与待确认

- 「分析项目代码」是仅产出静态分析文档，还是要求嵌入 CI/工具链（如 typedoc、go doc、madge、vite-plugin-docgen）以保持文档随代码自动更新？
- 分析文档的交付格式：是 Markdown + Mermaid（仓库内版本管理），还是导出 SVG/PNG（需新增构建步骤）？
- 分析范围：是覆盖全量 132 文件 / 184 符号 / 391 调用关系，还是聚焦某一子系统（浏览器、阅读器、知识库、AI、桌面壳）？
- 是否需要同时输出后端（Go）与前端（TS）两侧的调用图，或仅一张跨层总图？
- 「分析」是否要求量化指标（Processor 队列容量 128 / API 端点数 / 视图数 / FTS5 切词规则数）作为文档章节？
- 文档放置路径：docs/analysis/、specs/feature-/、还是 README 章节？是否影响后续 Spec Kit 工作流？
- 是否需要将本期分析作为后续实现迭代（AI Provider 接入、Tauri commands 补齐、Reader 安全加固）的前置输入？
- 对 Tauri 桌面壳当前 main.rs 仅调用 lib::run()（desktop/src-tauri/src/main.rs:1-3）、业务文件未在索引内出现这一事实，文档应如何呈现「未注册命令」与「已被前端调用的命令」之间的差距？
- AI 占位接口（backend/internal/httpapi/server.go:50-52）当前无 Provider 实现，文档应将其作为「设计已就绪 / 实现未落地」还是「差距」标记？
- 桌面 SQLite（README.md:14 描述 src-tauri/src/local_store.rs）与 Go 服务端 SQLite（backend/internal/storage/sqlite.go:13-31）是两套独立存储，文档是否需明确「双存储且未同步」这一现状？
- 前端 documentService.ts（desktop/src/features/documents/documentService.ts:1-6）目前只有 mock 离线降级，无真实页面级测试覆盖，文档是否需要标注当前测试覆盖矩阵？
