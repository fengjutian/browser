# browser 产品需求文档

> 基于本地代码自动生成 · 2026/9/14 · 生成后请由产品与研发共同确认

## 产品概述
本地代码库实现了一款名为 "Arcadia"（中文产品名：AI 知识浏览器）的桌面端知识管理与浏览器一体化应用原型。后端为 Go 1.24 + SQLite（modernc.org/sqlite，纯 Go 驱动）+ REST API，提供文档 CRUD、SQLite FTS5 全文检索、标签关系、文档处理流水线（PENDING→PROCESSING→READY/FAILED）、健康检查、知识库统计、AI 占位接口、插件占位接口；前端为 React 19 + TypeScript + Ant Design 6 + Vite，桌面壳为 Tauri 2。品牌色为深绿，UI 全部为中文，当前实现仍处于 UI 原型 + 后端核心域阶段，AI 与插件能力为占位。

## 技术与业务边界
- 桌面壳：Tauri 2（src-tauri/src/main.rs），开发端口 1420（desktop/vite.config.ts:1-3），CORS 仅放行 http://localhost:1420（backend/internal/httpapi/server.go:148-156）
- 前端入口：desktop/src/main.tsx → App.tsx（Ant Design ConfigProvider，zh_CN，深绿主色 #347851）→ AppRouter（5 个视图：browser/library/search/ai/settings，desktop/src/app/AppRouter.tsx:9-14）
- API 客户端：desktop/src/api.ts 指向 http://127.0.0.1:8787/api/v1，提供 listDocuments/saveDocument/getDocument 三个端点；desktop/src/features/documents/documentService.ts 在 API 失败时回退到 demoDocuments（mock.ts）
- 后端进程：backend/cmd/server/main.go:17-39 读取 AKB_ADDR（默认 127.0.0.1:8787）与 AKB_DATA_DIR（默认 data），初始化 SQLite、仓库、Processor（容量 128），后台 Run 处理文档，再启动 HTTP 服务器
- 持久层：backend/internal/storage/sqlite.go:13-31 启用 WAL/foreign_keys/busy_timeout=5000ms，migrate 创建 documents、tags、document_tags 三表 + documents_fts 虚拟表（unicode61 分词）+ created_at DESC 索引
- 领域层：backend/internal/document 包含 model.go（5 状态枚举 Document/CreateInput/UpdateInput）、processor.go（基于 sync.Map 去重的内存队列，128 缓冲）、repository.go（MemoryRepository 用于测试）+ sqlite_repository.go（FTS5 查询使用 "term"* 前缀通配并以 AND 连接）
- 传输层：backend/internal/httpapi/server.go 用 net/http ServeMux 注册 /api/v1/{health,documents,documents/{id},search,knowledge/search,knowledge,plugins} 以及 4 个 501 占位路由 ai/chat|summary|translate|agent/run
- AI 抽象：backend/internal/ai/provider.go 仅定义 LLM/Embedding/Reranker 接口与 ChatRequest/Message/ChatResponse 类型，未接入任何 provider；后端路由统一返回 501 provider_not_configured
- 阅读器模块：desktop/src/features/reader/extractArticle.ts 调用 @mozilla/readability 提取正文后用 turndown 转 Markdown，并把 [src]/[href] 解析为绝对 URL

## 功能需求
- 用户可在浏览器视图中输入 URL/关键字进入标签页，浏览器提供返回/前进/刷新、AI 助手侧栏切换、保存到知识库按钮（desktop/src/pages/browser/BrowserPage.tsx:6-12, 15-19, 23-27）
- 用户点击「保存到知识库」后，前端调用 POST /api/v1/documents 写入草稿，并以 200ms 间隔最多 30 次轮询 GET /api/v1/documents/{id}，按 status==READY 成功、status==FAILED 报错，否则提示仍在处理（desktop/src/pages/browser/BrowserPage.tsx:13-21）
- 用户可在知识库视图查看最近保存文档，每张卡片展示来源、字数（前 3 个标签 + 标题 + 摘要/正文摘要，desktop/src/features/documents/DocumentCard.tsx:4）
- 用户可在搜索视图输入关键字，250ms 防抖后命中 SQLite FTS5，命中后端不可用时切换到本地演示数据过滤（desktop/src/pages/search/SearchPage.tsx:8-21）
- 后端在创建文档时校验 title 与 url 非空（TrimSpace 后非空），缺失返回 400 validation_error；JSON 体上限 1 MiB 并禁用未知字段（backend/internal/httpapi/server.go:58-72, 131-135）
- 后端文档初始状态为 PENDING；Processor 将其置为 PROCESSING，若 Markdown 与 Content 同时为空则置 FAILED，否则用非空 Markdown 更新并置 READY（backend/internal/document/processor.go:45-66）
- 后端实现 SQLite 持久化，WAL + foreign_keys + busy_timeout=5000；标签写入前 trim+去重（cleanTags），并以 document_tags 多对多关系存储（backend/internal/storage/sqlite.go:13-31, backend/internal/document/sqlite_repository.go:22-44, 162-172）
- 后端搜索：对 query 用 strings.Fields 切词后，每项包装为 "term"* 并以 AND 连接进入 FTS5 MATCH；List 携带 GROUP BY 聚合标签（backend/internal/document/sqlite_repository.go:47-67, 195-201）
- 后端 Processor 队列容量 128；Enqueue 先用 sync.Map LoadOrStore 去重，通道满时移除标记并返回 false，使 API 返回 503 queue_full（backend/internal/document/processor.go:22-30, backend/internal/httpapi/server.go:68-70）
- 后端暴露健康检查 GET /api/v1/health（返回 status=ok, version=0.1.0）、知识库统计 GET /api/v1/knowledge（返回 documents 数 / 去重 tags 数 / collections=0）、插件清单 GET /api/v1/plugins（runtimeAvailable=false, items=[]）
- AI 助手页（AssistantPage）与设置页（SettingsPage）提供 UI 框架：设置页含 AI Provider 表单（未配置 / OpenAI Compatible / Ollama），但 4 条 AI 路由均返回 501 provider_not_configured（backend/internal/httpapi/server.go:50-52, desktop/src/pages/settings/SettingsPage.tsx:4-11）
- 桌面阅读器（extractArticle）使用 Mozilla Readability 解析并以 Turndown 转为 Markdown，将所有 [src]/[href] 解析为绝对 URL；空正文抛出 reader_content_not_found（desktop/src/features/reader/extractArticle.ts:7-26）

## 验收标准
- [ ] 用户可在浏览器视图中输入 URL/关键字进入标签页，浏览器提供返回/前进/刷新、AI 助手侧栏切换、保存到知识库按钮（desktop/src/pages/browser/BrowserPage.tsx:6-12, 15-19, 23-27）
- [ ] 用户点击「保存到知识库」后，前端调用 POST /api/v1/documents 写入草稿，并以 200ms 间隔最多 30 次轮询 GET /api/v1/documents/{id}，按 status==READY 成功、status==FAILED 报错，否则提示仍在处理（desktop/src/pages/browser/BrowserPage.tsx:13-21）
- [ ] 用户可在知识库视图查看最近保存文档，每张卡片展示来源、字数（前 3 个标签 + 标题 + 摘要/正文摘要，desktop/src/features/documents/DocumentCard.tsx:4）
- [ ] 用户可在搜索视图输入关键字，250ms 防抖后命中 SQLite FTS5，命中后端不可用时切换到本地演示数据过滤（desktop/src/pages/search/SearchPage.tsx:8-21）
- [ ] 后端在创建文档时校验 title 与 url 非空（TrimSpace 后非空），缺失返回 400 validation_error；JSON 体上限 1 MiB 并禁用未知字段（backend/internal/httpapi/server.go:58-72, 131-135）
- [ ] 后端文档初始状态为 PENDING；Processor 将其置为 PROCESSING，若 Markdown 与 Content 同时为空则置 FAILED，否则用非空 Markdown 更新并置 READY（backend/internal/document/processor.go:45-66）
- [ ] 后端实现 SQLite 持久化，WAL + foreign_keys + busy_timeout=5000；标签写入前 trim+去重（cleanTags），并以 document_tags 多对多关系存储（backend/internal/storage/sqlite.go:13-31, backend/internal/document/sqlite_repository.go:22-44, 162-172）
- [ ] 后端搜索：对 query 用 strings.Fields 切词后，每项包装为 "term"* 并以 AND 连接进入 FTS5 MATCH；List 携带 GROUP BY 聚合标签（backend/internal/document/sqlite_repository.go:47-67, 195-201）
- [ ] 后端 Processor 队列容量 128；Enqueue 先用 sync.Map LoadOrStore 去重，通道满时移除标记并返回 false，使 API 返回 503 queue_full（backend/internal/document/processor.go:22-30, backend/internal/httpapi/server.go:68-70）
- [ ] 后端暴露健康检查 GET /api/v1/health（返回 status=ok, version=0.1.0）、知识库统计 GET /api/v1/knowledge（返回 documents 数 / 去重 tags 数 / collections=0）、插件清单 GET /api/v1/plugins（runtimeAvailable=false, items=[]）
- [ ] AI 助手页（AssistantPage）与设置页（SettingsPage）提供 UI 框架：设置页含 AI Provider 表单（未配置 / OpenAI Compatible / Ollama），但 4 条 AI 路由均返回 501 provider_not_configured（backend/internal/httpapi/server.go:50-52, desktop/src/pages/settings/SettingsPage.tsx:4-11）
- [ ] 桌面阅读器（extractArticle）使用 Mozilla Readability 解析并以 Turndown 转为 Markdown，将所有 [src]/[href] 解析为绝对 URL；空正文抛出 reader_content_not_found（desktop/src/features/reader/extractArticle.ts:7-26）

## 当前实现与影响范围
- **backend/internal/document/processor.go**（MEDIUM）— 队列容量 128、错误仅 log.Printf 不上报、未持久化任务状态；崩溃或重启会丢失 PENDING/PROCESSING 中的文档
- **backend/internal/httpapi/server.go**（HIGH）— AI 路由统一返回 501，与 SettingsPage/AssistantPage 的 UI 承诺不一致；用户期望与实现差距大
- **backend/internal/document/sqlite_repository.go**（MEDIUM）— FTS5 查询 ftsQuery 未转义操作符（NEAR/^/:/column:），多词或含特殊字符的 query 可能抛错或返回异常
- **backend/internal/httpapi/server.go**（LOW）— CORS 写死 http://localhost:1420，生产构建（tauri build）后无法跨域访问后端；需在 Tauri 化时替换为自定义 scheme 或回环白名单
- **backend/internal/document/model.go**（LOW）— CollectionID 字段与 ARCHIVED 状态已声明，但 /api/v1/collections 与 ARCHIVED 流转接口缺失
- **backend/internal/ai/provider.go**（MEDIUM）— 接口已定义但无任何实现，Provider 选型未定将阻塞整个 AI 闭环
- **desktop/src/pages/browser/BrowserPage.tsx**（MEDIUM）— saveDocument 提交 markdown='Captured by Reader pipeline.' 占位，extractArticle.ts 未被调用；保存=占位数据，破坏「保存网页到知识库」核心场景
- **desktop/src/pages/library/LibraryPage.tsx**（LOW）— 统计中「集合 6」与「已保存 18.4k 字」为硬编码常量，与真实数据脱节
- **desktop/src-tauri/src/main.rs**（MEDIUM）— Tauri 2 桌面壳仅 lib::run()，capability/插件权限模型尚未落地，桌面发布阻塞
- **backend/internal/storage/sqlite.go**（LOW）— 未启用 PRAGMA secure_delete、同步模式 NORMAL（依赖 WAL），无备份/归档策略，长期运行需关注磁盘与一致性

## 待确认问题
- 产品最终品牌是英文 Arcadia（desktop/src/layouts/AppLayout.tsx:7）还是中文「AI 知识浏览器」（README.md:1）？是否需要双品牌策略？
- 后端 AI 路由明确返回 501，但 desktop/src/pages/settings/SettingsPage.tsx:8 暴露 OpenAI Compatible 与 Ollama 两个 Provider 选项；目标首个上线的 Provider、模型清单与密钥存储后端是什么？
- GET /api/v1/knowledge 返回 collections:0 且 collection_id 字段已落库（backend/internal/httpapi/server.go:121-127、backend/internal/storage/sqlite.go:36），但没有任何集合管理接口；集合功能是后续迭代还是本期 MVP？
- 浏览器视图的「保存到知识库」写入 markdown='Captured by Reader pipeline.' 占位（desktop/src/pages/browser/BrowserPage.tsx:13-21），真正的 HTML→Markdown 抓取（extractArticle.ts）由谁、何时调用？Tauri 插件？还是后端 fetcher？
- 搜索是否需要支持按标签筛选、语义检索（Reranker/Embedding 接口已声明 backend/internal/ai/provider.go:21-25）？当前仅有关键字 FTS5（mode:'keyword'，backend/internal/httpapi/server.go:118）
- 后端 SQLite 使用 modernc.org/sqlite 且无并发写入上限，Processor 仅 1 个消费者（backend/internal/document/processor.go:34-43）；多 worker、优先级、重试与死信队列是否在范围内？
- 认证/授权：API 完全无鉴权（backend/internal/httpapi/server.go 全文未出现 Auth/JWT/Session），本地单用户可接受，未来扩展是否需要多用户隔离？
- 文档删除是硬删（backend/internal/document/sqlite_repository.go:124-141），与状态枚举 ARCHIVED（backend/internal/document/model.go:12）如何协调？是否需要软删除/回收站？
- CORS 仅放行 http://localhost:1420（backend/internal/httpapi/server.go:149），生产 Tauri 构建后如何处理跨域？WebView 内仍走 127.0.0.1:8787 是否需要鉴权/Origin 校验？
- FTS5 查询字符串直接拼接 "term"*（backend/internal/document/sqlite_repository.go:195-201），未转义 FTS5 操作符（如 NEAR、^、:），是否存在注入或解析异常风险？
- 桌面端当前依赖 @tauri-apps/api ^2.8.0 但 src-tauri/src/main.rs:1-3 仅调用 lib::run()；Tauri 插件权限模型是否已就绪？（README.md:14 提到「Tauri 2 / Rust 工程与插件权限模型占位」）

## 后续计划
- 阶段 0（已完成，证据）：后端核心域 + REST 路由 + SQLite/FTS5 + Processor + CORS；前端 5 视图骨架 + API 客户端 + 演示数据回退 + 阅读器模块 + Tauri 占位
- 阶段 1：补齐 webview→后端的 HTML 抓取与持久化链路（Reader → saveDocument 真实接入 extractArticle 输出），把当前占位 markdown='Captured by Reader pipeline.' 替换为真实 Markdown，并扩展 DocumentCard 摘要来源（desktop/src/pages/browser/BrowserPage.tsx:13-21, desktop/src/features/reader/extractArticle.ts:7-26）
- 阶段 2：实现首个 AI Provider（OpenAI Compatible 或 Ollama，二选一），把 /api/v1/ai/{chat,summary,translate} 从 501 升级为真实调用；后端实现 backend/internal/ai/provider.go:18-20 LLM 接口的具体 Adapter；桌面设置页 Provider 选择与设置页 Base URL/Model/API Key 表单接入（desktop/src/pages/settings/SettingsPage.tsx:7-11）
- 阶段 3：补齐 collections 与标签筛选：实现 GET/POST/PUT/DELETE /api/v1/collections、文档绑定接口；搜索支持 ?tag= 与 mode=semantic（接入 Embedding+Reranker 接口 backend/internal/ai/provider.go:21-25）
- 阶段 4：Tauri 2 壳接通：完成 src-tauri 端权限声明、capability 文件，启用系统 WebView 加载桌面 UI；移除开发期 CORS 例外，改为 Tauri 自定义协议或 127.0.0.1 直连 + Origin 校验
- 阶段 5：检索质量与边界：对 FTS5 查询做操作符转义；Processor 引入指数退避重试与 ARCHIVED 跳过；为 SQLite 增加定期 VACUUM/备份策略
- 阶段 6：补 E2E：当前仅有 HTTP 层（TestHealth/TestDocumentLifecycle/TestCreateSelection）与 Processor 单测（TestProcessorMarks*）与 SQLite 单测（TestSQLiteRepositoryPersistsAndSearches），新增 UI/端到端保存→轮询→READY 流程测试

## 代码依据
- `README.md:1` — 产品定位「以浏览器为入口、知识库为核心、AI 为智能层的桌面知识浏览器」与中文产品名依据
- `backend/cmd/server/main.go:17` — 后端入口、默认端口 127.0.0.1:8787、默认数据目录 data、Processor 容量 128
- `backend/internal/document/model.go:5` — 5 个文档状态枚举 PENDING/PROCESSING/READY/FAILED/ARCHIVED
- `backend/internal/document/processor.go:45` — 处理流水线规则：置 PROCESSING→Markdown 空时用 Content→仍空置 FAILED→否则置 READY
- `backend/internal/document/sqlite_repository.go:47` — List 通过 documents_fts MATCH + GROUP BY 聚合标签实现搜索
- `backend/internal/document/sqlite_repository.go:195` — FTS5 查询使用 "term"* 前缀通配并 AND 连接
- `backend/internal/document/sqlite_repository.go:162` — cleanTags：trim + 去重 + 丢弃空串
- `backend/internal/storage/sqlite.go:13` — 启用 WAL、foreign_keys=1、busy_timeout=5000ms 的 SQLite 打开策略
- `backend/internal/storage/sqlite.go:32` — 迁移表 documents/tags/document_tags + documents_fts(unicode61) + created_at DESC 索引
- `backend/internal/httpapi/server.go:33` — REST 路由清单与 4 条 AI 占位 501 路由
- `backend/internal/httpapi/server.go:58` — createDocument 校验 title/url 非空，返回 400 validation_error
- `backend/internal/httpapi/server.go:68` — Enqueue 失败时返回 503 queue_full
- `backend/internal/httpapi/server.go:120` — GET /api/v1/knowledge 返回 documents/tags 数 + collections=0
- `backend/internal/httpapi/server.go:131` — decode：1MiB LimitReader + DisallowUnknownFields
- `backend/internal/httpapi/server.go:148` — CORS 仅放行 http://localhost:1420 + OPTIONS 204
- `backend/internal/ai/provider.go:18` — LLM/Embedding/Reranker 接口已声明但未实现，对应 501 占位
- `backend/internal/document/processor_test.go:9` — 验收用例：Processor 在 1s 内将文档置 READY 并把 content 复制到 markdown
- `backend/internal/document/processor_test.go:26` — 验收用例：空 markdown+content 在 1s 内被置 FAILED
- `backend/internal/httpapi/server_test.go:13` — 验收用例：GET /api/v1/health 返回 200
- `backend/internal/httpapi/server_test.go:21` — 验收用例：POST 创建文档返回 201 + 可通过 GET 拿回
- `backend/internal/httpapi/server_test.go:39` — 验收用例：空 title 创建返回 400
- `backend/internal/document/sqlite_repository_test.go:12` — 验收用例：SQLite 持久化跨 Open/Close 后 FTS 搜索可命中 1 条带 2 个标签
- `desktop/src/app/AppRouter.tsx:9` — 前端 5 视图（browser/library/search/ai/settings）路由
- `desktop/src/layouts/AppLayout.tsx:7` — 英文品牌 Arcadia 与侧栏中文菜单 浏览器/知识库/搜索/AI Research/设置
- `desktop/src/App.tsx:4` — Ant Design ConfigProvider，zh_CN，主色 #347851、侧栏 #16241f
- `desktop/src/api.ts:2` — 前端 API BASE http://127.0.0.1:8787/api/v1，提供 list/save/get 三个端点
- `desktop/src/features/documents/documentService.ts:4` — API 失败回退 demoDocuments 的离线降级行为
- `desktop/src/pages/browser/BrowserPage.tsx:13` — 保存逻辑：POST 文档→最多 30 次/200ms 轮询等待 READY/FAILED 的产品行为
- `desktop/src/pages/search/SearchPage.tsx:8` — 搜索 250ms 防抖 + 后端失败切演示数据
- `desktop/src/features/reader/extractArticle.ts:7` — 阅读器模块：Mozilla Readability + Turndown + 绝对 URL 解析
- `desktop/src/pages/library/LibraryPage.tsx:7` — 知识库统计：文档数（实时）+ 集合数 6（硬编码）+ 已保存字数 18.4k（硬编码）
- `desktop/src/pages/settings/SettingsPage.tsx:4` — 设置页 AI Provider 选项：未配置/OpenAI Compatible/Ollama（本地）
- `desktop/src/mock.ts:2` — 演示数据：3 篇预置文档，用于 API 不可用时降级渲染
- `desktop/package.json:10` — 前端依赖：antd v6、react 19、turndown、@mozilla/readability、@tauri-apps/api v2
- `desktop/vite.config.ts:1` — Vite dev server 端口 1420（与 Tauri 默认一致，与 CORS 策略匹配）
- `desktop/src-tauri/src/main.rs:1` — Tauri 2 桌面壳入口，仅调用 lib::run()，业务尚未接入

## 非功能需求
- 保持现有安全边界、错误处理与兼容性
- 关键流程应具备可重复执行的自动化验证
- 性能指标与数据规模需由产品和研发共同量化

## 非目标
- 本文档不代表未经确认的代码行为一定是正确的产品需求
- 不包含无法从当前本地代码推断的商业策略与运营规则
