# Arcadia WASM/WASI 插件运行时方案

## 1. 目标与非目标

目标是让用户安装、审查、启停和卸载第三方插件，并以最小权限调用 Arcadia 能力。插件故障不得影响浏览器主进程，未授权插件不得读取知识库、网页、网络、任意文件或密钥。

首版不支持原生动态库、任意子进程、插件自绘顶级窗口、后台常驻网络服务和绕过宿主的系统 API。旧的内置链接净化器、广告过滤器继续作为内置能力运行，不自动迁移为第三方插件。

## 2. 技术选择

- 运行时：Wasmtime + WASI Preview 2 Component Model。
- ABI：WIT，避免裸指针、共享内存和语言相关 ABI。
- 默认能力：空 `WasiCtx`；不继承宿主环境变量、stdin/stdout、网络或目录。
- 隔离：每个插件独立 Engine/Store 实例、内存限制、Fuel 和 epoch 超时。
- 网络与文件：不直接开放 WASI Socket；文件仅可按权限预打开插件私有数据目录。网络通过 Arcadia 宿主代理并校验 HTTPS、域名白名单、响应大小和超时。

## 3. 插件包

插件包扩展名为 `.arcadia-plugin`，本质为 ZIP：

```text
plugin.json
plugin.wasm
assets/                 # 可选，仅静态资源
SIGNATURE               # 后续版本，可选
```

`plugin.json`：

```json
{
  "schemaVersion": 1,
  "id": "com.example.research-helper",
  "name": "Research Helper",
  "version": "1.0.0",
  "description": "…",
  "author": "…",
  "component": "plugin.wasm",
  "sha256": "…",
  "permissions": ["knowledge_read", "ai_chat"],
  "networkAllowlist": [],
  "events": ["document.saved"]
}
```

校验规则：反向域名 ID；语义化版本；组件路径不得逃逸包目录；拒绝符号链接；解压后总大小、单文件大小和文件数均有限制；WASM 摘要必须匹配；Manifest 只能声明已知权限。

## 4. WIT 合约

```wit
package arcadia:plugin@1.0.0;

interface host {
  record event { kind: string, payload-json: string }
  log: func(level: string, message: string) -> result<_, string>;
  knowledge-search: func(query: string, limit: u32) -> result<string, string>;
  knowledge-get: func(id: string) -> result<string, string>;
  ai-chat: func(request-json: string) -> result<string, string>;
  http-fetch: func(request-json: string) -> result<string, string>;
}

interface guest {
  initialize: func(config-json: string) -> result<_, string>;
  handle-event: func(event: host.event) -> result<string, string>;
  shutdown: func();
}

world arcadia-plugin {
  import host;
  export guest;
}
```

每个宿主函数先通过 `PluginContext.require()` 校验权限，再执行业务操作。传输 JSON 有独立大小上限并执行严格反序列化。

## 5. 权限模型

权限沿用并收敛现有 `PluginPermission`：页面、标签、历史、书签、知识库、AI、网络和文件系统。安装时展示请求权限；用户授予结果独立持久化，不能仅相信 Manifest。升级新增权限后插件自动停用，等待重新授权。

敏感权限：`page_write`、`history_read`、`knowledge_write`、`ai_chat`、`network_request`、`filesystem_write`。敏感调用写入审计日志，不记录正文、API Key 或完整请求体。

## 6. 生命周期与状态

```text
package selected
  -> validate archive/manifest/hash/component
  -> copy to staging
  -> compile and instantiate with zero capabilities
  -> persist INSTALLING
  -> atomic rename to plugins/<id>/<version>
  -> persist DISABLED
  -> user reviews grants
  -> ENABLED
  -> initialize
  -> event calls
  -> shutdown / disable / quarantine
```

状态：`INSTALLING | DISABLED | ENABLED | FAILED | QUARANTINED`。连续超时或 Trap 达阈值后进入隔离状态。启动时清理残留 staging，并把异常中断的 `INSTALLING` 标为 `FAILED`。

## 7. 资源限制

- 单包 20 MiB，解压后 50 MiB，最多 256 个文件。
- 单实例线性内存默认 64 MiB，最高 256 MiB。
- 单次调用默认 10M Fuel、5 秒；后台事件 15 秒。
- 宿主请求和返回 JSON 各 1 MiB。
- HTTP 只允许 HTTPS；回环地址需单独授权；禁止重定向到未授权域名；响应上限 8 MiB。
- 私有数据目录配额默认 20 MiB。

## 8. 持久化

新增：

- `plugins`：manifest、版本、组件路径、摘要、状态、启用标志、错误与时间戳。
- `plugin_grants`：插件、权限、授权状态与时间戳。
- `plugin_audit_log`：生命周期/敏感操作、成功状态、脱敏错误与时间戳。

WASM 文件保存在应用数据目录，不写入 SQLite。卸载先停实例、删除数据库记录，再移动包目录到回收 staging；失败可重试。

## 9. 前端体验

设置页“插件”增加：安装文件、Manifest 详情、摘要、权限审查、启停、失败原因、审计记录和卸载。新增权限升级必须再次确认。开发者模式允许安装未签名包，但始终显示警告；未来正式市场包要求签名。

## 10. 开发阶段

1. Manifest v1、路径/摘要校验、数据库迁移和仓储测试。
2. Wasmtime Component 执行器：空 WASI、Fuel、内存和超时，完成 initialize/handle-event/shutdown。
3. 安装/启停/卸载 Tauri Commands 与恢复逻辑。
4. 宿主 WIT 能力，先实现日志和只读知识库，再逐项开放。
5. 设置页安装和权限审查界面。
6. 审计、隔离、恶意样例和端到端测试。

## 11. 验收标准

- 无权限插件读取文件、环境变量、网络或知识库均失败。
- 无限循环被 Fuel/超时终止；内存膨胀被限制；主应用保持可用。
- 非法路径、超限包、摘要不匹配和未知权限安装失败且不留正式目录。
- 新增权限的升级不会沿用旧授权。
- 启停和调用跨重启保持一致；崩溃安装可恢复。
- 所有敏感调用可审计且日志不包含密钥或知识库正文。

## 12. 决策记录

不采用独立进程 JSON-RPC 作为第三方运行时：它难以在三平台上稳定限制文件、网络、子进程和系统调用。JSON-RPC 仍可用于 MCP，但不作为插件安全边界。
