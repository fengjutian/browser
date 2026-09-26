# 开发路线与任务拆分

## Iteration 0（当前）

- [x] PRD、架构、迁移设计与 Tauri 工程
- [x] React 产品壳与核心页面原型
- [x] Rust 端 SQLite + FTS5（迁移 #17：虚表 + 触发器同步 + BM25 排序 + 前缀匹配）
- [x] Tauri 工程及插件权限占位
- [x] 前端 Vitest + Rust cargo test 全部通过（384 / 49 用例）

## Iteration 1：可浏览

- [x] 为每个 Tab 创建/销毁独立 WebView
- [x] WebView 切换、尺寸同步、导航、刷新和历史控制
- [x] 页面 URL、标题与加载状态同步
- [x] favicon 同步与 history 可用状态读取
- [x] 新窗口转应用内标签、外部协议确认、证书错误拦截
- [ ] ~~启动/监管 Go sidecar，加入随机端口与会话 token~~ — 已取消，Go sidecar 整条砍掉（见 §3 决定）

## Iteration 2：Reader 与持久化

- [x] 集成 Mozilla Readability 正文提取
- [x] Turndown HTML → Markdown、危险内容清理与资源地址规范化
- [x] 从原生 WebView 按需获取 DOM 并展示 Reader Mode
- [x] SQLite Repository、迁移器、事务与 FTS5
- [x] Rust 端 `local_documents` 写入即 READY（无中间态；后续任务用 `tasks` 表 + 状态机承载）
- [x] 本地 Markdown 文档阅读、来源跳转、导出、删除确认、星标、收藏
- [x] 页面懒加载与 vendor 分包
- [x] 持久化任务表（`tasks (id, kind, document_id, payload, status, attempts, max_attempts, available_at, started_at, finished_at, last_error)`，迁移 #5）
- [ ] 多 Worker、退避重试与崩溃恢复（参考 Rust 端任务队列基础设施）

## Iteration 3：AI 与隐私

- [ ] Provider 配置与系统密钥环
- [ ] 流式摘要、页面问答、翻译、自动标签
- [ ] 规则编译、网络拦截和站点级统计
- [ ] 敏感日志审计与权限集成测试

## Iteration 4：RAG

- [ ] 分块策略评测与 Embedding 队列
- [ ] 本地向量索引、RRF 融合、Reranker
- [ ] 引用强制校验与跨文档问答评测集
