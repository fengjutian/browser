# AI Knowledge Browser 产品需求文档

版本：v1.0（工程化整理版）  
状态：开发中  
目标平台：Windows / macOS / Linux

## 1. 产品愿景

AI Knowledge Browser 是一款以浏览器为入口、以个人知识库为核心、以 AI 为智能层的桌面知识工具。它不试图替代 Chrome，而是将“浏览、理解、保存、检索、问答、研究”串成一个持续积累的闭环。

核心价值主张：

> 打开网页，AI 帮我读；一键保存，系统帮我整理；以后能搜索、引用、比较并继续研究。

## 2. 用户与核心场景

目标用户包括技术人员、研究人员、产品经理、咨询与投研等知识工作者。

核心场景：

1. 阅读网页时快速获得摘要、翻译、解释和页面问答。
2. 将网页清洗为可长期保存的 Markdown 文章。
3. 通过全文、语义和混合搜索找回历史资料。
4. 基于个人知识库进行带来源引用的跨文档问答。
5. 由 Agent 执行搜索、阅读、去重、总结和报告生成。

## 3. 产品范围

### P0：可用的知识阅读闭环

- Browser：Tab、地址栏、前进/后退、刷新、标题、favicon、加载状态。
- Reader：正文提取、噪音清理、HTML 转 Markdown、本地阅读。
- Knowledge：文章保存、SQLite、全文搜索、标签、集合。
- AI：页面总结、问答、翻译、自动标签；Provider 可配置。
- Privacy：广告/追踪请求规则、统计面板。
- Backend：Go HTTP API、文档/知识/搜索/AI 服务。
- Plugin：仅 Manifest、权限、注册表和 UI 占位。

### P1：知识增强

- Embedding、向量搜索、混合召回、Reranker、RAG。
- 跨文章问答、AI Research、Browser Agent、MCP Client。
- PDF 保存、Markdown 导入、截图。

### P2：生态与云

- 插件 Runtime/Marketplace/WASM/JavaScript SDK。
- 多设备同步、PostgreSQL/pgvector、团队知识库、本地模型。

## 4. 关键用户流程

### 阅读与保存

1. 用户输入 URL 或打开新标签页。
2. WebView 加载页面，隐私层过滤请求并统计。
3. 用户打开 Reader，系统提取标题、作者、正文、媒体和代码块。
4. 用户可请求摘要、翻译或页面问答。
5. 点击“保存”，客户端立即创建文档；后端异步执行清洗、分块、索引、摘要与标签。
6. UI 展示 `Saving → Extracting → Indexing → Saved`，失败时允许重试或保存原始页面。

### 知识库检索与问答

1. 用户输入自然语言或关键词。
2. P0 使用 SQLite FTS；P1 并行执行 BM25 与向量召回。
3. 结果融合与重排后形成上下文。
4. LLM 基于上下文回答，并返回文章标题、URL 和相关片段。
5. 没有证据时明确说明知识库中未找到依据。

## 5. 功能需求与验收标准

### Browser

- 可创建、切换、关闭标签，并恢复最近关闭的标签。
- 地址栏识别 URL 与搜索词；导航操作有禁用和加载反馈。
- 页面发起新窗口时默认在应用内新标签打开。
- 网页不可直接访问知识库、文件系统、密钥或未授权原生命令。

### Reader

- 输出 title、author、publishedAt、contentHtml、markdown、wordCount、leadImage。
- 保留图片、代码、引用与表格，移除导航、推荐、评论和常见弹窗。
- 提取失败可保存原始页面，并允许用户重试。

### Knowledge

- 文档状态：`PENDING / PROCESSING / READY / FAILED / ARCHIVED`。
- 支持文档 CRUD、标签、集合、收藏和本地文章阅读。
- P0 全文搜索目标 p95 ≤ 300ms；保存正文 p95 ≤ 5s，不等待 AI。
- 删除、批量覆盖等高风险操作必须二次确认。

### AI

- 摘要支持一句话、简短、详细和核心观点四种模式。
- 页面问答只使用当前页面上下文；知识问答必须返回引用。
- LLM、Embedding、Reranker 通过接口注入，支持自定义 Base URL。
- API Key 存放在系统安全存储，不进入前端包、日志或版本库。

### Privacy

- 支持 URL、域名、Tracker 和 Cosmetic 规则模型。
- 展示当前站点与全局的广告、追踪器、分析请求拦截数。
- 允许按站点暂停保护，并清楚提示风险。

### Plugin（占位）

- 定义 Manager、Registry、Manifest、Context、Permission、Runtime 接口。
- V1 `/api/v1/plugins` 返回空列表；设置页显示 Coming Soon。
- 所有未来 API 都以显式权限为参数，不在 V1 执行第三方代码。

## 6. 数据模型

主实体：Document、Chunk、Collection、Tag、Asset、Embedding、Task。数据库定义见 `backend/migrations/001_init.sql`。

文档最小字段：id、title、url、source、author、published_at、language、content、markdown、summary、cover_image、word_count、status、created_at、updated_at。

## 7. 非功能要求

- 冷启动目标 ≤ 2s；普通页面打开目标 ≤ 3s（网络条件允许）。
- 浏览、Reader 和全文搜索可离线；配置本地模型后 AI 可离线。
- 所有异步操作必须提供 Loading、Success、Failed、Retry 状态。
- 日志结构化、可滚动、默认脱敏，严禁输出 Authorization 与 API Key。
- 本地数据是用户资产；升级必须有向前迁移与可恢复备份。

## 8. 成功指标

- 首次使用 5 分钟内完成“打开文章 → 摘要 → 保存 → 搜索找回”。
- 保存成功率 ≥ 98%，Reader 对常见文章站点提取成功率 ≥ 90%。
- 30 日用户中，保存后的文档再次被搜索/问答引用比例持续提升。
- RAG 回答引用覆盖率 100%，引用点击可回到对应文档段落。

## 9. 风险与边界

- Tauri 使用系统 WebView，不同平台能力与网络拦截接口存在差异，需要平台适配层。
- 动态站点、登录墙和反爬机制可能降低正文提取质量。
- EasyList 规则许可、更新与性能需要独立评审。
- V1 不承诺 Chrome Extension 兼容、云同步、多人权限或完整插件执行环境。

## 10. 里程碑

- M1 Foundation：仓库、UI Shell、Go API、Tauri 命令桥、测试与 CI。
- M2 Reader：提取、清洗、Markdown、Reader UI、保存原文。
- M3 Knowledge：SQLite/FTS、任务队列、标签与集合、搜索 UI。
- M4 AI：Provider 配置、摘要/问答/翻译/标签、密钥安全存储。
- M5 Privacy：请求过滤、规则更新、站点开关和统计。
- M6 RAG/Agent：混合搜索、引用问答、MCP 与受控 Agent。

## 11. 当前迭代 Definition of Done

- 文档、架构与 API 契约已落盘。
- 前端可展示 Browser、Library、Search、AI、Settings 五个主要入口并完成核心交互原型。
- Go API 可运行且核心路由有自动化测试。
- Rust 插件占位类型可单元测试；不实现第三方运行时。
