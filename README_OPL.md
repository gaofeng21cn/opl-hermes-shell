# One Person Lab Hermes Archive

Owner: `opl-hermes-shell`
Purpose: `hermes_desktop_archived_provenance`
State: `retired_archived_read_only`
Machine boundary: `contracts/opl-hermes-candidate-profile.json` 只声明归档终态。
既有 `candidate` 包名、文件名和命令名只是历史实现标识。OPL App 产品真相仍在
`one-person-lab-app` 的 contracts、docs、source 和 release gates 中。

本仓的 Hermes Desktop 产品角色已经退休，GitHub 仓库只保留完整历史与源代码作为
read-only provenance。它不是候选、replay route、默认验证目标、开发 lane、release
route 或维护参考，也没有 build、package、smoke、install 或 upstream intake 义务。
重新打开需要新的 One Person Lab App 明确产品决策。

以下内容保留归档前的实现背景，只用于历史阅读，不构成当前开发或发布指令。

- upstream repository: `https://github.com/NousResearch/hermes-agent`
- upstream subtree: `apps/desktop`
- evaluated source ref: `5e01a5dbf1b7bc0144d9057be706da1ea9f065c3`
- upstream license: MIT
- local shared package: `apps/shared` copied to `packages/shared`
- candidate profile contract: `contracts/opl-hermes-candidate-profile.json`

归档前的历史维护原则见
[`docs/opl-hermes-upstream-strategy.md`](docs/opl-hermes-upstream-strategy.md)。
历史上，本仓把官方 Hermes Desktop 当成明确参考系：升级时先对照 upstream，
再重放最小 OPL delta。OPL 定制默认先保证官方 Hermes Desktop 的 UI、设置、skills、
toolsets、MCP、profiles、cron、文件/预览和官方 baseline 能力继续可用；然后
把 Codex/OPL/MAS 作为执行器或 agent route 扩展接入。不能把最小 Codex shim 当成
完整 Hermes backend 替换，也不是把 AionUI/AGUI 稳定线能力闭着眼睛搬过来。

## 归档前参考边界（历史）

归档前，本仓只作为 App repo 的外部参考与 technical replay 载体。当时 active/release
shell 仍是 AionUI，foreground alternative 是 OPL Native Workbench；只有显式使用
App repo 的 Hermes adapter contract 时，App wrapper 才会选择 Hermes 兼容包：

```bash
OPL_APP_SHELL_ADAPTER_CONTRACT=contracts/shell-adapters/hermes-codex.json npm run package
```

当前参考面只保留最小 OPL delta：

- branding/package identity：`One Person Lab Hermes Candidate`，
  bundle id `cn.onepersonlab.app.hermes-codex-candidate`，图标复用当前 OPL
  AionUI 正式版图标；运行时 `public/apple-touch-icon.png` 也必须同步替换，避免
  Electron 启动后把 Dock 图标刷新回 Hermes。
- official backend baseline：`electron/main.cjs` 保留官方 Hermes backend resolution、
  first-launch bootstrap 和 `hermes dashboard` API contract。Hermes 原生设置、
  skills、toolsets、MCP、profiles、cron、文件/预览和会话能力必须先保持可用。
- OPL defaults seed：`electron/opl-defaults.cjs` 在官方 Hermes runtime resolved 后、
  `hermes dashboard` 启动前，用 Hermes 自己的 `hermes_cli.config.load_config/save_config`
  只补缺省值：`model.openai_runtime=codex_app_server`、`display.language=zh` 和本机
  已存在的 MAS/MAG/RCA skill external dirs。已有用户配置不被覆盖。
- OPL i18n：普通 UI 只维护简体中文和英文。中文系统语言统一进入 `zh`，日文和其它
  非支持语言回退英文；不要继续增加繁体中文或日文 locale 文件。
- OPL startup fallback：当候选包没有可用 Hermes runtime、需要走 OPL fallback 时，
  启动语义按 App repo 的四线模型执行：热启动只做 marker、CLI、`opl app state
  --profile fast --json` 模型访问探测和 adapter 轻量检查；marker 缺失或过旧本身
  不能直接触发 full initialize，必须先做 fast app state readiness probe，探测成功
  则补写 marker 并进入主界面；只有探测失败或核心组件缺失才进入一次性本机初始化
  checklist；缺 key 进入单独模型访问向导；`opl system initialize --json`、startup
  maintenance、module reconcile 和 OPL 状态刷新必须在主界面可见后后台执行，不能成为
  每次启动首页的阻塞 gate。
- executor bridge reference：`electron/opl-codex-gateway.cjs` 只保留为实验 bridge
  和测试材料，明确 `replacesHermesBackend=false`。Codex CLI、OPL app state/action
  和 MAS/MAG/RCA 不得再用这个最小 shim 全量接管 `/api/*` 和 WebSocket backend。
- candidate package wrapper：`scripts/package-opl-candidate-app.cjs` 生成本地
  macOS `.app` 候选包，并写出 `out/hermes-codex-candidate-manifest.json`。
- candidate profile contract：`contracts/opl-hermes-candidate-profile.json` 是本仓
  technical verification 的机器入口。`validate:candidate` 与候选包 manifest 都从
  这里读取 product identity、upstream source ref、App topology、deferred surfaces、
  false-ready boundary 和 authority boundary。它不能替代 App repo 的 shell adapter
  contract、active-shell adoption、release gate 或 owner receipt。
- candidate functional convergence readback：`npm run validate:candidate` 会从同一
  contract 和 `electron/opl-codex-gateway.cjs#describeOplCodexGatewayScope` 输出
  `functional_convergence_readback`。该读面只证明当前 Hermes candidate 的已实现能力、
  deferred surfaces、forbidden resurrection、adapter scope、false-ready boundary 和
  authority boundary 与本仓技术验证一致；它仍不能声明 active-shell adoption、App
  release-ready、packaged GUI acceptance、owner receipt、typed blocker 或 domain truth。

在完成 Hermes 原生功能对比前，以下内容不进入本候选基线：

- App product profile generated config。
- `opl app state/action` bridge。
- App page-state / first-run matrix mapping。
- Full packaged runtime。
- Stable release asset normalization / verification。
- WebUI parity wrapper。

这些面如果后续需要接入，必须先记录 Hermes Desktop 原生功能、OPL 需要保留或替换
的理由、以及 App-owned adoption gate；不能按 AionUI/AGUI 旧稳定路径直接搬运，也
不能通过返回空 schema、空 skills、空 toolsets、空 providers 的 shim 让界面看似能跑。

其中 WebUI parity 的设计要求是同源 UI：复用 Hermes React/Vite renderer，通过
browser shim 和容器内 Web server 替代 Electron preload/IPC，不另写第二套 Web
界面。具体 TODO 见
[`docs/opl-hermes-upstream-strategy.md#同源-webui-设计要求`](docs/opl-hermes-upstream-strategy.md#同源-webui-设计要求)。

## 后续升级与功能对比

升级 Hermes Desktop 或新增 OPL 能力前，先按
[`docs/opl-hermes-upstream-strategy.md`](docs/opl-hermes-upstream-strategy.md)
记录参考系与对比结论。最小要求是说明 upstream 已有什么、OPL 要保留/隐藏/替换
什么、source of truth 属于谁、以及需要哪些 App-owned gates。没有这份对比时，
默认只允许维护 branding、official backend baseline、OPL defaults seed、
executor bridge reference、candidate wrapper 和最小验证。

最近一次 upstream intake：2026-06-17 从
`c6b0eb4de0e5010a752e312c0577a4d04d2a08a5` 更新到
`5e01a5dbf1b7bc0144d9057be706da1ea9f065c3`。本次跟随官方
`apps/desktop` renderer 变化，主要包括 composer 内模型选择器、per-model
reasoning/fast presets、provider disconnect 交互、本地 `/browser connect`
命令、model visibility/status label 细节，以及相关 i18n/test 更新。`apps/shared`、
Electron main process、OPL first-run、OPL Codex gateway 和候选打包 wrapper
未作为 upstream patch 的改动面。

## Authority

本候选不能拥有以下真相源：

- App GUI product truth。
- App page-state、first-run、release gate 和 model-selection policy。
- OPL runtime truth、domain truth、provider implementation、artifact body、
  memory body 或 domain quality verdict。

Hermes Desktop 的 UI 和 design system 是实现材料；OPL 产品定义仍由 App repo
拥有。本仓的验证通过只表示候选技术验证成立，不表示 active-shell adoption、
release-ready、production-ready 或 full-release-ready。

## 本地验证

默认日常验证只做 source/contract 检查，不编译候选包：

```bash
npm run validate:candidate
npm run typecheck
```

只有实际 Hermes 开发任务需要 packaged evidence 时，才人工执行：

```bash
npm run package
npm run validate:candidate -- --require-app
```

不得把 Hermes build/package/smoke/install 接入 push、pull request、schedule、
watch/on-save、daily patrol 或 routine validation。Hermes 不参加 Stable/Nightly
release channel，也没有实时编译路径。

`--require-app` 只检查候选包和默认静默 packaged first-run smoke。默认验证不应打开或
聚焦本机前台窗口；`smoke:opl-first-run` 会设置
`OPL_HERMES_SMOKE_NO_FOREGROUND=1`。

截图/视觉验收单独执行，优先放到 VM/Tart：

```bash
npm run smoke:settings-visual -- --allow-foreground --out out/smoke-settings-visual
npm run validate:candidate -- --require-visual-smoke
```

不要在用户正在使用的主机桌面默认运行 Settings visual smoke；它会打开并聚焦候选
`.app` 以截取页面。

本地候选包输出路径：

```text
release/mac-arm64/One Person Lab Hermes Candidate.app
```

如果后续需要真正提升为 active release shell，必须先回到 App repo 修改
`contracts/app-shell-adapter.json`，并通过 App page-state、first-run、release
channel、packaged runtime、签名/公证和正式 release gates。不能用本仓 manifest、
minimal adapter 自检或 focused tests 直接替代这些 adoption gates。
