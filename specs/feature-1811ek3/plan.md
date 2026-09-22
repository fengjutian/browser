# 新建需求 6 实施计划

## 摘要

规格「新建需求 6」用户场景为「分析代码，使用流程图」，但功能需求、验收标准和非目标均为「待补充」占位。基于现有代码索引（127 文件 / 184 符号 / 32 模块依赖 / 391 调用关系）与已落地实现（Go + SQLite + FTS5 后端 / React + Tauri 2 前端 / Reader 流水线 / 多标签浏览器），推断该需求为「对当前代码库进行结构化梳理并输出关键流程的可视化产物」。本分析不修改代码，仅给出可观察的架构梳理、关键流程图（文本/Mermaid 形式）、影响范围、分阶段实施步骤、可验证验收标准与风险点，所有结论均带引用。

## 技术上下文

- 后端（Go 1.24 + modernc.org/sqlite）入口链：backend/cmd/server/main.go:17-39 → storage.Open（backend/internal/storage/sqlite.go:13-31，启用 WAL / foreign_keys=1 / busy_timeout=5000）→ NewSQLiteRepository（backend/internal/document/sqlite_repository.go:13-21）→ NewProcessor 容量 128（backend/internal/document/processor.go:16-21）→ go processor.Run（backend/internal/document/processor.go:34-43，单消费者）→ NewServerWithProcessor（backend/internal/httpapi/server.go:25-28）→ http.ListenAndServe 127.0.0.1:8787（backend/cmd/server/main.go:24-38）
- 后端 HTTP 路由清单（backend/internal/httpapi/server.go:33-52）：/api/v1/{health,documents,documents/{id},search,knowledge/search,knowledge,plugins} + 4 条 501 AI 占位（ai/chat|summary|translate, agent/run）；解码上限 1 MiB 且 DisallowUnknownFields（backend/internal/httpapi/server.go:131-135）；CORS 仅放行 http://localhost:1420（backend/internal/httpapi/server.go:148-156）
- 前端（React 19 + TS + AntD 6 + Vite + Tauri 2）入口链：desktop/src/main.tsx:1-7 → App.tsx:4（ConfigProvider zh_CN #347851）→ AppRouter（desktop/src/app/AppRouter.tsx:11-15，5 视图 browser/library/search/ai/settings）→ AppLayout（desktop/src/layouts/AppLayout.tsx:11-58，可拖拽侧栏 72–320px，写 CSS 变量 --sider-width）→ 页面级 lazy 加载
- 桌面阅读器链路：captureNativePage（desktop/src/services/nativeBrowser.ts:36-38，invoke 'browser_snapshot'）→ extractArticle（desktop/src/features/reader/extractArticle.ts:7-33，Readability → Turndown → 移除 script/on*/非 http(s) src/href）→ contentHtml/markdown/textContent/wordCount
- 保存到知识库链路：BrowserPage.save（desktop/src/pages/browser/BrowserPage.tsx:200-216）→ saveDocument（desktop/src/api.ts:19-22，走 Tauri invoke 'local_save_document'）→ 30×200ms 轮询 getDocument 等待 READY/FAILED；非 Tauri 环境返回原对象
- 搜索链路：SearchPage（desktop/src/pages/search/SearchPage.tsx:8-25）→ 250ms 防抖 setTimeout → listDocuments（desktop/src/api.ts:14-17）→ 后端 List（backend/internal/document/sqlite_repository.go:47-67）→ ftsQuery（backend/internal/document/sqlite_repository.go:195-201）→ documents_fts MATCH（unicode61 分词，"term"* 前缀通配 + AND 连接）
- 关键流程图 1（文档创建→处理→检索）：
client ─POST /api/v1/documents─► createDocument (server.go:62-77)
   │ decode 1MiB+DisallowUnknown
   │ TrimSpace(title)/TrimSpace(url) 非空校验
   │ repo.Create → tx: documents/tags/document_tags/documents_fts
   ▼
   processor.Enqueue (processor.go:22-30) ──LoadOrStore 去重──┐
   │ 容量 128 chan，full → 503 queue_full                       │
   ▼                                                            │
   Run loop (processor.go:34-43)                                │
   │ Update status=PROCESSING                                    │
   │ Get → Markdown 空则用 Content → 仍空则 status=FAILED        │
   │ 否则 Update Markdown=body, status=READY                    │
   ▼                                                            │
   client 30×200ms poll GET /api/v1/documents/{id} (BrowserPage:208-214)
   ▼
   listDocuments(q) → ftsQuery(q) → documents_fts MATCH ──results──► UI
- 关键流程图 2（浏览器多标签状态机）：
newTab() → tabs=[T0], activeTabId='new'
openNewTab(url) ─► hideNativeTab(prev) ─► push Tn, setActive(Tn)
                └─► openNativeTab (nativeBrowser.ts:20-32) ─► browser_create/browser_navigate
                └─► bounds via surfaceRef.getBoundingClientRect
activateTab(id) ─► hideNativeTab(prev) + showNativeTab(id)
closeTab(id) ─► closeNativeTab(id) ─► 兜底: 若剩余=0 自动 newTab('replacement')
sync timer 750ms (BrowserPage.tsx:43-58) ─► readNativeState ─► setTabs+setAddress
ResizeObserver (BrowserPage.tsx:60-70) ─► resizeNativeTab
onKeyDown window (BrowserPage.tsx:74-115) ─► Ctrl+T/W/L/Tab/1-9/R/Esc/Alt+←→
- 关键流程图 3（前端视图路由）：
main.tsx ─► App (ConfigProvider) ─► AppRouter (view useState)
                                       │
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                       Browser     Library     Search/AI/Settings
                          │            │
                  nativeBrowser.ts    documentService.ts ─► api.ts ─► Tauri invoke
                  extractArticle.ts                       或 backend REST
- AI 抽象层（backend/internal/ai/provider.go:1-27）：仅声明 LLM.Chat / Embedding / Reranker 三个接口与 ChatRequest/Message/ChatResponse 结构，未落地任何 Provider；4 条 AI 路由全部 501 provider_not_configured（backend/internal/httpapi/server.go:50-52）
- Tauri 桌面壳：desktop/src-tauri/src/main.rs:1-3 仅 lib::run()；browser_create/browser_navigate/browser_state/browser_snapshot/browser_reload/browser_stop/browser_history 等命令预期在 lib.rs 注册，但当前索引未覆盖到实现文件；nativeBrowser.ts 通过 invoke 调用这些命令（desktop/src/services/nativeBrowser.ts:20-80）

## 宪章检查

- [x] 保持本地优先和显式上下文
- [x] 所有写入经过受控 Runtime
- [x] 变更保持最小且可验证

## 影响范围

- `backend/cmd/server/main.go`（LOW）— 入口仅作为分析对象，不修改
- `backend/internal/storage/sqlite.go`（LOW）— 存储层只读分析
- `backend/internal/document/model.go`（LOW）— 领域模型仅引用，不变更
- `backend/internal/document/processor.go`（LOW）— 处理流水线仅作为流程图节点
- `backend/internal/document/sqlite_repository.go`（LOW）— SQLite 仓库仅作为分析对象
- `backend/internal/httpapi/server.go`（LOW）— HTTP 路由清单仅用于跨层调用矩阵与差距清单
- `backend/internal/ai/provider.go`（LOW）— AI 接口仅在差距清单中提及，不修改
- `desktop/src/pages/browser/BrowserPage.tsx`（LOW）— 浏览器页面作为核心流程图来源，仅阅读不修改
- `desktop/src/features/reader/extractArticle.ts`（LOW）— 阅读器作为流程图节点，不变更
- `desktop/src/services/nativeBrowser.ts`（LOW）— 原生适配层作为 invoke 契约来源，不修改
- `desktop/src/api.ts`（LOW）— API 客户端仅作为契约证据
- `desktop/src/layouts/AppLayout.tsx`（LOW）— 外壳仅在架构描述中提及
- `desktop/src/app/AppRouter.tsx`（LOW）— 路由仅在架构与路由流程图中提及
- `desktop/src-tauri/src/main.rs`（LOW）— Tauri 壳仅在差距清单中提及 commands 未注册

## 实施策略

- 阶段 0（澄清与边界）：与产品/研发对齐范围（仅文档 / 含工具链 / 含量化指标）；确认产出格式（Markdown + Mermaid）与放置路径（docs/analysis/.md）；明确非目标（不改代码）
- 阶段 1（架构骨架）：以引用为节点撰写分层说明，每条引用 path:line 均可点击
-   - 后端入口：backend/cmd/server/main.go:17-39
-   - 存储层：backend/internal/storage/sqlite.go:13-31（schema 与 PRAGMA）
-   - 领域层：backend/internal/document/{model,repository,sqlite_repository,processor}.go 的 5 文件分工
-   - 传输层：backend/internal/httpapi/server.go:33-156 路由/解码/CORS 全清单
-   - AI 抽象：backend/internal/ai/provider.go:1-27 接口清单与 501 路由（server.go:50-52）
-   - 前端入口链：desktop/src/main.tsx → App.tsx → AppRouter → AppLayout → Pages
-   - 桌面壳：desktop/src-tauri/src/main.rs:1-3 + nativeBrowser.ts:20-80 invoke 契约
- 阶段 2（关键流程图）：
-   - 图 A：文档生命周期（client → createDocument → Repository.Create → Processor.Enqueue → Processor.Run → status 翻转 → 客户端 30×200ms 轮询 → FTS5 检索）
-   - 图 B：浏览器多标签状态机（newTab / openNewTab / activateTab / closeTab / sync timer / ResizeObserver / 键盘快捷键）
-   - 图 C：阅读器流水线（captureNativePage → DOMParser + Readability → 净化 → Turndown → ReaderArticle）
-   - 图 D：前端视图路由（main → App → AppRouter → 5 视图 → 共享组件 → 数据源 Tauri/REST/降级）
-   - 图 E：搜索防抖链路（SearchPage → setTimeout 250ms → listDocuments → List + ftsQuery）
- 阶段 3（符号清单）：按模块分组输出每条 SYMBOL 的 path:line 与一句话职责，证据来源为提供的 184 条 SYMBOL 索引
- 阶段 4（跨层调用矩阵）：构造 5×N 表格，行=后端模块，列=前端契约，单元格写明共享契约（如 /api/v1/documents、Document、Tauri command 'local_save_document' 等）
- 阶段 5（差距清单）：
-   - AI Provider 接口已声明但未实现（backend/internal/ai/provider.go:1-27 vs server.go:50-52）
-   - Tauri commands 调用方已写但注册未覆盖（desktop/src/services/nativeBrowser.ts:20-80 vs desktop/src-tauri/src/main.rs:1-3）
-   - 浏览器 saveDocument 占位 markdown='Captured by Reader pipeline.'（desktop/src/pages/browser/BrowserPage.tsx:205）
-   - FTS5 query 未转义操作符（backend/internal/document/sqlite_repository.go:195-201）
-   - CORS 仅放行 http://localhost:1420（backend/internal/httpapi/server.go:149）
-   - Processor 错误仅 log.Printf 不上报（backend/internal/document/processor.go:48,66）
-   - collections/ARCHIVED 接口缺失（backend/internal/document/model.go:12 vs server.go 路由）
-   - Knowledge 双存储未同步（README.md:93-101 vs backend/internal/storage/sqlite.go:13）
- 阶段 6（验证）：
-   - 文档章节存在性：通过 find/grep 校验 5 大章节与图标题
-   - 引用有效性：抽取文档中所有 path:line，用脚本校验文件存在与行号命中
-   - 流程图可渲染：在 Markdown 预览/Mermaid Live 中逐图渲染确认无语法错误
-   - 非目标保持：git diff 确认无业务代码变更
- 阶段 7（交付）：在 PR 描述中附「分析交付物链接 + 引用清单 + 流程图缩略图」，由产品/研发 review

## 风险与待确认

- 「分析代码，使用流程图」是仅产出静态文档，还是要求嵌入 CI/工具链（如 typedoc、go doc、madge、vite-plugin-docgen）以保持文档随代码自动更新？
- 流程图交付格式：仓库内 Markdown + Mermaid（便于版本管理），还是导出 SVG/PNG（需新增构建步骤）？
- 分析范围：是覆盖全量 127 文件 / 184 符号 / 391 调用关系，还是聚焦某一子系统（浏览器、阅读器、知识库、AI、桌面壳）？
- 是否需要同时交付后端（Go）与前端（TS）两侧的调用图，或仅交付一张跨层总图？
- 「分析」是否要求量化指标（Processor 队列容量 128 / Reader 净化规则数 / API 端点数 / 视图数）作为文档章节，还是纯结构梳理？
- 文档放置路径：docs/analysis/、specs/feature-/、还是 README 章节？是否影响后续 Spec Kit 工作流？
- 是否需要将本期分析作为后续实现迭代（AI Provider 接入、Tauri commands 补齐、Reader 安全加固）的前置输入？
- 对 Tauri 桌面壳当前 lib.rs 仅 lib::run()（desktop/src-tauri/src/main.rs:1-3）这一事实，分析文档应如何呈现「未注册命令」与「已被前端调用的命令」之间的差距？
- AI 占位接口（backend/internal/httpapi/server.go:50-52）当前无 Provider 实现，分析文档应将其作为「设计已就绪 / 实现未落地」还是「差距」标记？
- 桌面 SQLite（src-tauri/src/local_store.rs，README.md:93-101）与 Go 服务端 SQLite（backend/internal/storage/sqlite.go:13-31）是两套独立存储，分析文档是否需明确「双存储且未同步」这一现状？

## 规格来源

# 新建需求 6

## 用户场景

分析代码，使用流程图

## 功能需求

- 待补充

## 验收标准

- [ ] [AC-01] 待补充可观察、可测试的结果

## 非目标

- 待补充

