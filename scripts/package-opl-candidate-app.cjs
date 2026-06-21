#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'out')
const releaseDir = path.join(root, 'release')
const manifestPath = path.join(outDir, 'hermes-codex-candidate-manifest.json')
const candidateProfile = JSON.parse(fs.readFileSync(path.join(root, 'contracts/opl-hermes-candidate-profile.json'), 'utf8'))
const candidate = candidateProfile.candidate
const topologyPolicy = candidateProfile.app_topology_policy
const capabilityPolicy = candidateProfile.candidate_capability_policy
const falseReadyBoundary = candidateProfile.false_ready_boundary
const authorityBoundary = candidateProfile.authority_boundary
const productName = candidate.product_name
const executableName = productName
const upstreamSourceRef = candidate.source_ref

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      OPL_HERMES_CODEX_CANDIDATE: '1',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=12288',
      GITHUB_SHA: process.env.GITHUB_SHA || upstreamSourceRef,
      GITHUB_REF_NAME: process.env.GITHUB_REF_NAME || 'opl-hermes-candidate'
    },
    ...options
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`)
}

function findApp(dir) {
  if (!fs.existsSync(dir)) return null
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory() && entry.name.endsWith('.app')) return full
      if (entry.isDirectory()) stack.push(full)
    }
  }
  return null
}

function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      OPL_HERMES_CODEX_CANDIDATE: '1',
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=12288',
      GITHUB_SHA: process.env.GITHUB_SHA || upstreamSourceRef,
      GITHUB_REF_NAME: process.env.GITHUB_REF_NAME || 'opl-hermes-candidate'
    }
  })
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  return result.stdout.trim()
}

function setPlist(plist, key, value) {
  run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
}

function assembleAppBundle() {
  const electronApp = path.join(root, 'node_modules/electron/dist/Electron.app')
  if (!fs.existsSync(electronApp)) throw new Error('Electron.app template missing; run npm install first')
  const appDir = path.join(releaseDir, 'mac-arm64', `${productName}.app`)
  fs.rmSync(path.dirname(appDir), { recursive: true, force: true })
  fs.mkdirSync(path.dirname(appDir), { recursive: true })
  fs.cpSync(electronApp, appDir, { recursive: true, verbatimSymlinks: true })

  const contents = path.join(appDir, 'Contents')
  const resources = path.join(contents, 'Resources')
  fs.copyFileSync(path.join(root, 'assets/icon.icns'), path.join(resources, 'icon.icns'))
  fs.rmSync(path.join(resources, 'app'), { recursive: true, force: true })
  fs.mkdirSync(path.join(resources, 'app'), { recursive: true })
  for (const entry of ['dist', 'electron', 'assets', 'public', 'package.json']) {
    fs.cpSync(path.join(root, entry), path.join(resources, 'app', entry), { recursive: true })
  }
  fs.cpSync(path.join(root, 'build/install-stamp.json'), path.join(resources, 'install-stamp.json'))
  fs.cpSync(path.join(root, 'build/native-deps'), path.join(resources, 'native-deps'), { recursive: true })

  const macOsDir = path.join(contents, 'MacOS')
  const electronBinary = path.join(macOsDir, 'Electron')
  const brandedBinary = path.join(macOsDir, executableName)
  if (!fs.existsSync(electronBinary)) throw new Error(`Electron binary missing from app template: ${electronBinary}`)
  fs.renameSync(electronBinary, brandedBinary)
  fs.chmodSync(brandedBinary, 0o755)

  const plist = path.join(contents, 'Info.plist')
  setPlist(plist, 'CFBundleDisplayName', productName)
  setPlist(plist, 'CFBundleExecutable', executableName)
  setPlist(plist, 'CFBundleName', productName)
  setPlist(plist, 'CFBundleIdentifier', candidate.app_id)
  setPlist(plist, 'CFBundleIconFile', 'icon.icns')
  setPlist(plist, 'LSApplicationCategoryType', 'public.app-category.developer-tools')
  return appDir
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.rmSync(releaseDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })

run('npm', ['run', 'build'])
runCapture(process.execPath, ['-e', "const p=require('electron'); console.log(p)"])
assembleAppBundle()

const appPath = findApp(releaseDir)
if (!appPath) throw new Error('electron-builder did not produce a .app bundle under release/')
const relativeAppPath = path.relative(root, appPath)
const manifest = {
  status: 'candidate_app_bundle_ready',
  shell: candidate.shell_id,
  package_kind: 'explicit_candidate_app_bundle',
  candidate_profile_ref: 'contracts/opl-hermes-candidate-profile.json',
  app_bundle_path: relativeAppPath,
  app_bundle_name: path.basename(appPath),
  app_bundle_executable: executableName,
  source_repo: candidate.source_repo,
  source_path: candidate.source_path,
  source_ref: upstreamSourceRef,
  license: candidate.license,
  default_release_shell_unchanged: topologyPolicy.default_release_shell_unchanged,
  active_shell_adopted: topologyPolicy.active_shell_adopted,
  active_mainline_shell: topologyPolicy.active_mainline_shell,
  foreground_alternative: topologyPolicy.foreground_alternative,
  archived_technical_proof_only: topologyPolicy.archived_technical_proof_only,
  hermes_runtime_authority_transfer: capabilityPolicy.hermes_runtime_authority_transfer,
  official_hermes_backend_preserved: capabilityPolicy.official_hermes_backend_preserved,
  official_hermes_desktop_ui_reused: capabilityPolicy.official_hermes_desktop_ui_reused,
  backend_bridge: {
    strategy: 'preserve_official_hermes_backend_first',
    official_backend: 'Hermes first-launch bootstrap / hermes dashboard',
    opl_defaults_seed: 'electron/opl-defaults.cjs seeds openai_runtime=codex_app_server and MAS/MAG/RCA skills.external_dirs without replacing backend',
    executor_bridge_reference: 'electron/opl-codex-gateway.cjs exposes Hermes-compatible session.create/prompt.submit backed by codex app-server --listen stdio://',
    protocol_mapping: {
      'session.create': 'thread/start',
      'prompt.submit': 'turn/start',
      'item/agentMessage/delta': 'message.delta',
      'turn/completed': 'message.complete'
    },
    planned_opl_executor_adapter: 'deeper OPL state/action diagnostics exposed through Codex Skill/Plugin/MCP-capable runtime, not GUI-side route receipts',
    forbidden_strategy: 'full backend replacement with minimal Codex shim',
    hermes_runtime_authority_transfer: capabilityPolicy.hermes_runtime_authority_transfer,
    codex_runtime_reference: capabilityPolicy.codex_runtime_reference
  },
  implemented_capabilities: capabilityPolicy.implemented_capabilities,
  deferred_until_feature_comparison: capabilityPolicy.deferred_until_feature_comparison,
  forbidden_resurrection_surfaces: capabilityPolicy.forbidden_resurrection_surfaces,
  false_ready_boundary: falseReadyBoundary,
  authority_boundary: authorityBoundary
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
fs.writeFileSync(path.join(outDir, 'hermes-codex-source-receipt.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({
  status: 'opl_hermes_candidate_packaged',
  app_bundle_path: relativeAppPath,
  manifest: path.relative(root, manifestPath)
}, null, 2))
