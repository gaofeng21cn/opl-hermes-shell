# OPL Hermes Shell Candidate Guide

This repository is an external candidate shell checkout for One Person Lab App.
It is derived from `NousResearch/hermes-agent/apps/desktop` and remains a
replaceable implementation carrier. The App product truth stays in
`/Users/gaofeng/workspace/one-person-lab-app`.

Upstream Hermes Desktop / `hermes-agent` is the primary design, implementation,
and maintenance owner for the upstream shell body. OPL does not maintain Hermes
itself; this repository should carry only the thin candidate adaptation required
to compare or bridge Hermes into One Person Lab App.

Allowed OPL changes are limited to the candidate adapter boundary: OPL branding,
Codex app-server bridge wiring, packaging/readback hooks, OPL-owned overlays,
and the smallest verification needed for those surfaces. Hermes source,
renderer/runtime, UI behavior, tests, dependencies, and build structure outside
OPL-owned overlays are read-only by default.

Do not do test slimming, architecture refactors, style or interaction rewrites,
dependency upgrades, or upstream behavior fixes in the Hermes shell body. If a
change appears necessary there, first prove why it cannot be solved from the OPL
App / OPL Framework side, name the exact write set, verification command, and
rollback point, and prefer an upstream issue or PR over local ownership.

Rules:
- Treat the current App GUI topology as fixed unless the App repo changes its
  contracts: AionUI is the active GUI mainline, Hermes Desktop / `hermes-codex`
  is the only foreground alternative, and AGUI / `agui-codex` is archived
  technical proof only.
- Do not make Hermes runtime, gateway, providers, sessions, memory, or installer
  state an OPL source of truth.
- Do not add OPL App state/action, page-state, first-run, Full runtime, or
  release-gate surfaces until they have a Hermes feature comparison and an
  App-owned adoption gate.
- Keep the first candidate bridge small: OPL branding plus a Hermes-compatible
  Codex app-server adapter, while preserving the upstream Hermes Desktop
  feature shape for comparison.
- Do not copy AGUI/CopilotKit proof work, validation burden, WebUI assumptions,
  or polish backlog into this Hermes lane. If AGUI replay is explicitly
  requested, route that work to the archived `opl-agui-codex-shell` surface.
- Treat `docs/opl-hermes-upstream-strategy.md` as the local guide for upstream
  upgrades and OPL customization. Follow upstream Hermes Desktop first, then
  reapply the smallest OPL delta; do not redesign large UI areas without a
  recorded feature comparison.
- Keep AionUI as the default release shell unless the App repo changes
  `contracts/app-shell-adapter.json` explicitly.
- Keep user-facing development docs in Chinese when adding App-facing docs.
- Preserve upstream MIT license notices from Hermes Desktop.
