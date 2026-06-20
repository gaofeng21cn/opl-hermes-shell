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

## GUI 路线定位

当前 App owner policy 已固定 GUI 路线：

- AionUI 是 One Person Lab App 的 active GUI mainline，由 App 仓通过
  `shells/aionui` 消费 `opl-aion-shell`。
- Hermes Desktop / `hermes-codex` 是唯一 foreground alternative。本仓只承载这条
  Hermes alternative lane 的 upstream 对比、最小 OPL delta、候选打包和技术验证。
- AG-UI/CopilotKit / `agui-codex` 已降为 archived technical proof / explicit replay
  surface；除非用户明确要求 AGUI replay，不再更新、完善、抛光或纳入默认验证。

因此，Hermes 工作只对“是否可能成为 AionUI 之外的唯一 foreground alternative”
负责，不吸收 AGUI proof 的功能 backlog、WebUI 假设、验证负担或 adoption 叙事。
需要 AGUI replay 时，应回到 `opl-agui-codex-shell` 和 App repo 的 explicit adapter
contract，而不是在本仓继续移植。

## 参考系

当前候选基线：

- upstream repo: `NousResearch/hermes-agent`
- upstream app path: `apps/desktop`
- evaluated source ref: `5e01a5dbf1b7bc0144d9057be706da1ea9f065c3`
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

## 最近 upstream intake

2026-06-17 intake：

- from upstream ref: `c6b0eb4de0e5010a752e312c0577a4d04d2a08a5`
- to upstream ref: `5e01a5dbf1b7bc0144d9057be706da1ea9f065c3`
- upstream range source: `NousResearch/hermes-agent` 的 `apps/desktop`
- local classification: `follow_upstream`

本次 upstream desktop 变化集中在官方 UI/交互增强：

- 模型选择器从 statusbar 移到 composer control 区域，并新增 `ModelPill`。
- 增加 per-model reasoning/fast preset 记忆和应用逻辑。
- 模型设置页恢复 profile default reasoning/speed 写回，并补能力门控。
- Provider 设置页支持 external/CLI-managed provider 的终端断开路径。
- 本地 gateway 下 `/browser connect` slash command 可用。
- model visibility、model status label、session store、subagent watch window
  和相关 i18n/test 跟随官方修正。

本次 intake 未把 upstream Python/gateway runtime、Hermes installer 权威或新的
runtime truth 搬入本仓；`electron/main.cjs`、OPL first-run、OPL Codex gateway、
OPL defaults seed、candidate package wrapper 和 App repo adoption gate 继续按本仓
OPL delta 维护。

## 基本产品策略

Hermes Desktop 已经是比较完整的桌面 Agent GUI，形态接近 “Codex App 换壳”：
chat-first、工作目录、文件/预览、工具输出、设置和原生桌面打包都已存在。因此
OPL 路线的默认策略是：

- 保留 Hermes Desktop 原生交互和视觉结构作为初始基线。
- 先做 OPL 品牌化、App identity、图标和候选包名。
- 后端入口以 Phase 1 compatibility firewall 处理：与 Codex App-like OPL 普通路径
  一致的能力补 adapter；只适合排障的能力进入 Advanced/Diagnostics；会误导用户以为
  有完整 Hermes backend 的 skills、toolsets、profiles、cron mutation、messaging、
  provider marketplace、update/restart、audio/media remote helper 和 raw MCP manager
  不作为普通可用功能呈现。Codex app-server-backed Hermes gateway adapter 只做 thin
  client；MAS/MAG/RCA 通过 Codex Skill/Plugin/MCP 能力进入 Codex，由 Codex 作为顶层
  协调器判断是否调用，而不是替换整个 `/api/*` 和 WebSocket backend。
- 隐藏、降级或重命名 OPL 普通用户不需要的 provider/backend/agent runtime 概念。
- 对 OPL 必需能力做最小薄适配：Codex Skill shortcuts、App-owned settings、
  runtime refs、page-state 和 first-run 等都必须先经过 App repo contract gate。

这意味着 OPL 不从一开始把 Hermes 改造成另一个 AionUI/AGUI 稳定线，也不在没有功能
对比的情况下把旧 App stable wrapper、state/action bridge、page-state mapping、
Full runtime 或 WebUI parity 搬进来；同样不允许用一个返回空 schema、空 skills、
空 toolsets、空 providers 的最小 Codex shim 全量接管 Hermes backend。

## 允许的第一层定制

当前 minimal candidate 可以直接保留的改动范围：

- **Branding/package identity**：产品名、bundle id、protocol scheme、图标、候选
  manifest；`public/apple-touch-icon.png` 必须与 OPL 图标同步，因为 Electron
  启动后会用它刷新运行时 Dock icon。Home intro 的 wordmark 也属于 branding：
  普通首屏必须显示 `One Person Lab`，不能继续显示 upstream `HERMES AGENT`。
- **Official backend comparison**：`electron/main.cjs` 保留官方 Hermes backend
  resolution、first-launch bootstrap、remote backend、profile pool 和
  `hermes dashboard` API contract，作为 upstream 对比与后续 intake 基线。候选包在
  OPL fallback / Codex app-server adapter 模式下不声称自己是功能完整的 Hermes
  backend；普通路径只开放已分类为 `implement` 或 `adapt` 的能力，其余进入
  `diagnostic_only` 或 `hide_or_remove`。
- **OPL defaults seed**：`electron/opl-defaults.cjs` 在官方 Hermes runtime resolved
  后、`hermes dashboard` 启动前，用官方 `hermes_cli.config.load_config/save_config`
  只补缺省值：`model.openai_runtime=codex_app_server`、`display.language=zh` 和
  本机已存在的 MAS/MAG/RCA skill external dirs。已有用户配置不被覆盖，seed 失败
  只写日志，不阻断官方 Hermes Desktop 启动。
- **OPL i18n 范围**：普通 UI 只维护简体中文和英文。中文系统语言统一映射到 `zh`；
  日文和其它非支持语言回退英文。不要继续增加繁体中文或日文 locale 文件。
- **Home Codex Skill chips**：MAS/MAG/RCA 是 Codex Skill/Plugin 能力入口，不是独立
  backend 选择器，也不是 GUI 侧硬编码 route。Home 允许在 intro/composer 附近显示轻量
  `科研/MAS`、`基金/MAG`、`演示/RCA` chips；点击 chip 只把 `$mas`、`$mag`、`$rca`
  这类显式 Skill prompt 写入 composer。下一条 `prompt.submit` 会先通过 Codex
  app-server 的 `skills/list` 读取真实可用 Skill；若 Codex 已发现对应 Skill，则用
  `turn/start` 的 `{ type: "skill", name, path }` input 交给 Codex runtime。GUI 不读取
  `SKILL.md`、不实现 Skill loader、不直接执行领域命令。不要把这些 chips 扩展成首页
  dashboard、runtime truth 面板或 domain readiness 展示。
- **OPL startup fallback**：没有可用 Hermes runtime 且进入 OPL fallback 时，按
  App repo 的四线模型分流。每次启动只做 marker、One Person Lab CLI、Codex CLI、
  `opl app state --profile fast --json` 模型访问探测和 Codex adapter startup 的轻量
  检查；marker 缺失或过旧不能单独进入 full initialize，必须先用 fast app state probe
  判断已安装机器是否可直接进入主界面；只有 probe 失败或核心组件缺失时才复用 Hermes
  checklist UI 做一次性本机初始化；缺 key 进入单独模型访问向导；`opl system
  initialize --json`、startup maintenance、module reconcile 和 OPL 状态刷新在主界面
  可见后后台执行，不得成为热启动首页 gate。
- **Codex/OPL/MAS 扩展点**：优先使用 Hermes 原生 `openai-codex`、
  `model.openai_runtime=codex_app_server` 和 `skills.external_dirs` 能力。
  在 OPL first-run fallback 路径中，`electron/opl-codex-gateway.cjs` 作为
  Hermes-compatible adapter：renderer 仍调用 `session.create` / `prompt.submit`，
  adapter 内部长期启动 `codex app-server --listen stdio://`，并映射
  `thread/start`、`turn/start`、`item/agentMessage/delta` 和 `turn/completed`。
  该 adapter 仍不能成为 full backend replacement；MAS/MAG/RCA 不能在 adapter 中
  做关键词识别、`opl start` preflight、`opl app action execute` dry-run 或 route
  receipt 注入。OPL app state/action、runtime refs 和 domain readback 后续只能作为
  Codex 可调用 Skill/Plugin/MCP 能力或诊断面接入，不能让 GUI adapter 成为领域路由器。
- **Candidate package wrapper**：生成本地 `.app` 候选包和 manifest，只用于显式
  technical verification。
- **最小验证**：证明 upstream 基线仍在、OPL branding/adapter/package wrapper 存在，
  且旧稳定线迁移文件没有被误带入。
- **测试分层**：默认本机验证必须是 non-foreground。`smoke:opl-first-run` 负责
  packaged app 的启动、first-run、fixture Codex turn、Skill input 和长回复 ack
  证据，并通过 `OPL_HERMES_SMOKE_NO_FOREGROUND=1` 避免抢占用户桌面。Settings visual
  smoke 会打开并聚焦 `.app` 以截取截图，必须显式传 `--allow-foreground`，并优先在
  VM/Tart 中运行；它不能进入默认 App-root candidate command chain，也不能作为
  `validate:candidate -- --require-app` 的隐含要求。

这些改动可以作为长期 OPL delta 存在，但应保持薄、可比较、可撤回。凡是让官方
Hermes 设置页、skills、toolsets、MCP、profiles 或 cron 暗示普通可管理但背后没有
真实 backend owner 的改动，都不是合格的第一层定制。Phase 1 宁可隐藏或下沉诊断，
也不能用空列表、假成功 mutation 或 no-op reload 掩盖缺口。

## 设置页空态归因规则

Hermes Desktop 官方设置页导航包含 `Model`、`Chat`、`Appearance`、`Workspace`、
`Safety`、`Memory & Context`、`Voice`、`Advanced`、`Providers`、`Gateway`、
`Tools & Keys`、`MCP`、`Notifications`、`Archived Chats` 和 `About`。这些导航来自
官方 renderer，不是 OPL 定制新增。

排查设置页空白时，先按数据来源归因：

- `Chat`、`Workspace`、`Safety`、`Memory & Context`、`Voice`、`Advanced`
  通过 `/api/config`、`/api/config/defaults` 和 `/api/config/schema` 渲染。
  若候选 adapter 的 schema 缺少对应 `SECTIONS.keys` 字段，页面会显示“无可配置项”。
  这是 adapter 数据面过窄导致的假空白，不是中文翻译问题，也不是官方 renderer
  本来没有实现。
- `Providers` 在 OPL 普通路径中收敛为“模型访问”。`/api/env` 只暴露
  `OPENAI_API_KEY`，UI 分组为 `gflabtoken`，保存时走
  `opl system configure-codex --api-key-stdin --json`。普通设置页不暴露
  OpenAI-compatible provider、OAuth provider account、自定义 Base URL 或其它
  provider key；这类上游 Hermes 能力只能在明确的高级/诊断路径重新评估。
- `Providers` 通过 `/api/providers/oauth` 和 `/api/env` 渲染。若未来重新开放
  provider key，仍必须满足 `EnvVarInfo.category === "provider"`，且 env key 能被
  `PROVIDER_GROUPS` 归入非 `Other` 分组，否则页面会显示没有 provider key。
- `Tools & Keys` 只显示 `tool`、`setting` 或非 channel-managed `messaging`
  category。若当前候选没有真实工具密钥或网关级设置密钥，显示空态是官方 UI 的正常
  行为；不要为了填满页面伪造无法保存或没有 runtime owner 的密钥。
- `MCP` 读取 `/api/config` 的 `mcp_servers`。没有配置 MCP server 时官方页面会显示
  空态，但“新增/保存 MCP server”必须能通过 `/api/config` 在 adapter 生命周期内
  闭环，否则属于候选 adapter bug。
- `Appearance` 和 `Notifications` 主要是本地 renderer/desktop preference，不依赖
  Hermes backend schema。`Archived Chats` 没有归档会话时显示空态，属于正常数据空态。

当前 OPL fallback adapter 的责任是让官方 renderer 的基础设置交互可用：补齐上述
config schema、provider env catalog 和 adapter 生命周期内的 config save/readback。
它仍不是完整 Hermes backend replacement；skills、toolsets、messaging、analytics、
正式 persisted sessions、OAuth provider accounts、update runtime、cron scheduler 等
深层能力继续由官方 Hermes backend 或后续经过 App repo adoption gate 的 OPL bridge
承接。进入 ordinary UI 前必须有真实实现和验证；否则只能作为诊断 readback 或隐藏。

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
