# OPL Hermes Shell 上游参考系与定制原则

Owner: `opl-hermes-shell`
Purpose: `upstream_reference_and_opl_customization_strategy`
State: `active_candidate_guidance`
Machine boundary: 本文是人读开发准则。候选 shell 的机器可读验收仍由
`package.json`、`scripts/validate-hermes-codex-candidate.cjs`、App repo 的
`contracts/shell-adapters/hermes-codex.json`、`contracts/app-shell-candidates.json`
和 App-root validation 命令定义。

本文定义 `opl-hermes-shell` 的长期维护方式：把官方 Hermes Desktop 作为明确参考系，
在这个成熟 GUI 基线之上做 OPL App 定制，而不是从零重写一个新桌面壳。

## 参考系

当前候选基线：

- upstream repo: `NousResearch/hermes-agent`
- upstream app path: `apps/desktop`
- evaluated source ref: `c6b0eb4de0e5010a752e312c0577a4d04d2a08a5`
- upstream license: `MIT`
- local role: One Person Lab App 的 Hermes Desktop technical verification candidate

后续升级 Hermes Desktop 时，必须先把待升级 upstream ref 写清楚，再做对照。推荐的
对照对象是：

- 官方 `apps/desktop` 源码、README、package scripts 和 Electron main process。
- 官方 shared package 变化，本仓当前将 `apps/shared` 复制为 `packages/shared`。
- 本仓 OPL delta：branding、icon、bundle identity、official backend baseline
  preservation、OPL defaults seed、executor bridge reference、candidate packaging
  wrapper 和最小验证脚本。
- App repo Hermes adapter contract 和 candidate registry。

本仓不应形成没有来源的“大改版 GUI”。每个非 branding/adapter/package 的深层 UI
或 runtime 改动，都要能回答：它是在跟随 upstream、新增 OPL 必要定制、隐藏不需要的
Hermes 普通用户面，还是临时实验。

## 基本产品策略

Hermes Desktop 已经是比较完整的桌面 Agent GUI，形态接近 “Codex App 换壳”：
chat-first、工作目录、文件/预览、工具输出、设置和原生桌面打包都已存在。因此
OPL 路线的默认策略是：

- 保留 Hermes Desktop 原生交互和视觉结构作为初始基线。
- 先做 OPL 品牌化、App identity、图标和候选包名。
- 后端入口先保留 Hermes Agent/Hermes Desktop 官方 backend contract，保证设置、
  skills、toolsets、MCP、profiles、cron、文件/预览、会话和 first-launch bootstrap
  可用。Codex app-server-backed Hermes gateway adapter、OPL app state/action 和
  MAS/MAG/RCA 在下一层作为执行器或 agent route 扩展接入，而不是替换整个
  `/api/*` 和 WebSocket backend。
- 隐藏、降级或重命名 OPL 普通用户不需要的 provider/backend/agent runtime 概念。
- 对 OPL 必需能力做最小薄适配：purpose labels、App-owned settings、runtime refs、
  route receipts、page-state 和 first-run 等都必须先经过 App repo contract gate。

这意味着 OPL 不从一开始把 Hermes 改造成另一个 AionUI/AGUI 稳定线，也不在没有功能
对比的情况下把旧 App stable wrapper、state/action bridge、page-state mapping、
Full runtime 或 WebUI parity 搬进来；同样不允许用一个返回空 schema、空 skills、
空 toolsets、空 providers 的最小 Codex shim 全量接管 Hermes backend。

## 允许的第一层定制

当前 minimal candidate 可以直接保留的改动范围：

- **Branding/package identity**：产品名、bundle id、protocol scheme、图标、候选
  manifest；`public/apple-touch-icon.png` 必须与 OPL 图标同步，因为 Electron
  启动后会用它刷新运行时 Dock icon。
- **Official backend preservation**：`electron/main.cjs` 保留官方 Hermes backend
  resolution、first-launch bootstrap、remote backend、profile pool 和
  `hermes dashboard` API contract。候选包启动后必须先是一个功能完整的 Hermes
  Desktop。
- **OPL defaults seed**：`electron/opl-defaults.cjs` 在官方 Hermes runtime resolved
  后、`hermes dashboard` 启动前，用官方 `hermes_cli.config.load_config/save_config`
  只补缺省值：`model.openai_runtime=codex_app_server`、`display.language=zh` 和
  本机已存在的 MAS/MAG/RCA skill external dirs。已有用户配置不被覆盖，seed 失败
  只写日志，不阻断官方 Hermes Desktop 启动。
- **Codex/OPL/MAS 扩展点**：优先使用 Hermes 原生 `openai-codex`、
  `model.openai_runtime=codex_app_server` 和 `skills.external_dirs` 能力。
  在 OPL first-run fallback 路径中，`electron/opl-codex-gateway.cjs` 作为
  Hermes-compatible adapter：renderer 仍调用 `session.create` / `prompt.submit`，
  adapter 内部长期启动 `codex app-server --listen stdio://`，并映射
  `thread/start`、`turn/start`、`item/agentMessage/delta` 和 `turn/completed`。
  该 adapter 仍不能成为 full backend replacement；后续 OPL app state/action、
  MAS/MAG/RCA 深层 route receipt 必须作为 executor/agent route bridge 接入
  Hermes 原生 backend 能力。
- **Candidate package wrapper**：生成本地 `.app` 候选包和 manifest，只用于显式
  technical verification。
- **最小验证**：证明 upstream 基线仍在、OPL branding/adapter/package wrapper 存在，
  且旧稳定线迁移文件没有被误带入。

这些改动可以作为长期 OPL delta 存在，但应保持薄、可比较、可撤回。凡是让官方
Hermes 设置页、skills、toolsets、MCP、profiles 或 cron 变空的改动，都默认不是
合格的第一层定制。

## 必须先对比再接入的面

以下内容不能按旧 AionUI/AGUI 稳定线直接移植到 Hermes：

- App product profile generated config。
- `opl app state/action` bridge。
- App page-state matrix mapping。
- App first-run matrix mapping。
- Full packaged runtime。
- Stable release asset normalization 和 verification。
- WebUI parity wrapper。
- 自定义 workspace/session rail、right inspector、Runtime、Memory、Always-On 等更深
  OPL 工作台能力。

接入前至少要形成一份功能对比记录，说明：

- Hermes upstream 已经有什么对应功能。
- OPL App 需要保留、隐藏、重命名、替换或新增什么。
- 该能力的 source of truth 在 App repo、OPL Framework、domain agent、Codex
  app-server / Codex CLI、Hermes upstream，还是本候选 repo。
- 该能力是否会影响普通用户第一屏、runtime truth、release gate、first-run gate
  或 App-owned product contract。
- 最小验证命令和不能宣称的 readiness 边界。

没有这份对比时，默认不接入。

## 同源 WebUI 设计要求

Hermes Desktop 的 GUI 本身是 React/Vite renderer，Electron 是 desktop delivery
wrapper。因此 OPL Hermes WebUI 的目标不是新写一个 Web app，而是复用同一套 renderer，
让浏览器也能访问同一产品 surface。

设计边界：

- Desktop delivery 使用 Electron preload/IPC 暴露 `window.hermesDesktop` 或后续
  App-owned bridge。
- Docker/WebUI delivery 使用 browser shim 暴露同等 bridge shape，再通过
  HTTP/WebSocket/SSE 调容器内 Web server。
- Web server 负责连接 Codex app-server、OPL CLI、workspace volume、
  file/preview APIs 和 event stream；浏览器不直接拥有 runtime truth 或宿主机文件
  系统 authority。
- 功能一致指产品工作流一致：chat、workspace、files/previews、tool output、settings、
  route refs 和 runtime refs 语义一致。Native file picker、OS notification、window
  controls、desktop self-update、keychain 等 OS affordance 必须映射成 Web 等价能力、
  diagnostic 状态或明确 unavailable 状态。
- WebUI 不能引入第二套 product profile、provider/backend selector、runtime truth、
  memory store、artifact authority 或 release channel。

TODO：

- 盘点 renderer 对 `window.hermesDesktop` 的方法依赖，标注 desktop-only、
  web-equivalent、unavailable/diagnostic。
- 抽象 bridge adapter：Electron IPC adapter 和 browser transport adapter 共享同一
  App-facing shape。
- 增加 Docker/WebUI server wrapper：静态托管同一 renderer，代理 Codex/Hermes gateway
  请求，提供 Codex events stream，并连接 `opl app state/action`。
- 通过 Docker volume/path allowlist 暴露 workspace，禁止任意宿主路径访问。
- 建立 WebUI smoke：浏览器打开同一 renderer、bridge 初始化、Codex turn、workspace
  file list/preview、tool output 和核心 settings 通过。
- 完成 App-owned Docker/WebUI gates 后，才能把 `WebUI parity wrapper` 从 deferred
  surface 提升为 Hermes candidate capability。

## 升级流程

升级 Hermes Desktop 的建议顺序：

1. 记录目标 upstream ref、发布日期或 commit 说明。
2. 对比 upstream `apps/desktop`、shared package、Electron scripts 和 package scripts。
3. 保留或重放本仓最小 OPL delta：branding、icon、bundle identity、Codex adapter、
   candidate package wrapper、candidate validation。
4. 对每个冲突改动做分类：
   `follow_upstream`、`preserve_opl_delta`、`replace_with_opl_contract`、
   `hide_from_ordinary_ui`、`defer_until_feature_comparison`。
5. 更新 `README_OPL.md` 的 evaluated ref 和本文件必要说明。
6. 跑本仓 minimal candidate 验证；如果声称 App-root candidate 可选，还要跑 App repo
   Hermes validation。

升级时不把 upstream 改动直接当成 OPL 产品决策。Hermes 的实现可以提供更好的默认
组件和交互，但 OPL 普通路径、release path、runtime refs 和产品命名仍由 App repo
定义。

## 与 App Repo 的关系

App repo 仍是 OPL App GUI product truth：

- `docs/app-ideal-gui-interaction-spec.md` 定义理想交互。
- `docs/codex-to-opl-app-delta.md` 定义 Codex App 到 OPL App 的增量。
- `docs/app-gui-feature-inventory.md` 定义跨 shell 能力清单。
- `contracts/app-shell-candidates.json` 登记 Hermes candidate。
- `contracts/shell-adapters/hermes-codex.json` 定义 explicit adapter。

本仓只能承载 Hermes implementation delta。候选验证通过只表示 technical
verification 成立，不表示 active release shell adoption、release-ready、
production-ready、Full install ready 或 OPL domain readiness。

## 禁止事项

- 不复制 AionUI/AGUI 稳定线 wrapper 来伪装 Hermes ready。
- 不把 Hermes runtime、memory、provider、sessions、installer 或 updater 状态变成
  OPL source of truth。
- 不把 App repo 的 contracts/docs/page-state/first-run/release gate 复制成本仓第二真相源。
- 不用静态 evidence JSON 代替源码、package、App-root validation 或可启动包。
- 不在未对比 upstream 功能前重写大块 UI。
- 不因为技术验证包能启动，就宣称 release adoption 或 production readiness。
