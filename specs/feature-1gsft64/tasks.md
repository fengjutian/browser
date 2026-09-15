# 浏览器优化 任务清单

## 实现

- [ ] T001 P0 澄清：与产品/研发对齐范围（前端 vs 含 Tauri）、可量化指标、是否删除 markdown 占位，输出基线数值
- [ ] T002 P1 埋点：在 BrowserPage 增加 useEffect 触发的性能埋点（tabs 切换耗时、sync timer 命中次数、captureNativePage 时长），接入 dev console
- [ ] T003 P2 状态机收敛：把 tabs/activeTabId/address/aiOpen/readerArticle/nativeMode 收敛为单一 useReducer，移除 5 个 useRef 跨渲染缓存
- [ ] T004 P3 事件替代轮询：750ms setInterval 替换为 Tauri Webview onNavigation 事件；Tauri 侧 lib.rs 暴露 'browser://state' 事件
- [ ] T005 P4 标签页生命周期：openNewTab/activateTab/closeTab 引入 useTransition；closeNativeTab 失败时增加重试与错误提示
- [ ] T006 P5 Reader 路径：readerArticle 提升到顶层并使用 LRU（最多 5 个 tab）缓存；dangerouslySetInnerHTML 替换为 react-markdown + 净化白名单
- [ ] T007 P6 占位收敛：删除 markdown='Captured by Reader pipeline.' 占位（BrowserPage.tsx 第 205 行），Reader 失败时仅入队 'Inbox' 空 draft 并 message 说明失败原因
- [ ] T008 P7 样式变量化：styles/main.scss 中 190/300/820 替换为 var(--sider-width) / var(--ai-panel-width)，AppLayout 统一写入
- [ ] T009 P8 快捷键作用域：onKeyDown 从 window 改为根容器并按 view==='browser' 启用，其它视图保留默认浏览器行为
- [ ] T010 P9 测试：新增 BrowserPage 的 vitest 单元测试覆盖五大动作的状态分支
- [ ] T011 P10 验证：desktop npm run test && npm run build、backend go test ./...，按 R1–R9 逐条人工核对

## 验证

- [ ] T012 验证：R1 多标签状态：支持新建、激活、关闭、切换下一/上一、Ctrl+1..9 跳指定、最多保留 1 个空标签兜底（BrowserPage.tsx 第 136-188 行）
- [ ] T013 验证：R2 地址栏：支持 URL 直入与关键字搜索、自动前缀补 https（BrowserPage.tsx 第 118-134 行）、Ctrl/Cmd+L 聚焦并全选（BrowserPage.tsx 第 78-83 行）
- [ ] T014 验证：R3 键盘快捷键集合：Ctrl+T/W/Tab/Shift+Tab/1-9/R、Alt+←/→、Esc、F5 与 README.md:24-34 表格一致（BrowserPage.tsx 第 77-115 行）
- [ ] T015 验证：R4 阅读模式：调用 captureNativePage → extractArticle → ReaderArticleView，命中空正文抛 'reader_content_not_found'（BrowserPage.tsx 第 238-248 行 + extractArticle.ts 第 15-17 行）
- [ ] T016 验证：R5 保存到知识库：调用 saveDocument 并以 30×200ms 轮询等待 READY/FAILED（BrowserPage.tsx 第 200-216 行），当前 markdown='Captured by Reader pipeline.' 占位应改为真实 Reader 输出
- [ ] T017 验证：R6 AI 助手面板：toggle 后渲染摘要/提问/翻译三个 Segmented 项与「保存到知识库」按钮（BrowserPage.tsx 第 240-258 行）
- [ ] T018 验证：R7 原生 WebView 生命周期：open/show/hide/close/resize/reload/stop/navigateHistory/captureNativePage 全部走 Tauri invoke（nativeBrowser.ts 第 20-80 行）
- [ ] T019 验证：R8 标签页关闭兜底：最后一个标签关闭后自动新建一个空标签，地址栏清空（BrowserPage.tsx 第 173-188 行）
- [ ] T020 验证：R9 Reader 安全清理：移除 script/style/noscript/iframe/object/embed/form；剥离 on* 属性；只保留 http(s) 的 src/href（extractArticle.ts 第 18-26 行）
