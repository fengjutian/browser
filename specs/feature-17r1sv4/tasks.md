# 新建需求 7 任务清单

## 实现

- [ ] T001 在未补齐规格前冻结任务输出；当前计划仅基于代码索引，不可作为实现依据
- [ ] T002 由产品负责人补齐：用户场景的触发条件与角色、功能需求的每条行为描述、验收标准（替换 [AC-01]）、非目标边界
- [ ] T003 基于补齐后的规格重新跑代码索引 + 影响面分析，明确改动的文件、子系统（Go API / SQLite / Tauri / React）、新增符号与测试覆盖
- [ ] T004 在 backend/internal/ai/provider.go 评估是否需要新增 Reviewer/Comment 接口及其实现位置
- [ ] T005 若涉及 LLM 评审，决定 Provider 配置入口（沿用 SettingsPage 的 AI Provider 表单还是新增 review 子页）
- [ ] T006 若涉及持久化评论/结果，决定新增表结构（建议参考 backend/internal/storage/sqlite.go 的 migrate 模式追加 schema）
- [ ] T007 决定前端位置：若挂在 AssistantPage，则复用 desktop/src/pages/assistant/AssistantPage.tsx；若新增顶级 View，则需在 desktop/src/app/AppRouter.tsx 的 pages map 与 types.ts View 中同步登记
- [ ] T008 按宪章要求保持本地优先与最小变更，所有写入仍走受控 Runtime（httpapi + Tauri command），并补充单测：Go 端沿用 processor_test.go / sqlite_repository_test.go / server_test.go 风格，前端沿用 vitest

## 验证

- [ ] T009 验证：用户场景『进行代码 review』缺乏触发场景、角色、入口与上下游依赖（如：review 谁的代码？review 网页保存结果？review 文档？review 第三方 PR？）
- [ ] T010 验证：功能需求条目为『待补充』，无法提炼任何行为级验收点
- [ ] T011 验证：验收标准 [AC-01] 仅写『待补充可观察、可测试的结果』，无可验证条件
- [ ] T012 验证：非目标条目为『待补充』，范围未声明
- [ ] T013 验证：代码索引未出现 review/reviewer/comment/diff/pull-request/lint/static-analysis 等与『代码 review』直接对应的领域符号
