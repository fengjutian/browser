# 开发路线与任务拆分

## Iteration 0（当前）

- [x] PRD、架构、API 与迁移设计
- [x] React 产品壳与核心页面原型
- [x] Go 内存仓储和 REST API
- [x] Tauri 工程及插件权限占位
- [x] 后端路由测试

## Iteration 1：可浏览

- [x] 为每个 Tab 创建/销毁独立 WebView
- [x] WebView 切换、尺寸同步、导航、刷新和历史控制
- [x] 页面 URL、标题与加载状态同步
- [ ] 同步 favicon 与精确 history 可用状态
- [ ] 新窗口、下载、外部协议和证书错误处理
- [ ] 启动/监管 Go sidecar，加入随机端口与会话 token

## Iteration 2：Reader 与持久化

- [x] 集成 Mozilla Readability 正文提取
- [x] Turndown HTML → Markdown、危险内容清理与资源地址规范化
- [x] 从原生 WebView 按需获取 DOM 并展示 Reader Mode
- [x] SQLite Repository、迁移器、事务与 FTS5
- [x] 进程内后台 Worker 与 `PENDING → PROCESSING → READY/FAILED` 状态流
- [x] 前端保存状态轮询与失败反馈
- [x] 本地 Markdown 文档阅读、来源跳转、导出和删除确认
- [x] 页面懒加载与 vendor 分包
- [ ] 持久化任务表、多 Worker、退避重试与崩溃恢复

## Iteration 3：AI 与隐私

- [ ] Provider 配置与系统密钥环
- [ ] 流式摘要、页面问答、翻译、自动标签
- [ ] 规则编译、网络拦截和站点级统计
- [ ] 敏感日志审计与权限集成测试

## Iteration 4：RAG

- [ ] 分块策略评测与 Embedding 队列
- [ ] 本地向量索引、RRF 融合、Reranker
- [ ] 引用强制校验与跨文档问答评测集
