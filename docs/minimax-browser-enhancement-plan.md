# MiniMax 开发任务书：浏览器能力增强

## 目标与工作方式

在现有 Tauri 2 + React + TypeScript 浏览器上完成下面 10 组能力。按批次提交，每批必须能独立构建、测试、回滚。禁止一次性重写 `BrowserPage.tsx`，优先抽取 feature、service 和纯函数。

开始前先阅读：

- `docs/architecture.md`
- `docs/development-guide.md`
- `desktop/src/pages/browser/BrowserPage.tsx`
- `desktop/src/services/nativeBrowser.ts`
- `desktop/src-tauri/src/lib.rs`
- `desktop/src/features/browser/sitePermissions.ts`
- `desktop/src/features/downloads/trackDownload.ts`

每批执行：实现 → 单元测试 → `npm test` → `npm run build` → `cargo test` → 手工验收记录。不得覆盖工作区中与本批无关的修改。

## 强制原则

1. 敏感权限默认 `ask` 或 `deny`；未获用户明确授权时必须拒绝。
2. 不允许伪造下载进度。若 Tauri 下载事件无法提供字节进度，必须接入平台能力或明确显示“不确定进度”。
3. 不允许忽略证书错误继续加载，除非用户在明确风险页上进行一次性授权。
4. 私密模式不得写入历史、会话、地址建议、站点数据或下载历史；文件下载本身除外。
5. 所有 native 命令校验参数、限定协议/路径，并返回可分类错误。
6. Windows 为第一验收平台；平台相关代码必须放入 `cfg(target_os = "windows")`，其他平台提供安全降级。

---

## 第 0 批：基础重构与能力探测

### 实现

1. 将 `BrowserPage.tsx` 中下载、标签命令、地址建议分别拆为 hooks/feature：
   - `features/downloads/useDownloads.ts`
   - `features/browser/useTabRuntime.ts`
   - `features/browser/addressSuggestions.ts`
2. 新建 `services/browserCapabilities.ts`，由 Rust 命令返回：下载进度、暂停/继续、原生权限事件、上下文菜单、清站点数据、证书错误处理是否可用。
3. 调研当前锁定版本的 Tauri/Wry/WebView2 API，在 `docs/browser-native-capability-matrix.md` 记录“直接支持 / 需 WebView2 COM / 不支持及降级”。
4. 为事件 payload 增加 `version`，前端兼容未知字段。

### 验收

- 页面行为不变。
- `BrowserPage.tsx` 明显缩小，纯逻辑具有测试。
- 能力矩阵不得凭猜测填写，需标注对应 crate/API。

---

## 第 1 批：下载管理增强

### 数据模型

新建 SQLite `downloads` 表和迁移：

```text
id, url, file_name, target_path, mime_type,
received_bytes, total_bytes, status,
danger_type, started_at, updated_at, finished_at,
source_origin, private
```

`status`：`queued | downloading | paused | completed | cancelled | failed | blocked`。

### Rust 实现

1. 新建 `src-tauri/src/downloads.rs`，维护 `DownloadManager` 和按 ID 管理的任务/取消令牌。
2. 提供命令：
   - `download_list`
   - `download_pause`
   - `download_resume`
   - `download_cancel`
   - `download_remove_record`
   - `download_open_file`
   - `download_show_in_folder`
3. 事件统一为 `browser://download-progress`，包含 ID、已收字节、总字节、速度、状态、错误。
4. 若 WebView 原生下载无法提供控制句柄，采用两阶段方案：
   - 普通 WebView 下载保留原生行为并显示不确定进度。
   - 可接管的 HTTP(S) 下载使用 `reqwest` 流式下载；暂停保存临时文件与 ETag/Last-Modified，继续时使用 Range，并校验服务器响应。
5. 打开文件/目录必须使用系统 shell API，路径必须来自下载数据库，不接受任意前端路径。

### 前端实现

1. 新建 `features/downloads/DownloadCenter.tsx`，展示进度条、速度、剩余时间、失败原因。
2. 按状态提供暂停、继续、取消、重试、打开文件、打开目录、移除记录。
3. Browser 工具栏只展示摘要；Library 的“下载记录”展示完整持久化列表。
4. 应用重启后恢复未完成记录；无法继续的标为失败并说明原因。

### 测试/验收

- 已知长度、未知长度、Range 支持/不支持、取消、失败、重启恢复。
- 文件重名采用安全命名，不覆盖已有文件。
- 私密标签下载不写数据库。

---

## 第 2 批：网页内容右键菜单

### 实现

1. Rust/初始化脚本采集右键上下文：鼠标坐标、选中文字、链接 URL、图片 URL、可编辑状态；发送 `browser://context-menu`。
2. 前端在主窗口坐标系显示菜单，点击空白或切换标签时关闭。
3. 菜单项：
   - 空白区域：后退、前进、刷新、保存页面、打印、查看页面信息。
   - 有选区：复制、用当前搜索引擎搜索、询问 AI。
   - 链接：当前标签打开、新标签打开、复制链接。
   - 图片：新标签打开、复制图片地址、保存图片。
   - 输入框：剪切、复制、粘贴、全选。
4. 所有 URL 通过现有导航校验；`javascript:`、`data:`、`file:` 等默认阻止。

### 验收

- iframe、SPA、可编辑元素、图片链接组合场景菜单正确。
- 新标签必须插在当前标签右侧。
- 保存图片进入统一下载中心。

---

## 第 3 批：原生站点权限

### 数据模型

将权限值从 boolean 改为 `ask | allow | deny`，键为规范化 origin，类型包括 camera、microphone、location、notifications、clipboard。

### 实现

1. Windows 接入 WebView2 权限请求事件；不要只覆盖 JS API。
2. 收到请求后暂停决策，向前端发送 origin、权限类型、当前标签 ID。
3. 地址栏下方展示非阻塞权限提示：本次允许、始终允许、拒绝。
4. 无规则、超时、窗口不可见、私密模式一律拒绝；默认策略保持拒绝敏感权限。
5. 权限变更立即作用于现有标签；必要时安全重建 WebView，并恢复 URL/滚动位置。
6. Settings 支持搜索、按站点重置、全部重置及最近使用时间。

### 验收

- 摄像头、麦克风、定位、通知逐项测试 allow/deny/ask。
- 子域名不得继承父域授权；HTTP 与 HTTPS 分开。
- 恶意页面连续请求不得反复弹窗轰炸。

---

## 第 4 批：标签增强

### 实现

1. `BrowserTab` 增加 `muted`、`audible`、`crashed`、`private`、`groupId`。
2. 标签菜单增加静音/取消静音、复制标签、固定/取消固定、关闭其他、关闭右侧、关闭同域、批量选择关闭。
3. 固定标签始终排在左侧，启动恢复；固定标签不可因普通批量关闭被误删。
4. WebView 进程异常时标记 crashed，显示独立崩溃页：重新加载、恢复标签、关闭标签，不无限自动重启。
5. 连续 3 次崩溃后停止自动恢复并展示错误详情。

### 验收

- 音频播放标签显示 audible，静音真实生效。
- 固定标签跨重启保持位置和状态。
- 批量操作包含二次确认和撤销入口。

---

## 第 5 批：地址栏增强

### 实现

1. 新建统一 suggestion provider：打开标签、书签/收藏、历史、搜索建议。
2. 结果按来源、匹配质量、最近访问加权；同 URL 去重；键盘上下选择、Enter 打开、Shift+Enter 新标签打开。
3. Settings 增加搜索引擎配置：Google/Bing/百度/自定义模板，模板必须含 `{query}`。
4. 域名补全仅对无空格且符合 host 规则的输入生效；优先历史中访问过的协议。
5. 地址栏展示连接状态，检测 punycode、混合文字域名、可疑端口、HTTP 登录/支付页并警告。

### 验收

- 中文关键词、localhost、IP、裸域名、带路径域名、无效协议均正确分类。
- 私密历史不进入建议。
- 危险提示不能仅靠颜色表达。

---

## 第 6 批：隐私管理

### 实现

1. Settings 增加“隐私与站点数据”：按时间范围清历史、Cookie、缓存、权限和下载记录。
2. 提供按 origin 查看/删除站点数据。
3. 实现私密标签：独立数据目录/环境；关闭最后一个私密标签后清理会话数据。
4. 私密标签使用独立视觉标识，禁止写历史、session、滚动快照、最近关闭和下载数据库。
5. 增加“退出时清理”设置。

### 验收

- 普通和私密登录状态隔离。
- 清理指定站点不影响其他站点。
- 重启后不存在私密标签痕迹。

---

## 第 7 批：下载与证书安全

### 实现

1. 根据扩展名、MIME、响应头和魔数对可执行文件、脚本、双扩展名进行风险分类。
2. 危险下载先进入 `blocked`，用户确认后才能保存；默认下载目录外路径必须重新确认。
3. 捕获 TLS/证书导航失败，显示应用自己的错误页：主机名、错误类型、返回安全页。
4. 默认禁止绕过；若平台支持例外，仅允许当前 origin、当前会话、一次性继续，并明确风险。
5. 不在日志中记录 Cookie、Authorization 或完整敏感查询参数。

### 验收

- 过期、域名不匹配、自签名证书分别显示正确原因。
- `.exe`、`.js`、`.pdf.exe` 等被正确分类。

---

## 第 8 批：会话与异常恢复

### 实现

1. 会话数据加入 schemaVersion、窗口、标签顺序、固定状态、URL、标题、滚动位置、缩放、标签组。
2. 启动时写运行锁，正常退出清除；发现旧锁则判定异常退出。
3. 异常退出展示“恢复全部 / 仅恢复固定标签 / 放弃恢复”。
4. 恢复采用懒加载：只创建当前标签 WebView，其他标签保持 suspended。
5. 使用临时文件 + 原子替换或 SQLite 事务防止 session 写坏；保留最近两个快照。

### 验收

- 强杀进程后能恢复；正常退出不弹提示。
- 损坏快照自动回退，不造成启动循环。

---

## 第 9 批：网页兼容性

### 实现

1. `window.open`、`target=_blank` 统一在当前标签右侧创建标签。
2. 文件上传支持系统选择器、多选和取消；不得泄漏任意文件路径给非目标页面。
3. OAuth 弹窗采用受控临时 WebView；回调命中原 origin 后关闭并通知 opener。
4. 支持网页全屏进入/退出、Esc 退出、视频播放与媒体快捷键。
5. 对自定义协议展示确认提示，再交由系统处理；危险协议继续拒绝。

### 验收

- GitHub/常见 OAuth、文件上传、视频全屏、弹窗登录分别实测。
- 弹窗不得脱离应用权限和导航策略。

---

## 第 10 批：性能与资源治理

### 实现

1. 后台标签降低状态轮询频率；隐藏窗口暂停非必要轮询。
2. 增加资源面板：活动 WebView 数、休眠标签数、应用内存、每标签最后活动时间。
3. 资源策略：固定/播放音频/下载/表单未提交标签不得自动休眠。
4. 超过阈值后按 LRU 休眠；休眠前保存 URL、滚动、缩放、表单风险标记。
5. 设置中允许配置最大活动标签数和是否自动休眠。

### 验收

- 20+ 标签切换不重复创建 WebView。
- 休眠恢复保持 URL、滚动和缩放。
- 音频和进行中下载不被打断。

---

## 最终回归清单

- 标签：新增、关闭、恢复、固定、拖拽、静音、崩溃、批量操作。
- 导航：输入、建议、前进后退、刷新、SPA、OAuth、新窗口。
- 下载：进度、暂停、继续、取消、重试、重启、打开、风险文件。
- 权限：五类权限、默认拒绝、记忆决策、清除权限、私密模式。
- 隐私：清历史/Cookie/缓存/站点数据、私密隔离、退出清理。
- 安全：危险协议、可疑域名、证书错误、路径校验、日志脱敏。
- 性能：20/50 标签、后台降频、LRU 休眠、异常退出恢复。

## MiniMax 每批交付格式

每批完成后必须回复：

1. 修改文件清单和每个文件的职责。
2. 实际实现与降级项，不得把平台不支持描述为已完成。
3. 自动测试结果与手工测试步骤。
4. 数据库迁移和兼容性说明。
5. 尚存风险以及下一批的前置条件。

