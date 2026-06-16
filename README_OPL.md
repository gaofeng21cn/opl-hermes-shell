# One Person Lab Hermes Candidate

Owner: `opl-hermes-shell`
Purpose: `hermes_desktop_candidate_shell`
State: `technical_verification_candidate_minimal_adapter`
Machine boundary: 本文是人读候选 shell 说明。OPL App 产品真相仍在
`/Users/gaofeng/workspace/one-person-lab-app` 的 contracts、docs、page-state
matrix、release gates 和验证脚本中。

本仓是 One Person Lab App 的独立 Hermes Desktop 候选 shell。它从官方
`NousResearch/hermes-agent` 的 `apps/desktop` 复制而来，目标是验证一条更接近
Codex App 换壳体验的 GUI 路线。

- upstream repository: `https://github.com/NousResearch/hermes-agent`
- upstream subtree: `apps/desktop`
- evaluated source ref: `c6b0eb4de0e5010a752e312c0577a4d04d2a08a5`
- upstream license: MIT
- local shared package: `apps/shared` copied to `packages/shared`

长期维护原则见
[`docs/opl-hermes-upstream-strategy.md`](docs/opl-hermes-upstream-strategy.md)。
简要说，本仓必须把官方 Hermes Desktop 当成明确参考系：升级时先对照 upstream，
再重放最小 OPL delta。OPL 定制默认是品牌化、隐藏不需要的普通用户概念、把后端
接到 Codex CLI，以及通过 App repo contract gate 接入必要能力；不是从零重写 GUI，
也不是把 AionUI/AGUI 稳定线能力闭着眼睛搬过来。

## 当前候选边界

本仓只作为 App repo 的外部候选实现载体。当前 active/release shell 仍是
AionUI；只有显式使用 App repo 的 Hermes adapter contract 时，App wrapper 才会
选择本候选：

```bash
OPL_APP_SHELL_ADAPTER_CONTRACT=contracts/shell-adapters/hermes-codex.json npm run package
```

当前候选只替换最小三层：

- branding/package identity：`One Person Lab Hermes Candidate`，
  bundle id `cn.onepersonlab.app.hermes-codex-candidate`，图标复用当前 OPL
  AionUI 正式版图标。
- backend adapter：`electron/opl-codex-gateway.cjs` 用 Hermes Desktop 期望的
  REST/WebSocket JSON-RPC 形状连接 Codex CLI，`prompt.submit` 映射到
  `codex exec --json <prompt>`。
- candidate package wrapper：`scripts/package-opl-candidate-app.cjs` 生成本地
  macOS `.app` 候选包，并写出 `out/hermes-codex-candidate-manifest.json`。

在完成 Hermes 原生功能对比前，以下内容不进入本候选基线：

- App product profile generated config。
- `opl app state/action` bridge。
- App page-state / first-run matrix mapping。
- Full packaged runtime。
- Stable release asset normalization / verification。
- WebUI parity wrapper。

这些面如果后续需要接入，必须先记录 Hermes Desktop 原生功能、OPL 需要保留或替换
的理由、以及 App-owned adoption gate；不能按 AionUI/AGUI 旧稳定路径直接搬运。

其中 WebUI parity 的设计要求是同源 UI：复用 Hermes React/Vite renderer，通过
browser shim 和容器内 Web server 替代 Electron preload/IPC，不另写第二套 Web
界面。具体 TODO 见
[`docs/opl-hermes-upstream-strategy.md#同源-webui-设计要求`](docs/opl-hermes-upstream-strategy.md#同源-webui-设计要求)。

## 后续升级与功能对比

升级 Hermes Desktop 或新增 OPL 能力前，先按
[`docs/opl-hermes-upstream-strategy.md`](docs/opl-hermes-upstream-strategy.md)
记录参考系与对比结论。最小要求是说明 upstream 已有什么、OPL 要保留/隐藏/替换
什么、source of truth 属于谁、以及需要哪些 App-owned gates。没有这份对比时，
默认只允许维护 branding、Codex CLI adapter、candidate wrapper 和最小验证。

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

常用验证命令：

```bash
npm run validate:candidate
npm run typecheck
npm run package
npm run validate:candidate -- --require-app
```

本地候选包输出路径：

```text
release/mac-arm64/One Person Lab Hermes Candidate.app
```

如果后续需要真正提升为 active release shell，必须先回到 App repo 修改
`contracts/app-shell-adapter.json`，并通过 App page-state、first-run、release
channel、packaged runtime、签名/公证和正式 release gates。不能用本仓 manifest、
minimal adapter 自检或 focused tests 直接替代这些 adoption gates。
