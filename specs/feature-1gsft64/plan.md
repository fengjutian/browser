# 浏览器优化 实施计划

## 摘要

当前规格「浏览器优化」的用户场景、功能需求、验收标准和非目标均为「待补充」占位，本分析基于代码库中已实现的浏览器子系统的真实行为，提炼出可观察的优化候选点（多标签状态、地址栏、原生 WebView 生命周期、阅读模式、AI 面板、键盘快捷键、保存到知识库）并给出架构、影响、实施步骤与风险，所有结论均带引用。

## 技术上下文

- 桌面壳层：Tauri 2 入口 desktop/src-tauri/src/main.rs:1-3（仅 lib::run()，commands/permissions 未落地），通过 invoke 暴露本地 SQLite 与浏览器命令
- 前端入口链：desktop/src/main.tsx:1-7 → desktop/src/App.tsx:4（Ant Design ConfigProvider，zh_CN，主色 #347851）→ desktop/src/app/AppRouter.tsx:11（view 状态机: browser/library/search/ai/settings）
- 外壳布局：desktop/src/layouts/AppLayout.tsx:11-60（侧栏可拖拽 72–320px，pointermove 重写 --sider-width）
- 浏览器视图：desktop/src/pages/browser/BrowserPage.tsx:11-235（BrowserPage 内部使用 useRef 维护 activeTabIdRef/tabsRef/previousTab 避免重渲染失效，含 navigate/openNewTab/activateTab/closeTab/save/openReader 五大动作）
- 原生 WebView 适配层：desktop/src/services/nativeBrowser.ts:10-130（labelFor 将 tabId 映射到 Tauri Webview label=「browser-{sanitized}」，提供 openNativeTab/show/hide/close/resize/reload/stop/navigateHistory/readNativeState/captureNativePage）
- 阅读器模块：desktop/src/features/reader/extractArticle.ts:7-36（Readability 解析 + Turndown 转 Markdown + 清理 script/iframe/on* 属性 + http(s) 绝对化 src/href）
- 阅读器类型：desktop/src/features/reader/types.ts:1-2（PageSnapshot{url,html}、ReaderArticle{title,byline,excerpt,siteName,language,contentHtml,markdown,textContent,wordCount}）
- 保存与轮询：desktop/src/pages/browser/BrowserPage.tsx:200-216（POST /api/v1/documents → 最多 30 次/200ms 轮询 GET 等待 READY，FAILED 抛错）
- 保存客户端：desktop/src/api.ts:19-39（listDocuments/saveDocument/getDocument/deleteDocument 走 Tauri invoke 'local_*'，非 Tauri 环境回退空集合）
- 样式与体积：desktop/src/styles/main.scss:1-7（.browser-page/.browser-tabs/.browser-toolbar/.web-surface/.reader-document；Vite manualChunks 把 antd/markdown/tauri 拆包 desktop/vite.config.ts:1-3）
- 搜索与知识库：desktop/src/pages/search/SearchPage.tsx:8-25（250ms 防抖 + listDocuments 检索，空结果展示「本地数据服务未连接」）、desktop/src/pages/library/LibraryPage.tsx:8-26（Statistic 实时统计 + DocumentCard/DocumentDetailDrawer 渲染）
- 浏览器 ↔ 标签页：desktop/src/pages/browser/BrowserPage.tsx:60-70（useEffect 在 active.id 变化时 hide 旧 tab、show 新 tab；ResizeObserver 在 surface 变化时 resizeNativeTab）
- 导航/历史同步：desktop/src/pages/browser/BrowserPage.tsx:43-58（readNativeState 每 750ms 拉取 url/title/favicon/loading 同步到 React state）

## 宪章检查

- [x] 保持本地优先和显式上下文
- [x] 所有写入经过受控 Runtime
- [x] 变更保持最小且可验证

## 影响范围

- `desktop/src/pages/browser/BrowserPage.tsx`（MEDIUM）— 核心交互页面，引入 useReducer/事件流/LRU 都会改动既有 useRef/useEffect 序列，需要重测快捷键与保存轮询
- `desktop/src/services/nativeBrowser.ts`（LOW）— labelFor 规整算法 + labels Map 维护；优化标签冲突兜底只影响 label 命名空间，不影响命令语义
- `desktop/src/features/reader/extractArticle.ts`（LOW）— Reader 净化逻辑已较完善（清 on* 属性/移除非 http(s) src/href），从 dangerouslySetInnerHTML 切到 react-markdown 仅影响渲染层
- `desktop/src/layouts/AppLayout.tsx`（LOW）— --sider-width 变量化仅追加 CSS 变量写入，清理分支保持现有；其它视图不受影响
- `desktop/src/styles/main.scss`（LOW）— 替换 190/300/820 硬编码为 var()，需要同时改 main.scss 与 compact.scss 两处并保持外观一致
- `desktop/src-tauri/src/main.rs`（MEDIUM）— 若把 750ms 轮询改为事件流，需在 lib.rs 中新增/暴露 webview 导航事件命令；当前仅 lib::run() 尚未注册这些命令
- `backend/internal/httpapi/server.go`（LOW）— 本期若同时收敛 markdown 占位与 READY/FAILED 语义，需确认后端 Processor 行为（processor.go:45-66）保持不变
- `desktop/src/api.ts`（LOW）— saveDocument/getDocument 走 Tauri invoke；本期不动契约，但需保证删除占位 markdown 后调用方仍能正确处理空 markdown

## 实施策略

- 阶段 0（澄清）：与产品/研发对齐本规格边界：是否包含 Tauri commands、是否包含 AI 入口降级、是否要求收敛 markdown 占位；输出可量化的性能基线与目标
- 阶段 1（埋点）：在 BrowserPage 增加 useEffect 触发的性能埋点（tabs 切换耗时、sync timer 命中次数、captureNativePage 时长），并接入现有 dev console 输出
- 阶段 2（状态机收敛）：把 tabs/activeTabId/address/aiOpen/readerArticle/nativeMode 收敛为单一 useReducer 或 zustand store，移除 5 个 useRef 跨渲染缓存，降低心智负担
- 阶段 3（事件替代轮询）：把 750ms setInterval 同步（desktop/src/pages/browser/BrowserPage.tsx:53）替换为 Tauri Webview onNavigation 事件；Tauri 侧在 lib.rs 中暴露 listen('tauri://navigation') 转发到 'browser://state'
- 阶段 4（标签页生命周期）：为 openNewTab/activateTab/closeTab 引入 useTransition，避免在大量标签页时同步 setState 引起卡顿；为 closeNativeTab 失败时增加重试与错误提示
- 阶段 5（Reader 路径）：将 readerArticle 提升到 BrowserPage 顶层 useState 之外，使用 LRU（最多 5 个 tab）缓存正文，避免重复 captureNativePage；dangerouslySetInnerHTML 替换为 react-markdown + 净化白名单
- 阶段 6（占位收敛）：删除或条件化 markdown='Captured by Reader pipeline.' 占位（desktop/src/pages/browser/BrowserPage.tsx:205），要求 Reader 失败时仅入队 'Inbox' 标签的空 draft，并在 message 中明示失败原因
- 阶段 7（样式变量化）：将 .app-sider、.ai-panel、.app-content 等 hardcoded 190/300/820 等尺寸替换为 var(--sider-width) / var(--ai-panel-width)，由 AppLayout 统一写入 CSS 变量
- 阶段 8（快捷键作用域）：将 onKeyDown 从 window 改为根容器监听并按 view==='browser' 启用；其他视图保留默认浏览器行为
- 阶段 9（测试）：为 BrowserPage 新增 vitest 单元测试覆盖 openNewTab/closeTab/activateTab/save/openReader 的状态分支（当前 desktop 仅 mock.ts 离线降级 desktop/src/features/documents/documentService.ts:1-6，无页面级测试）
- 阶段 10（验证）：运行 desktop npm run test && npm run build 与 backend go test ./...；按 requirements 列表逐条人工核对可观察行为

## 风险与待确认

- 「浏览器优化」的具体范围：是聚焦 React 端（标签页状态机、Reader、AI 面板交互），还是包含 Tauri 侧 WebView 命令（browser_create/browser_navigate/browser_state/browser_snapshot）？
- 「优化」目标指标：首屏/切换延迟、JS bundle 体积、内存峰值、CPU 占用，还是 FCP/LCP/INP Web Vitals？请给出可量化的目标值与基线
- 现有 captureNativePage（snapshot 走 Tauri command）是否已有大小限制？README.md:140 提到「页面快照设置了大小限制」，具体阈值是多少（影响 Reader 进入时长）？
- labelFor 当前把 tabId 中非字母数字字符替换为 '-'（desktop/src/services/nativeBrowser.ts:16），如果同时存在两个 tab 被规整到同一 label 会否冲突？是否需要哈希或去重兜底？
- sync 定时器 750ms（desktop/src/pages/browser/BrowserPage.tsx:53）是否过粗？Tauri 侧是否已提供事件流（如 webview onNavigation）可以替代轮询、降低延迟与电量？
- 保存到知识库时 markdown='Captured by Reader pipeline.' 的占位（desktop/src/pages/browser/BrowserPage.tsx:205）按 README.md:107 「不会生成示例内容」需要被删除，是否在本期优化中同时收敛？
- Reader 模式通过 dangerouslySetInnerHTML 渲染 contentHtml（desktop/src/pages/browser/BrowserPage.tsx:241），即便 extractArticle.ts:23-25 已清 on* 属性，是否需要 CSP/Trusted Types 强化以满足本期优化？
- 键盘快捷键处理挂在 window 上（desktop/src/pages/browser/BrowserPage.tsx:74-115），当 Library/Search/AI/Settings 视图激活时仍会拦截 Cmd+T/W，是否需要按 view 限定作用域？
- AI 面板（AssistantPanel）仅消费 active.title、save 函数、close 回调（desktop/src/pages/browser/BrowserPage.tsx:240-245），是否在本期优化中需要补摘要/翻译/问答的本地降级（无 AI Provider 时显示离线提示）？
- AI Provider 路由当前统一返回 501 provider_not_configured（backend/internal/httpapi/server.go:50-52），浏览器优化是否需要把 AI 入口做成「未配置时禁用按钮 + Tooltip 说明」？
- 标签页 favicon 同步走 readNativeState.favicon（desktop/src/pages/browser/BrowserPage.tsx:48），是否存在跨域图标 CSP 风险？是否需要在 Tauri 侧做代理/缓存？
- 侧栏可拖拽目前只更新 --sider-width（desktop/src/layouts/AppLayout.tsx:14-17），其它样式（.ai-panel、.app-sider）使用 hardcoded 190px（desktop/src/styles/main.scss:3-5）；优化时是否需要把这些数值替换为 var(--sider-width)？

## 规格来源

# 浏览器优化

## 用户场景

描述用户要完成的目标。

## 功能需求

- 待补充

## 验收标准

- [ ] [AC-01] 待补充可观察、可测试的结果

## 非目标

- 待补充

