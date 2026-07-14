# OPL Hermes Shell

本仓是 One Person Lab App 的 Hermes retained-reference 与 candidate adapter 载体；App 产品 truth 留在 `one-person-lab-app`。

- 上游 Hermes Desktop 持有 shell body；本仓的 OPL-owned surface 是 branding、Codex app-server bridge、packaging/readback hooks 和 overlays。
- 当前 GUI 角色以 App 的 `contracts/app-shell-adapter.json` 为准，AionUI 是 active shell，Hermes 用于对照和显式 candidate 验证。
- Hermes 只用于技术验证。日常只跑 source-only 的 `npm run validate:candidate`；完整 build、package、smoke 和 install 仅在实际 Hermes 开发需要 packaged evidence 时人工触发，不得接入 push、pull request、schedule、watch/on-save、daily patrol 或 routine validation。
- 上游同步与本地 delta 说明见 `docs/opl-hermes-upstream-strategy.md`。

默认最小验证入口：`npm run validate:candidate`。

<!-- CODEGRAPH_START -->
## CodeGraph

- 本仓库使用本地 `.codegraph/` 索引；该目录不得纳入 Git。
- 定义、调用、影响范围和代码路径等结构检索优先使用 CodeGraph；字面文本检索使用 `rg`。
- 索引缺失或过期时运行 `codegraph init .` 或 `codegraph sync .`。
<!-- CODEGRAPH_END -->
