# Arcadia — AI Knowledge Browser

Arcadia 是一款以浏览器为入口、以本地知识库为核心的桌面阅读工具。它把网页浏览、正文提取、Markdown 保存、本地检索和 AI 辅助放在同一个工作流中。

项目目前处于早期开发阶段。浏览、标签页、阅读模式和本地 SQLite 保存链路已经可以工作；AI、隐私拦截和插件系统中的部分界面仍是开发中的功能入口。

## 核心特性

- 基于 Tauri 2 原生 WebView 的多标签浏览器。
- 支持地址输入、搜索、前进、后退、刷新和停止加载。
- 网页中的 `target="_blank"` 与 `window.open()` 会转换为应用内标签页。
- 支持网页标题、favicon、加载状态和标签页快捷操作。
- 使用 Mozilla Readability 提取正文，并通过 Turndown 转换为 Markdown。
- 网页可直接保存到桌面端本地 SQLite，不要求 Go 后端运行。
- 知识库、搜索、详情与删除操作直接读取本地真实数据。
- 不内置演示文章，也不会在服务不可用时展示伪造数据。
- 预留页面摘要、问答、翻译、Provider 和插件能力。

## 快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Ctrl/Cmd + T` | 新建标签页 |
| `Ctrl/Cmd + W` | 关闭当前标签页 |
| `Ctrl/Cmd + L` | 聚焦并选中地址栏 |
| `Ctrl/Cmd + Tab` | 切换到下一个标签页 |
| `Ctrl/Cmd + Shift + Tab` | 切换到上一个标签页 |
| `Ctrl/Cmd + 1…9` | 切换到指定标签页，`9` 表示最后一个 |
| `Ctrl/Cmd + R` 或 `F5` | 刷新当前网页 |
| `Alt + ←/→` | 后退或前进 |
| `Esc` | 停止加载 |

## 技术栈

桌面端：Tauri 2、Rust、React 19、TypeScript、Vite、Ant Design、SCSS，以及随应用内置的 `rusqlite`。

内容处理：`@mozilla/readability`、Turndown 和 Markdown。

可选服务端：Go 1.24、SQLite、FTS5 和 REST API。

## 架构

```text
┌──────────────────────────────────────────────┐
│ React UI                                     │
│ Browser / Library / Search / AI / Settings  │
└──────────────────────┬───────────────────────┘
                       │ Tauri commands
┌──────────────────────▼───────────────────────┐
│ Tauri / Rust                                 │
│ WebView 生命周期、导航、安全边界、本地存储   │
└──────────────┬───────────────────────────────┘
               │
        ┌──────▼──────┐       可选
        │ 本地 SQLite │   ───────────► Go API / AI Provider
        └─────────────┘
```

桌面应用采用本地优先设计。文档保存和检索由 Tauri 原生层管理，因此关闭 Go 服务后，浏览器、阅读模式、保存、知识库和本地搜索仍可使用。Go 后端保留给更复杂的异步处理、FTS5、AI 和未来的同步任务。

远程网页运行在独立子 WebView 中。网页内容不能直接调用应用的高权限命令；React UI 通过受控的 Tauri command 完成导航、页面快照和 SQLite 操作。

## 项目目录

```text
.
├── desktop/
│   ├── src/                         # React / TypeScript UI
│   │   ├── app/                     # 页面入口与路由状态
│   │   ├── features/                # 阅读与文档功能
│   │   ├── layouts/                 # 应用外壳
│   │   ├── pages/                   # 浏览器、知识库、搜索等页面
│   │   ├── services/                # 原生浏览器适配器
│   │   └── styles/                  # 全局与紧凑布局样式
│   └── src-tauri/
│       ├── src/browser/             # URL 规范化
│       ├── src/local_store.rs       # 桌面 SQLite 文档存储
│       ├── src/plugins/             # 插件模型与权限占位
│       └── src/lib.rs               # Tauri commands 与启动逻辑
├── backend/
│   ├── cmd/server/                  # 可选 Go 服务入口
│   ├── internal/document/           # 文档领域与 Repository
│   ├── internal/httpapi/            # REST API
│   └── internal/storage/            # 服务端 SQLite
└── docs/                            # PRD、架构、API 与路线图
```

## 环境要求

- Node.js 20 或更高版本
- npm
- Rust stable 与 Cargo
- Tauri 2 对应的平台编译依赖
- Windows：Microsoft Edge WebView2 Runtime
- 可选：Go 1.24（仅在运行独立后端时需要）

平台依赖的安装方式请参考 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)。

## 安装与运行

安装前端依赖：

```bash
cd desktop
npm install
```

推荐以完整桌面模式运行：

```bash
cd desktop
npm run tauri:dev
```

该命令会同时启动 Vite 与 Tauri，可以使用原生 WebView、页面抓取和本地 SQLite。

只运行 Web UI：

```bash
cd desktop
npm run dev
```

纯 Web 模式主要用于查看界面。由于没有 Tauri 原生层，真实网页子 WebView 和桌面 SQLite 不可用。

## 本地数据

桌面端数据库文件名为 `knowledge.db`，存放在 Tauri 为应用分配的数据目录中。应用标识为：

```text
com.arcadia.knowledge-browser
```

具体目录由操作系统决定：

- Windows：用户的 `AppData` 应用数据目录。
- macOS：用户的 `Library/Application Support` 目录。
- Linux：用户数据目录，通常位于 `~/.local/share`。

请不要在应用运行时直接修改数据库文件。备份时应先完全退出应用，再复制 `knowledge.db`。

当前桌面表为 `local_documents`，保存标题、URL、来源、作者、摘要、Markdown、字数、状态、标签和创建时间。搜索会匹配标题、正文、摘要与标签。

## 保存网页

1. 在浏览器页打开网页并等待加载完成。
2. 点击右侧面板中的“保存到知识库”。
3. Arcadia 提取当前页面正文并转换为 Markdown。
4. 文档写入桌面 SQLite。
5. 在“知识库”或“搜索”页面查看内容。

后端没有启动时，这条链路仍然可以完成。页面无法提取正文时，应用会给出错误提示，而不会生成示例内容。

## 可选 Go 后端

Go 后端不是桌面端本地知识库的运行前提。需要开发 REST API、服务端 FTS5 或异步处理能力时，可以单独启动：

```bash
cd backend
go run ./cmd/server
```

默认监听 `http://127.0.0.1:8787`。可用环境变量：

| 变量 | 说明 |
| --- | --- |
| `AKB_ADDR` | 监听地址，默认 `127.0.0.1:8787` |
| `AKB_DATA_DIR` | 数据目录，默认 `backend/data` |

桌面 SQLite 与 Go 服务端 SQLite 当前是两个独立存储，自动迁移、同步与冲突解决尚未实现。

## 构建

构建前端资源：

```bash
cd desktop
npm run build
```

构建桌面安装包：

```bash
cd desktop
npm run tauri:build
```

安装包产物位于 Tauri 的 `target/release/bundle` 目录。

## 测试与检查

```bash
# 前端
cd desktop
npm run test
npm run build

# Rust
cd desktop/src-tauri
cargo fmt -- --check
cargo check
cargo test

# Go
cd backend
go test ./...
```

## 安全说明

- 仅允许浏览 `http` 与 `https` 地址。
- `file:`、`javascript:` 等高权限或可执行协议会被拒绝。
- 外部网页与应用 UI 使用不同的 WebView 安全边界。
- 页面快照设置了大小限制，避免意外读取超大文档。
- SQLite 文件只写入应用数据目录。
- API Key 的系统安全存储仍在开发中，请勿在当前 UI 中保存生产密钥。

## 当前限制

- AI 摘要、问答和翻译按钮目前主要是界面入口，完整 Provider 调用尚未接通。
- 桌面本地搜索目前使用 SQLite 字段匹配；本地 FTS5 与相关性排序仍待完善。
- Go 数据库与桌面数据库暂未自动同步。
- 下载管理、浏览历史、书签、恢复关闭标签和标签拖拽尚未完成。
- 广告与追踪器拦截统计仍处于开发阶段。
- 某些登录站点、反爬虫策略或高度动态页面可能影响正文提取。
- 纯 Web 开发模式不能替代 Tauri 桌面环境的完整验证。

## 路线图

- 完善浏览器导航状态、快捷键和标签页行为。
- 为桌面 SQLite 增加 FTS5、迁移版本与备份恢复。
- 接入可配置的 OpenAI Compatible 与本地模型 Provider。
- 实现带引用的跨文档问答和混合检索。
- 增加浏览历史、书签、下载管理与会话恢复。
- 完善隐私规则、站点级开关和真实拦截统计。
- 建立桌面数据与可选后端之间的同步机制。

更多资料：

- [产品需求](docs/PRD.md)
- [系统架构](docs/architecture.md)
- [API 说明](docs/api.md)
- [开发路线图](docs/roadmap.md)
- [开发技术文档](docs/development-guide.md)

## 贡献

提交变更前，请至少运行与修改范围对应的构建和测试。涉及桌面原生功能时，应同时验证 TypeScript 构建与 Rust 检查；涉及 API 或文档处理时，应运行 Go 测试。

建议提交信息保持清晰，例如：

```text
feat: add local document search
fix: open target blank links in app tabs
docs: expand desktop setup guide
```

## License

当前仓库尚未声明开源许可证。在添加正式许可证前，请勿默认将代码用于再分发。
