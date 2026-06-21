#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const root = path.resolve(__dirname, '..')
const requireApp = process.argv.includes('--require-app')
const requireVisualSmoke = process.argv.includes('--require-visual-smoke')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const { describeOplCodexGatewayScope } = require(path.join(root, 'electron/opl-codex-gateway.cjs'))
const mainProcess = read('electron/main.cjs')
const oplBootstrapRunner = read('electron/opl-bootstrap-runner.cjs')
const oplCodexGateway = read('electron/opl-codex-gateway.cjs')
const commandPalette = read('src/app/command-palette/index.tsx')
const routes = read('src/app/routes.ts')
const settings = read('src/app/settings/index.tsx')
const configSettings = read('src/app/settings/config-settings.tsx')
const settingsVisualSmoke = read('scripts/smoke-settings-visual.cjs')
const firstRunSmoke = read('scripts/smoke-opl-first-run.cjs')
const candidateProfile = JSON.parse(read('contracts/opl-hermes-candidate-profile.json'))
const candidate = candidateProfile.candidate
const topologyPolicy = candidateProfile.app_topology_policy
const capabilityPolicy = candidateProfile.candidate_capability_policy
const convergenceProfile = candidateProfile.functional_convergence_readback
const falseReadyBoundary = candidateProfile.false_ready_boundary
const authorityBoundary = candidateProfile.authority_boundary
const upstreamSourceRef = candidate.source_ref
const gatewayScope = describeOplCodexGatewayScope()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function sha256(relativePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(root, relativePath))).digest('hex')
}

function routeKey(route) {
  return `${String(route.method || 'GET').toUpperCase()} ${route.path}`
}

function assertAllFalse(record, label) {
  for (const [key, value] of Object.entries(record || {})) {
    assert(value === false, `${label}.${key} must be false`)
  }
}

function implementedCapabilityEvidence() {
  return {
    official_hermes_desktop_ui_reused: [
      { ref: 'src/app/index.tsx#DesktopController', present: read('src/app/index.tsx').includes('DesktopController') },
      { ref: 'src/main.tsx#HashRouter', present: read('src/main.tsx').includes('HashRouter') }
    ],
    official_hermes_backend_preserved: [
      { ref: 'electron/main.cjs#official-backend-resolution', present: mainProcess.includes('Resolving Hermes backend') },
      { ref: 'README.md#upstream-readme', present: read('README.md').includes('The native desktop app for [Hermes Agent]') }
    ],
    opl_defaults_seed_for_codex_runtime_and_domain_skills: [
      { ref: 'electron/opl-defaults.cjs#openai_runtime', present: read('electron/opl-defaults.cjs').includes('openai_runtime') },
      { ref: 'electron/opl-defaults.cjs#external_dirs', present: read('electron/opl-defaults.cjs').includes('external_dirs') }
    ],
    codex_app_server_backed_hermes_gateway_adapter: [
      {
        ref: 'electron/opl-codex-gateway.cjs#describeOplCodexGatewayScope',
        present:
          gatewayScope.mode === 'codex_app_server_skill_first_adapter' &&
          gatewayScope.executor === 'codex_app_server' &&
          gatewayScope.replacesHermesBackend === false
      },
      { ref: 'electron/opl-codex-gateway.cjs#codex-app-server', present: oplCodexGateway.includes("'app-server', '--listen', 'stdio://'") }
    ],
    opl_branding_and_icon_replaced: [
      { ref: 'package.json#productName', present: pkg.productName === candidate.product_name },
      { ref: 'assets/icon.png', present: fs.existsSync(path.join(root, 'assets/icon.png')) },
      { ref: 'public/apple-touch-icon.png', present: sha256('public/apple-touch-icon.png') === sha256('assets/icon.png') }
    ],
    candidate_app_bundle_package: [
      { ref: 'scripts/package-opl-candidate-app.cjs#candidate-profile', present: read('scripts/package-opl-candidate-app.cjs').includes('contracts/opl-hermes-candidate-profile.json') },
      { ref: 'package.json#package-script', present: Boolean(pkg.scripts?.package && pkg.scripts?.['pack:opl']) }
    ]
  }
}

function assertImplementedCapabilityEvidence() {
  const evidenceByCapability = implementedCapabilityEvidence()
  for (const capability of capabilityPolicy.implemented_capabilities) {
    assert(evidenceByCapability[capability], `implemented capability must have validator evidence: ${capability}`)
    assert(
      evidenceByCapability[capability].every(item => item.present === true),
      `implemented capability is missing source evidence: ${capability}`
    )
  }
}

function buildFunctionalConvergenceReadback() {
  const requiredScope = convergenceProfile.required_adapter_scope
  const implementedEvidence = implementedCapabilityEvidence()
  const restRouteKeys = new Set(gatewayScope.restRoutes.map(routeKey))
  const rpcMethods = new Set(gatewayScope.rpcMethods)
  const requiredRestRoutes = requiredScope.required_rest_routes.map(ref => ({
    ref,
    present: restRouteKeys.has(ref)
  }))
  const forbiddenRestRoutes = requiredScope.forbidden_rest_routes.map(ref => ({
    ref,
    present: restRouteKeys.has(ref)
  }))
  const requiredRpcMethods = requiredScope.required_rpc_methods.map(method => ({
    method,
    present: rpcMethods.has(method)
  }))
  const forbiddenRpcMethods = requiredScope.forbidden_rpc_methods.map(method => ({
    method,
    present: rpcMethods.has(method)
  }))
  const implemented = capabilityPolicy.implemented_capabilities.map(capability => ({
    capability,
    evidence: implementedEvidence[capability]
  }))

  const ok =
    gatewayScope.mode === requiredScope.mode &&
    gatewayScope.executor === requiredScope.executor &&
    gatewayScope.replacesHermesBackend === requiredScope.replaces_hermes_backend &&
    requiredRestRoutes.every(route => route.present) &&
    forbiddenRestRoutes.every(route => !route.present) &&
    requiredRpcMethods.every(method => method.present) &&
    forbiddenRpcMethods.every(method => !method.present) &&
    implemented.every(item => item.evidence?.every(evidence => evidence.present === true)) &&
    Object.values(convergenceProfile.can_claim).every(value => value === false)

  return {
    surface_kind: convergenceProfile.surface_kind,
    schema_version: convergenceProfile.schema_version,
    status: ok ? 'hermes_codex_candidate_functional_convergence_valid' : 'hermes_codex_candidate_functional_convergence_invalid',
    ok,
    state: convergenceProfile.state,
    readback_command_ref: convergenceProfile.readback_command_ref,
    topology: {
      app_product_truth_owner: topologyPolicy.app_product_truth_owner,
      active_mainline_shell: topologyPolicy.active_mainline_shell,
      foreground_alternative: topologyPolicy.foreground_alternative,
      archived_technical_proof_only: topologyPolicy.archived_technical_proof_only,
      default_release_shell_unchanged: topologyPolicy.default_release_shell_unchanged,
      active_shell_adopted: topologyPolicy.active_shell_adopted
    },
    implemented_capabilities: implemented,
    deferred_until_feature_comparison: capabilityPolicy.deferred_until_feature_comparison,
    forbidden_resurrection_surfaces: capabilityPolicy.forbidden_resurrection_surfaces,
    adapter_scope: {
      ref: convergenceProfile.adapter_scope_ref,
      mode: gatewayScope.mode,
      executor: gatewayScope.executor,
      replaces_hermes_backend: gatewayScope.replacesHermesBackend,
      required_rpc_methods: requiredRpcMethods,
      forbidden_rpc_methods: forbiddenRpcMethods,
      required_rest_routes: requiredRestRoutes,
      forbidden_rest_routes: forbiddenRestRoutes,
      upstream_hermes_backend_owns: gatewayScope.upstreamHermesBackendOwns,
      codex_skill_ids: gatewayScope.codexSkills.map(skill => skill.skill_id)
    },
    false_ready_boundary: falseReadyBoundary,
    authority_boundary: authorityBoundary,
    can_claim: convergenceProfile.can_claim
  }
}

function assertIconAlphaBounds({ maxWidth, maxHeight }) {
  const iconBounds = require('node:child_process')
    .spawnSync('magick', ['assets/icon.png', '-alpha', 'extract', '-format', '%@', 'info:'], { cwd: root, encoding: 'utf8' })
    .stdout.trim()
  const match = iconBounds.match(/^(\d+)x(\d+)\+(\d+)\+(\d+)$/)
  assert(match, `could not read icon alpha bounds: ${iconBounds}`)
  assert(
    Number(match[1]) <= maxWidth && Number(match[2]) <= maxHeight,
    `icon content must keep macOS Dock safe margin, got ${iconBounds}`
  )
}

assert(pkg.name === 'opl-hermes-shell', 'package name must be opl-hermes-shell')
assert(candidateProfile.surface_kind === 'opl_hermes_candidate_profile', 'candidate profile must declare the expected surface kind')
assert(candidateProfile.schema_version === 'opl-hermes-candidate-profile.v1', 'candidate profile schema version must be current')
assert(pkg.name === candidate.package_name, 'package name must match candidate profile')
assert(pkg.productName === candidate.product_name, 'productName must match candidate profile')
assert(pkg.build?.appId === candidate.app_id, 'appId must match candidate profile')
assert(pkg.build?.protocols?.some(protocol => (protocol.schemes || []).includes(candidate.protocol_scheme)), 'protocol scheme must match candidate profile')
assert(pkg.main === candidate.main_process, 'main must keep official Hermes Desktop main process')
assert(read('README_OPL.md').includes(`evaluated source ref: \`${upstreamSourceRef}\``), 'README_OPL.md must record the current upstream source ref')
assert(read('docs/opl-hermes-upstream-strategy.md').includes(`evaluated source ref: \`${upstreamSourceRef}\``), 'upstream strategy doc must record the current upstream source ref')
assert(read('scripts/package-opl-candidate-app.cjs').includes("contracts/opl-hermes-candidate-profile.json"), 'candidate package wrapper must read the candidate profile contract')
assert(topologyPolicy.active_mainline_shell === 'AionUI/opl-aion-shell', 'candidate profile must preserve AionUI as active mainline')
assert(topologyPolicy.foreground_alternative === 'Hermes Desktop/hermes-codex', 'candidate profile must declare Hermes as the only foreground alternative')
assert(topologyPolicy.archived_technical_proof_only === 'AGUI/agui-codex', 'candidate profile must keep AGUI archived')
assert(topologyPolicy.default_release_shell_unchanged === true, 'candidate profile must not switch the default release shell')
assert(topologyPolicy.active_shell_adopted === false, 'candidate profile must not claim active-shell adoption')
assert(capabilityPolicy.official_hermes_backend_preserved === true, 'candidate profile must preserve the official Hermes backend')
assert(capabilityPolicy.backend_replacement_allowed === false, 'candidate profile must forbid full backend replacement')
assert(capabilityPolicy.hermes_runtime_authority_transfer === false, 'candidate profile must not transfer Hermes runtime authority')
assert(capabilityPolicy.codex_runtime_reference === 'codex app-server --listen stdio://', 'candidate profile must point at Codex app-server as adapter runtime')
assert(capabilityPolicy.deferred_until_feature_comparison.includes('webui_parity_wrapper'), 'candidate profile must defer WebUI parity until comparison')
assert(capabilityPolicy.forbidden_resurrection_surfaces.includes('AGUI_default_candidate_path'), 'candidate profile must forbid AGUI foreground resurrection')
assert(convergenceProfile.surface_kind === 'opl_hermes_candidate_functional_convergence_readback', 'candidate profile must define the convergence readback surface')
assert(convergenceProfile.schema_version === 'opl-hermes-functional-convergence-readback.v1', 'candidate profile must keep the convergence readback schema current')
assert(convergenceProfile.readback_command_ref === 'npm run validate:candidate', 'candidate profile must route convergence readback through validate:candidate')
assert(convergenceProfile.state === 'technical_verification_candidate_not_active_shell', 'convergence readback must not claim active-shell adoption')
assert(convergenceProfile.adapter_scope_ref === 'electron/opl-codex-gateway.cjs#describeOplCodexGatewayScope', 'convergence readback must point at the gateway scope helper')
assert(convergenceProfile.required_adapter_scope.mode === 'codex_app_server_skill_first_adapter', 'convergence readback must require the Codex app-server adapter')
assert(convergenceProfile.required_adapter_scope.executor === 'codex_app_server', 'convergence readback must require Codex app-server executor scope')
assert(convergenceProfile.required_adapter_scope.replaces_hermes_backend === false, 'convergence readback must forbid Hermes backend replacement')
assertAllFalse(convergenceProfile.can_claim, 'functional_convergence_readback.can_claim')
assert(falseReadyBoundary.candidate_valid_can_claim_active_shell_adopted === false, 'candidate validation cannot claim active-shell adoption')
assert(falseReadyBoundary.candidate_valid_can_claim_app_release_ready === false, 'candidate validation cannot claim release readiness')
assert(falseReadyBoundary.candidate_manifest_can_replace_app_contracts === false, 'candidate manifest cannot replace App contracts')
assertAllFalse(falseReadyBoundary, 'false_ready_boundary')
assert(authorityBoundary.can_replace_app_product_truth === false, 'candidate profile cannot replace App product truth')
assert(authorityBoundary.can_restore_agui_foreground_candidate === false, 'candidate profile cannot restore AGUI as a foreground candidate')
assertAllFalse(authorityBoundary, 'authority_boundary')
assert(read('README.md').includes('The native desktop app for [Hermes Agent]'), 'official Hermes README must remain available')
assert(read('UPSTREAM_README.md').includes('Hermes Agent'), 'upstream README receipt must remain available')
assert(mainProcess.includes("Resolving Hermes backend"), 'main process must preserve official Hermes backend resolution')
assert(mainProcess.includes("seedOplHermesDefaults"), 'main process must seed OPL defaults through the official Hermes runtime')
assert(mainProcess.includes("createOplCodexGateway"), 'main process must start the OPL Codex adapter for the OPL fallback path')
assert(mainProcess.includes('OPL_HERMES_SMOKE_NO_FOREGROUND'), 'main process must support non-foreground smoke mode')
assert(mainProcess.includes('if (OPL_SMOKE_NO_FOREGROUND) return'), 'main process must guard show/focus paths during smoke')
assert(firstRunSmoke.includes("OPL_HERMES_SMOKE_NO_FOREGROUND: '1'"), 'packaged first-run smoke must request non-foreground app launch')
assert(settingsVisualSmoke.includes('--allow-foreground'), 'Settings visual smoke must require explicit foreground opt-in')
assert(settingsVisualSmoke.includes('opens/focuses the app to capture screenshots'), 'Settings visual smoke must explain foreground behavior')
assert(
  mainProcess.includes("OPL_CODEX_CANDIDATE && backend.kind === 'bootstrap-needed'"),
  'OPL candidate must intercept missing Hermes runtime before official Hermes bootstrap'
)
assert(mainProcess.includes("runOplBootstrap"), 'OPL candidate must run App-managed OPL initialization when Hermes runtime is absent')
assert(
  mainProcess.indexOf('await runOplBootstrap') < mainProcess.indexOf('const bootstrapResult = await runBootstrap'),
  'OPL bootstrap interception must happen before the official Hermes installer path'
)
assert(fs.existsSync(path.join(root, 'electron/opl-bootstrap-runner.cjs')), 'candidate must include electron/opl-bootstrap-runner.cjs')
assert(fs.existsSync(path.join(root, 'electron/opl-startup-marker.cjs')), 'candidate must include electron/opl-startup-marker.cjs')
assert(fs.existsSync(path.join(root, 'electron/opl-bootstrap-runner.test.cjs')), 'candidate must include electron/opl-bootstrap-runner.test.cjs')
assert(fs.existsSync(path.join(root, 'electron/opl-codex-gateway.test.cjs')), 'candidate must include electron/opl-codex-gateway.test.cjs')
assert(fs.existsSync(path.join(root, 'scripts/smoke-settings-visual.cjs')), 'candidate must include packaged Settings visual smoke')
assert(JSON.stringify(pkg.scripts || {}).includes('smoke:settings-visual'), 'package scripts must expose smoke:settings-visual')
assert(oplBootstrapRunner.includes("require('./opl-startup-marker.cjs')"), 'OPL bootstrap runner must use the OPL startup marker')
assert(oplBootstrapRunner.includes('classifyStartupMarker'), 'OPL bootstrap runner must classify startup marker before full initialize')
assert(oplBootstrapRunner.includes("startupMode: 'lightweight'"), 'OPL bootstrap runner must support lightweight startup')
assert(oplBootstrapRunner.includes('buildUserDeferredBootstrap'), 'OPL bootstrap runner must support user-deferred first-run setup')
assert(oplBootstrapRunner.includes("startupMode: 'user_deferred'"), 'OPL bootstrap runner must persist user-deferred first-run setup')
assert(oplBootstrapRunner.includes("'app', 'state', '--profile', 'fast', '--json'"), 'OPL bootstrap runner must use fast app state readiness before one-time initialization')
assert(oplBootstrapRunner.includes("startup_path: 'lightweight_probe'"), 'OPL bootstrap runner must refresh marker from a successful fast readiness probe')
assert(oplBootstrapRunner.includes("startup_path: 'user_deferred'"), 'OPL bootstrap runner must mark skipped setup as user_deferred')
assert(oplBootstrapRunner.includes("'system', 'initialize', '--json'"), 'OPL bootstrap runner must call opl system initialize --json')
assert(oplBootstrapRunner.includes("'install', '--skip-gui-open', '--skip-modules', '--skip-native-helper-repair', '--json'"), 'OPL bootstrap runner must run OPL core install without opening GUI')
assert(oplBootstrapRunner.includes("'system', 'startup-maintenance', '--json'"), 'OPL bootstrap runner must run startup maintenance when configured')
assert(oplBootstrapRunner.includes("'system', 'reconcile-modules', '--json'"), 'OPL bootstrap runner must reconcile modules when configured')
assert(oplBootstrapRunner.includes('maintenanceDeferred'), 'OPL bootstrap runner must defer maintenance until after adapter readiness')
assert(mainProcess.includes('OPL_STARTUP_MARKER_PATH'), 'main process must provide an OPL startup marker path')
assert(mainProcess.includes('removeOplStartupMarker(OPL_STARTUP_MARKER_PATH)'), 'bootstrap repair must clear the OPL startup marker')
assert(mainProcess.includes('startOplMaintenanceInBackground'), 'main process must start deferred OPL maintenance after adapter readiness')
assert(read('electron/opl-defaults.cjs').includes("openai_runtime"), 'OPL defaults must seed Codex app-server runtime')
assert(read('electron/opl-defaults.cjs').includes("external_dirs"), 'OPL defaults must seed Hermes external skill dirs')
assert(oplCodexGateway.includes("replacesHermesBackend: false"), 'adapter scope must declare it does not replace Hermes backend')
assert(oplCodexGateway.includes("executor: 'codex_app_server'"), 'adapter scope must declare Codex app-server as executor')
assert(oplCodexGateway.includes("'app-server', '--listen', 'stdio://'"), 'adapter must spawn Codex app-server over stdio')
assert(oplCodexGateway.includes("'thread/start'"), 'adapter must map Hermes session.create to Codex thread/start')
assert(oplCodexGateway.includes("'turn/start'"), 'adapter must map Hermes prompt.submit to Codex turn/start')
assert(oplCodexGateway.includes("'item/agentMessage/delta'"), 'adapter must map Codex deltas to Hermes message.delta')
assert(!oplCodexGateway.includes('exec --json'), 'adapter must not use the old codex exec JSON shim')
assert(oplCodexGateway.includes("configure-codex"), 'adapter must configure Codex through OPL gflabtoken setup')
assert(oplCodexGateway.includes("'/api/profiles'"), 'adapter must provide renderer-safe profile bootstrap routes')
assert(oplCodexGateway.includes("'/api/config'"), 'adapter must provide renderer-safe config bootstrap routes')
assert(oplCodexGateway.includes("'/api/providers/oauth'"), 'adapter must provide renderer-safe OAuth provider bootstrap route')
assert(oplCodexGateway.includes("providers: []"), 'adapter must report no OAuth providers for the OPL model access path')
assert(oplCodexGateway.includes('onboarding_deferred'), 'adapter must expose user-deferred onboarding status')
assert(oplCodexGateway.includes("session.create"), 'adapter must implement Hermes session.create RPC')
assert(oplCodexGateway.includes("prompt.submit"), 'adapter must implement Hermes prompt.submit RPC')
assert(oplCodexGateway.includes("result: { ok: true, accepted: true }"), 'adapter prompt.submit must acknowledge before the Codex turn completes')
assert(oplCodexGateway.includes('stripLegacyPurposeRouteReceipt'), 'adapter must strip legacy OPL purpose-route receipts before sending prompts to Codex')
assert(oplCodexGateway.includes("codex.skills"), 'adapter must expose Codex skill catalog RPC')
assert(oplCodexGateway.includes("'/api/opl/codex-skills'"), 'adapter must expose Codex skill catalog REST route')
assert(oplCodexGateway.includes('commands.catalog'), 'adapter must expose OPL Skill slash command catalog')
assert(oplCodexGateway.includes('complete.slash'), 'adapter must expose OPL Skill slash completions')
assert(!oplCodexGateway.includes("purpose.route.resolve"), 'adapter must not implement GUI-side purpose route resolve RPC')
assert(!oplCodexGateway.includes("'/api/opl/purpose-routes'"), 'adapter must not expose legacy purpose route catalog REST route')
assert(oplCodexGateway.includes("Med Auto Science"), 'adapter must declare the MAS Codex skill shortcut')
assert(oplCodexGateway.includes("Med Auto Grant"), 'adapter must declare the MAG Codex skill shortcut')
assert(oplCodexGateway.includes("RedCube AI"), 'adapter must declare the RCA Codex skill shortcut')
assert(
  !oplCodexGateway.includes("'app'") || !oplCodexGateway.includes("'action'") || !oplCodexGateway.includes("'execute'"),
  'adapter must not preflight MAS/MAG/RCA through OPL app action execute'
)
assert(!oplCodexGateway.includes("route.receipt"), 'adapter must not emit GUI-side purpose route receipts')
assert(!oplCodexGateway.includes("route.error"), 'adapter must not emit GUI-side purpose route blockers')
assert(oplCodexGateway.includes("tool.event"), 'adapter must bridge Codex tool events to Hermes-compatible events')
assert(oplCodexGateway.includes("approval.event"), 'adapter must bridge Codex approval events to Hermes-compatible events')
assert(oplCodexGateway.includes("config.get"), 'adapter must implement renderer-safe config.get RPC')
assert(oplCodexGateway.includes("config.set"), 'adapter must implement renderer-safe config.set RPC')
assert(
  read('src/store/onboarding.ts').includes("setup?.provider_configured === true"),
  'onboarding must auto-skip the model access form when setup.status already reports configured credentials'
)
assert(
  commandPalette.includes("tab: 'providers'") && commandPalette.includes("tab: 'agents'"),
  'command palette must keep ordinary OPL model access and agents/capabilities settings entries'
)
assert(!commandPalette.includes("tab: 'mcp'"), 'command palette must not expose MCP as an ordinary Phase 1 entry')
assert(!commandPalette.includes("tab: 'gateway'"), 'command palette must not expose the upstream gateway settings entry')
assert(!commandPalette.includes("tab: 'keys&kview=tools'"), 'command palette must not expose the upstream tools/key settings entry')
assert(!commandPalette.includes("tab: 'keys&kview=settings'"), 'command palette must not expose the upstream key gateway settings entry')
assert(
  routes.includes('HIDDEN_FULL_HERMES_ROUTE_REDIRECTS') &&
    routes.includes('[SKILLS_ROUTE]') &&
    routes.includes('[MESSAGING_ROUTE]') &&
    routes.includes('[ARTIFACTS_ROUTE]') &&
    routes.includes('[CRON_ROUTE]') &&
    routes.includes('[PROFILES_ROUTE]') &&
    routes.includes('[AGENTS_ROUTE]'),
  'routes must redirect hidden full-Hermes pages to supported Phase 1 surfaces'
)
assert(settings.includes("'agents'"), 'Settings must expose the OPL agents/capabilities page')
assert(settings.includes("'mcp'"), 'Settings must keep MCP as a diagnostic deep link target')
assert(configSettings.includes('tab=mcp'), 'Advanced Settings must deep-link to MCP diagnostics instead of ordinary palette navigation')
assert(fs.existsSync(path.join(root, 'src/app/settings/agents-capabilities-settings.tsx')), 'candidate must include the OPL agents/capabilities settings page')
assert(read('src/app/index.tsx').includes("DesktopController"), 'candidate must reuse official Hermes Desktop app shell')
assert(read('src/main.tsx').includes("HashRouter"), 'candidate must keep official renderer entry')
assert(sha256('public/apple-touch-icon.png') === sha256('assets/icon.png'), 'runtime apple-touch-icon.png must match the OPL app icon')
assertIconAlphaBounds({ maxWidth: 900, maxHeight: 900 })
assert(!fs.existsSync(path.join(root, 'resources/opl-install.sh')), 'candidate must not carry stable OPL install wrapper')
assert(!fs.existsSync(path.join(root, 'scripts/validate-opl-state-model.cjs')), 'candidate must not claim OPL page-state/state-model mapping yet')
assert(!fs.existsSync(path.join(root, 'scripts/validate-packaged-runtime.cjs')), 'candidate must not carry packaged-runtime gate yet')
assert(!fs.existsSync(path.join(root, 'src/candidateContractEvidence.json')), 'candidate must not use static evidence as truth')
assertImplementedCapabilityEvidence()

const functionalConvergenceReadback = buildFunctionalConvergenceReadback()
assert(functionalConvergenceReadback.ok === true, 'functional convergence readback must be valid')

if (requireApp) {
  const manifestPath = path.join(root, 'out/hermes-codex-candidate-manifest.json')
  assert(fs.existsSync(manifestPath), 'candidate manifest missing')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert(manifest.status === 'candidate_app_bundle_ready', 'manifest status must be ready')
  assert(manifest.candidate_profile_ref === 'contracts/opl-hermes-candidate-profile.json', 'candidate manifest must reference the candidate profile contract')
  assert(manifest.shell === candidate.shell_id, 'candidate manifest shell must match candidate profile')
  assert(manifest.source_ref === upstreamSourceRef, 'candidate manifest must use the current upstream source ref')
  assert(manifest.default_release_shell_unchanged === topologyPolicy.default_release_shell_unchanged, 'candidate manifest must keep the default release shell unchanged')
  assert(manifest.active_shell_adopted === topologyPolicy.active_shell_adopted, 'candidate manifest must not claim active shell adoption')
  assert(manifest.authority_boundary?.can_replace_app_product_truth === false, 'candidate manifest must preserve App product truth authority')
  assert(manifest.false_ready_boundary?.candidate_valid_can_claim_app_release_ready === false, 'candidate manifest must carry the false-ready boundary')
  const appPath = path.join(root, manifest.app_bundle_path)
  assert(fs.existsSync(path.join(appPath, 'Contents/Info.plist')), 'Info.plist missing')
  const info = read(path.relative(root, path.join(appPath, 'Contents/Info.plist')))
  assert(info.includes('One Person Lab Hermes Candidate'), 'Info.plist must contain OPL product name')
  assert(info.includes('CFBundleExecutable') && info.includes('One Person Lab Hermes Candidate'), 'Info.plist must use the OPL executable name')
  assert(fs.existsSync(path.join(appPath, 'Contents/MacOS/One Person Lab Hermes Candidate')), 'packaged app must include the OPL named executable')
  assert(!fs.existsSync(path.join(appPath, 'Contents/MacOS/Electron')), 'packaged app must not expose the legacy Electron executable name')
  const packagedAppRoot = path.join(appPath, 'Contents/Resources/app')
  assert(fs.existsSync(path.join(packagedAppRoot, 'electron/opl-defaults.cjs')), 'packaged app must include OPL defaults seed')
  const packagedBootstrap = fs.readFileSync(path.join(packagedAppRoot, 'electron/opl-bootstrap-runner.cjs'), 'utf8')
  const packagedGateway = fs.readFileSync(path.join(packagedAppRoot, 'electron/opl-codex-gateway.cjs'), 'utf8')
  assert(fs.existsSync(path.join(packagedAppRoot, 'electron/opl-startup-marker.cjs')), 'packaged app must include OPL startup marker helper')
  for (const stage of [
    'opl-cli-check',
    'codex-cli-check',
    'opl-initialize',
    'opl-core-setup',
    'opl-post-setup-check',
    'opl-codex-adapter',
    'opl-maintenance-schedule'
  ]) {
    assert(packagedBootstrap.includes(`name: '${stage}'`), `packaged bootstrap runner must include ${stage}`)
  }
  assert(packagedGateway.includes("'app-server', '--listen', 'stdio://'"), 'packaged adapter must spawn Codex app-server over stdio')
  assert(packagedBootstrap.includes('classifyStartupMarker'), 'packaged bootstrap runner must support marker-based lightweight startup')
  assert(packagedBootstrap.includes("startup_path: 'user_deferred'"), 'packaged bootstrap runner must support user-deferred first-run setup')
  assert(packagedBootstrap.includes("'app', 'state', '--profile', 'fast', '--json'"), 'packaged bootstrap runner must use fast app state readiness before one-time initialization')
  assert(packagedBootstrap.includes("startup_path: 'lightweight_probe'"), 'packaged bootstrap runner must refresh marker from a successful fast readiness probe')
  assert(packagedGateway.includes('stripLegacyPurposeRouteReceipt'), 'packaged adapter must strip legacy route receipts')
  assert(packagedGateway.includes("'thread/start'"), 'packaged adapter must include thread/start mapping')
  assert(packagedGateway.includes("'turn/start'"), 'packaged adapter must include turn/start mapping')
  assert(packagedGateway.includes("'item/agentMessage/delta'"), 'packaged adapter must include agent delta mapping')
  assert(packagedGateway.includes('onboarding_deferred'), 'packaged adapter must expose user-deferred onboarding status')
  assert(!packagedGateway.includes('exec --json'), 'packaged adapter must not include old codex exec JSON shim')
  const packagedStamp = JSON.parse(fs.readFileSync(path.join(appPath, 'Contents/Resources/install-stamp.json'), 'utf8'))
  assert(packagedStamp.commit === upstreamSourceRef, 'packaged install-stamp.json must use the current upstream source ref')
  assert(fs.existsSync(path.join(packagedAppRoot, 'public/apple-touch-icon.png')), 'packaged app must include runtime apple-touch-icon.png')
  const packagedIconHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(packagedAppRoot, 'assets/icon.png'))).digest('hex')
  const packagedAppleIconHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(packagedAppRoot, 'public/apple-touch-icon.png'))).digest('hex')
  assert(packagedIconHash === packagedAppleIconHash, 'packaged runtime apple-touch-icon.png must match the OPL app icon')
  const firstRunSummaryPath = path.join(root, 'out/smoke-opl-first-run/summary.json')
  assert(fs.existsSync(firstRunSummaryPath), 'packaged first-run smoke summary missing; run npm run smoke:opl-first-run')
  const firstRunSummary = JSON.parse(fs.readFileSync(firstRunSummaryPath, 'utf8'))
  assert(firstRunSummary.status === 'opl_hermes_packaged_first_run_smoke_passed', 'packaged first-run smoke must pass')
  const userDeferred = firstRunSummary.cases?.user_deferred_first_run
  assert(userDeferred, 'packaged first-run smoke must include user_deferred_first_run case')
  assert(userDeferred.gateway?.skip?.clicked === true, 'packaged first-run smoke must click Skip and enter chat')
  assert(
    userDeferred.gateway?.skip?.renderer_main_ready_after_skip === true,
    'packaged first-run smoke must prove the renderer enters the main UI after skip'
  )
  assert(
    userDeferred.gateway?.setupStatus?.onboarding_deferred === true,
    'packaged first-run smoke must prove setup.status.onboarding_deferred'
  )
  assert(
    userDeferred.gateway?.setupStatus?.provider_configured === false,
    'packaged first-run smoke must not mark provider_configured after user-deferred setup'
  )
  assert(
    userDeferred.gateway?.env?.openai_api_key_is_set === false,
    'packaged first-run smoke must not mark OPENAI_API_KEY as configured after user-deferred setup'
  )
  assert(
    userDeferred.gateway?.status?.backend === 'codex-app-server-adapter',
    'packaged first-run smoke must start the Codex adapter after user-deferred setup'
  )
  const configured = firstRunSummary.cases?.configured_key
  assert(configured?.chatEvidence?.skill_input_forwarded === true, 'packaged first-run smoke must prove $mas reaches Codex as a structured skill input')
  assert(configured?.chatEvidence?.prompt_submit_long_turn_immediate_ack === true, 'packaged first-run smoke must prove long prompt.submit gets an immediate ack')
  assert(Number(configured?.chatEvidence?.prompt_submit_long_turn_ack_ms ?? Infinity) < 3000, 'packaged first-run smoke long prompt.submit ack must be under 3000ms')
  assert(configured?.chatEvidence?.prompt_submit_long_turn_completed_after_ack === true, 'packaged first-run smoke must prove long turn completion arrives after ack')
  assert(configured?.chatEvidence?.legacy_route_stripped_packaged === true, 'packaged first-run smoke must prove legacy OPL route wrappers are stripped before Codex')
  const configuredCodexCalls = configured?.codexCalls || []
  const longTurn = configuredCodexCalls
    .filter(call => call.method === 'turn/start')
    .find(call => call.params?.input?.some(input => input.type === 'text' && String(input.text || '').includes('long turn packaged smoke')))
  const longPromptText = longTurn?.params?.input?.find(input => input.type === 'text')?.text || ''
  assert(longTurn, 'packaged first-run smoke must include a long turn prompt sent to Codex')
  assert(!/OPL purpose route receipt/i.test(longPromptText), 'packaged long turn prompt must not include legacy route receipt')
  assert(!/route_readback_ready/i.test(longPromptText), 'packaged long turn prompt must not include legacy route status')
  assert(!/Opl route/i.test(longPromptText), 'packaged long turn prompt must not include legacy Opl route label')
}

if (requireVisualSmoke) {
  const settingsVisualSummaryPath = path.join(root, 'out/smoke-settings-visual/settings-visual-summary.json')
  assert(
    fs.existsSync(settingsVisualSummaryPath),
    'packaged Settings visual smoke summary missing; run npm run smoke:settings-visual -- --allow-foreground --out out/smoke-settings-visual in VM/Tart or on an idle machine'
  )
  const settingsVisualSummary = JSON.parse(fs.readFileSync(settingsVisualSummaryPath, 'utf8'))
  assert(settingsVisualSummary.status === 'opl_hermes_settings_visual_smoke_passed', 'packaged Settings visual smoke must pass')
  assert(settingsVisualSummary.assertions?.home_nonblank === true, 'packaged Settings visual smoke must prove a nonblank home')
  assert(settingsVisualSummary.assertions?.home_branding_opl === true, 'packaged Settings visual smoke must prove OPL home branding')
  assert(settingsVisualSummary.assertions?.home_legacy_hermes_wordmark_hidden === true, 'packaged Settings visual smoke must prove legacy Hermes home wordmark is hidden')
  assert(settingsVisualSummary.assertions?.home_skill_chips_visible === true, 'packaged Settings visual smoke must prove home Codex Skill chips are visible')
  assert(settingsVisualSummary.assertions?.home_skill_chip_inserts_prompt === true, 'packaged Settings visual smoke must prove home Codex Skill chips write into the composer')
  assert(settingsVisualSummary.assertions?.model_access_gflabtoken_only === true, 'packaged Settings visual smoke must prove gflabtoken-only model access')
  assert(settingsVisualSummary.assertions?.agents_capabilities_skills_visible === true, 'packaged Settings visual smoke must prove agents/capabilities Codex Skills are visible')
  assert(settingsVisualSummary.assertions?.forbidden_provider_controls_hidden === true, 'packaged Settings visual smoke must prove forbidden provider controls are hidden')
  for (const screenshot of Object.values(settingsVisualSummary.screenshots || {})) {
    assert(screenshot?.path && fs.existsSync(screenshot.path), `packaged Settings visual smoke screenshot missing: ${screenshot?.path}`)
    assert(Number(screenshot.bytes || 0) > 1_000, `packaged Settings visual smoke screenshot too small: ${screenshot.path}`)
    assert(Number(screenshot.width || 0) >= 1_000, `packaged Settings visual smoke screenshot width too small: ${screenshot.path}`)
    assert(Number(screenshot.height || 0) >= 700, `packaged Settings visual smoke screenshot height too small: ${screenshot.path}`)
  }
  const homeScreenshot = settingsVisualSummary.screenshots?.desktop_home
  assert(Number(homeScreenshot?.bytes || 0) > 50_000, `packaged home visual smoke screenshot looks blank or under-rendered: ${homeScreenshot?.path}`)
}

console.log(JSON.stringify({
  status: 'hermes_codex_candidate_valid',
  require_app: requireApp,
  require_visual_smoke: requireVisualSmoke,
  functional_convergence_readback: functionalConvergenceReadback
}, null, 2))
