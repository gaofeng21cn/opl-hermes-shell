#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const outDir = path.join(root, 'out')
const releaseDir = path.join(root, 'release')
const manifestPath = path.join(outDir, 'hermes-codex-candidate-manifest.json')
const productName = 'One Person Lab Hermes Candidate'
const upstreamSourceRef = 'c6b0eb4de0e5010a752e312c0577a4d04d2a08a5'

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
  for (const entry of ['dist', 'electron', 'assets', 'package.json']) {
    fs.cpSync(path.join(root, entry), path.join(resources, 'app', entry), { recursive: true })
  }
  fs.cpSync(path.join(root, 'build/install-stamp.json'), path.join(resources, 'install-stamp.json'))
  fs.cpSync(path.join(root, 'build/native-deps'), path.join(resources, 'native-deps'), { recursive: true })

  const plist = path.join(contents, 'Info.plist')
  setPlist(plist, 'CFBundleDisplayName', productName)
  setPlist(plist, 'CFBundleExecutable', 'Electron')
  setPlist(plist, 'CFBundleName', productName)
  setPlist(plist, 'CFBundleIdentifier', 'cn.onepersonlab.app.hermes-codex-candidate')
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
  shell: 'hermes-codex',
  package_kind: 'explicit_candidate_app_bundle',
  app_bundle_path: relativeAppPath,
  app_bundle_name: path.basename(appPath),
  source_repo: 'https://github.com/NousResearch/hermes-agent',
  source_path: 'apps/desktop',
  source_ref: upstreamSourceRef,
  license: 'MIT',
  default_release_shell_unchanged: true,
  active_shell_adopted: false,
  hermes_runtime_authority_transfer: false,
  official_hermes_desktop_ui_reused: true,
  backend_bridge: {
    electron_main_adapter: 'electron/opl-codex-gateway.cjs',
    codex_cli_command: 'codex exec --json <prompt>',
    hermes_runtime_authority_transfer: false
  },
  implemented_capabilities: [
    'official_hermes_desktop_ui_reused',
    'opl_branding_and_icon_replaced',
    'codex_cli_candidate_backend_adapter',
    'candidate_app_bundle_package'
  ],
  deferred_until_feature_comparison: [
    'opl_app_state_action_bridge',
    'app_product_profile_mapping',
    'page_state_matrix_mapping',
    'first_run_matrix_mapping',
    'packaged_full_runtime',
    'stable_release_asset_normalization'
  ]
}
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
fs.writeFileSync(path.join(outDir, 'hermes-codex-source-receipt.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(JSON.stringify({
  status: 'opl_hermes_candidate_packaged',
  app_bundle_path: relativeAppPath,
  manifest: path.relative(root, manifestPath)
}, null, 2))
