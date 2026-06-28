# OPL Hermes Shell Docs

Owner: `opl-hermes-shell`
Purpose: `docs_index`
State: `active_index`
Machine boundary: Human-readable navigation. Candidate acceptance remains in
`package.json`, `contracts/opl-hermes-candidate-profile.json`,
`scripts/validate-hermes-codex-candidate.cjs`, App repo shell-adapter
contracts, candidate manifests, package artifacts, and App-root validation
commands.

This repository is a foreground alternative shell candidate for One Person Lab
App. It does not own App product truth, release readiness, domain truth, owner
receipts, typed blockers, or production readiness.

## Current Docs

| Doc | Role | Boundary |
| --- | --- | --- |
| [Upstream strategy and customization principles](./opl-hermes-upstream-strategy.md) | Hermes Desktop upstream reference, OPL customization strategy, candidate profile boundary, and non-claims | Human-readable candidate guidance; adoption and release decisions stay in the App repo |

## Growth Rule

Keep this docs surface small while Hermes remains a candidate. Add subfolders
only when there are multiple durable docs with the same lifecycle role. Do not
import AGUI/AionUI history or App release evidence into this repo.
