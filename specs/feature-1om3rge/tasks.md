# 新建需求 3 任务清单

## 实现

- [ ] T001 阶段 0（澄清边界）：与产品/研发对齐范围（仅文档 / 含工具链 / 含量化指标）；确认产出格式（Markdown + Mermaid）与放置路径（docs/analysis/ 或 specs/feature-*/）；明确非目标（不改代码、不新增依赖、不改 build 脚本）；输出对齐纪要
- [ ] T002 阶段 1（架构骨架）：撰写 7 个分层章节，每条引用 path:line 均可点击；分层为后端入口 / 存储层 / 领域层 / 传输层 / AI 抽象 / 前端入口链 / 桌面壳
- [ ] T003 阶段 2（关键流程图）：图 A 文档生命周期（client → POST /api/v1/documents → createDocument 校验 → Repository.Create 事务 → processor.Enqueue LoadOrStore 去重 → 容量 128 chan 满 503 → Run loop → PROCESSING → Markdown 空则 Content → 仍空 FAILED → 否则 READY → client 30×200ms poll GET → FTS5 检索）；图 B 浏览器多标签状态机（newTab/openNewTab/activateTab/closeTab/sync timer 750ms/ResizeObserver/onKeyDown window）；图 C 阅读器流水线（captureNativePage → DOMParser + Readability → 净化 → Turndown → ReaderArticle）
- [ ] T004 阶段 3（符号清单）：按模块分组输出每条 SYMBOL 的 path:line 与一句话职责，覆盖 backend/cmd/server（main.go:17）、backend/internal/ai（ChatRequest/Message/ChatResponse/LLM/Embedding/Reranker，provider.go:5-27）、backend/internal/document（Status/Document/CreateInput/UpdateInput/Processor/Repository/MemoryRepository/SQLiteRepository/scanner）、backend/internal/httpapi（Server/Handler/routes/listDocuments/createDocument/getDocument/updateDocument/deleteDocument/search/searchPost/writeSearch/knowledge/decode/writeJSON/writeError/notImplemented/cors）、backend/internal/storage（Open/migrate）、desktop/src（App/AppRouter/AppLayout + 5 视图 + DocumentCard/DocumentDetailDrawer/documentService + extractArticle/types + nativeBrowser + api/types）
- [ ] T005 阶段 4（跨层调用矩阵）：5 行 × N 列，行=backend/cmd/server/main.go、storage、document、httpapi、ai，列=Document 模型、Tauri command 'local_*'、REST 端点 '/api/v1/{health,documents,documents/{id},search,knowledge,plugins,ai/*}'、共享状态枚举
- [ ] T006 阶段 5（差距清单）：列出 8 项——AI Provider 接口已声明但未实现、Tauri commands 调用方已写但注册未覆盖、浏览器 saveDocument 提交 markdown 占位、FTS5 query 未转义操作符、CORS 仅放行 http://localhost:1420、Processor 错误仅 log.Printf 不上报、collections/ARCHIVED 接口缺失、双存储未同步
- [ ] T007 阶段 6（验证）：文档章节存在性（grep 校验 7 分层 + 3 流程图 + 符号清单 + 调用矩阵 + 差距清单 + 非目标 + 待确认）；引用有效性（脚本校验 path:line 命中索引）；流程图可渲染（Mermaid Live 逐图校验）；非目标保持（git diff 确认无业务代码变更）
- [ ] T008 阶段 7（交付）：在 PR 描述中附「分析交付物链接 + 引用清单 + 流程图缩略图」，由产品/研发 review；保留产物可被后续 feature-1811ek3/feature-17r1sv4 复用

## 验证

- [ ] T009 验证：阶段 1 交付：架构骨架章节，按 7 个分层撰写，每条引用 path:line 必须可点击跳转
- [ ] T010 验证：阶段 2 交付：3 张 Mermaid 流程图（文档生命周期 / 浏览器多标签状态机 / 阅读器流水线），覆盖客户端→后端→Processor 状态翻转→前端轮询→FTS5 检索的完整链路
- [ ] T011 验证：阶段 3 交付：按模块分组的符号清单，列出全部 184 个 SYMBOL 的 path:line 与一句话职责
- [ ] T012 验证：阶段 4 交付：跨层调用矩阵（5 行 × N 列），行=后端 5 个模块（cmd_server/storage/document/httpapi/ai），列=Document 模型 / Tauri command 'local_*' / REST 端点 '/api/v1/{health,documents,documents/{id},search,knowledge,plugins,ai/*}' / 共享状态枚举
- [ ] T013 验证：阶段 5 交付：差距清单，明确列出 8 项可观察差距（AI Provider 接口未实现 / Tauri commands 调用方已写但 lib.rs 注册覆盖 / saveDocument markdown 占位 / FTS5 query 未转义操作符 / CORS 仅放行 1420 / Processor 错误仅 log.Printf 不上报 / collections 与 ARCHIVED 接口缺失 / 双存储未同步）
- [ ] T014 验证：阶段 6 交付：可验证标准——grep 校验章节存在性、脚本校验 path:line 命中索引、Mermaid Live 校验图可渲染、git diff 确认无业务代码变更
- [ ] T015 验证：阶段 7 交付：PR 描述附「分析交付物链接 + 引用清单 + 流程图缩略图」，由产品/研发 review，产物可被 feature-1811ek3/feature-17r1sv4 复用
- [ ] T016 验证：非目标：明确不改任何业务代码（backend/* / desktop/src/* / desktop/src-tauri/src/* 全部仅阅读）、不新增依赖、不改 build 脚本、不嵌入 CI/工具链（typedoc/go doc/madge/vite-plugin-docgen）
