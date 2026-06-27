const fs = require('node:fs')
const path = require('node:path')

function isExecutableFile(filePath) {
  if (!filePath || !path.isAbsolute(filePath)) {
    return false
  }

  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function posixShellSpec(shellPath) {
  const shellName = path.basename(shellPath)
  const interactiveArgs = shellName.includes('zsh') || shellName.includes('bash') ? ['-il'] : ['-i']

  return { args: interactiveArgs, command: shellPath, name: shellName }
}

function windowsPowerShellPath({ findOnPath }) {
  const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const builtin = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

  return isExecutableFile(builtin) ? builtin : findOnPath('powershell.exe')
}

function shellSpecFor(shellPath) {
  const name = path.basename(shellPath).toLowerCase()

  if (name.startsWith('pwsh') || name.startsWith('powershell')) {
    return { args: ['-NoLogo'], command: shellPath, name }
  }

  if (name.startsWith('cmd')) {
    return { args: [], command: shellPath, name }
  }

  return posixShellSpec(shellPath)
}

function windowsShellSpec({ findOnPath }) {
  const command =
    findOnPath('pwsh.exe') || findOnPath('pwsh') || windowsPowerShellPath({ findOnPath }) || process.env.COMSPEC || 'cmd.exe'

  return shellSpecFor(command)
}

function createTerminalShellController({ app, findOnPath, isWindows, nodePtyDir }) {
  let spawnHelperChecked = false

  function ensureSpawnHelperExecutable() {
    if (spawnHelperChecked || isWindows || !nodePtyDir) {
      return
    }

    spawnHelperChecked = true

    const arch = process.arch
    const candidates = [
      path.join(nodePtyDir, 'build', 'Release', 'spawn-helper'),
      path.join(nodePtyDir, 'prebuilds', `${process.platform}-${arch}`, 'spawn-helper')
    ]

    for (const helper of candidates) {
      try {
        const mode = fs.statSync(helper).mode

        if ((mode & 0o111) !== 0o111) {
          fs.chmodSync(helper, mode | 0o755)
        }
      } catch {
        // Not present in this layout (e.g. compiled build vs prebuild); skip.
      }
    }
  }

  function terminalShellCommand() {
    // HERMES_DESKTOP_SHELL is the cross-platform escape hatch (a path or a bare
    // name on PATH); $SHELL is honored on POSIX, where it's the user's canonical
    // choice, but ignored on Windows, where it is usually a stray MSYS/Git path
    // node-pty can't spawn natively.
    const override = (process.env.HERMES_DESKTOP_SHELL || (isWindows ? '' : process.env.SHELL) || '').trim()

    if (override) {
      const resolved = isExecutableFile(override) ? override : findOnPath(override)

      if (resolved) {
        return shellSpecFor(resolved)
      }
    }

    if (isWindows) {
      return windowsShellSpec({ findOnPath })
    }

    const shellPath = ['/bin/zsh', '/bin/bash', '/bin/sh'].find(candidate => isExecutableFile(candidate))

    return posixShellSpec(shellPath || '/bin/sh')
  }

  function safeTerminalCwd(cwd) {
    const candidate = path.resolve(String(cwd || app.getPath('home')))

    try {
      const stat = fs.statSync(candidate)

      return stat.isDirectory() ? candidate : path.dirname(candidate)
    } catch {
      return app.getPath('home')
    }
  }

  function terminalShellEnv() {
    const env = { ...process.env }

    // Electron is commonly launched through `npm run dev`; do not leak npm's
    // managed prefix into a user's interactive shell (nvm/proto warn loudly).
    for (const key of Object.keys(env)) {
      if (key === 'npm_config_prefix' || key.startsWith('npm_config_') || key.startsWith('npm_package_')) {
        delete env[key]
      }
    }

    // Strip color/theme-detection vars that ride along when Electron is launched
    // from a non-tty agent shell (Cursor's runner sets NO_COLOR/FORCE_COLOR=0
    // /TERM=dumb; some terminals set COLORFGBG which would flip Hermes' TUI into
    // light-mode). Our PTY is a real xterm-compat terminal; force truecolor.
    delete env.NO_COLOR
    delete env.FORCE_COLOR
    delete env.COLORFGBG

    env.COLORTERM = 'truecolor'
    env.LC_CTYPE = env.LC_CTYPE || 'UTF-8'
    env.TERM = 'xterm-256color'
    env.TERM_PROGRAM = 'Hermes'
    env.TERM_PROGRAM_VERSION = app.getVersion()

    // Let a hermes/--tui launched in this pane know it's embedded in the desktop
    // GUI (build_environment_hints surfaces this). Distinct from HERMES_DESKTOP,
    // which marks the agent *backend* and gates cron/gateway behavior.
    env.HERMES_DESKTOP_TERMINAL = '1'

    return env
  }

  return {
    ensureSpawnHelperExecutable,
    safeTerminalCwd,
    terminalShellCommand,
    terminalShellEnv
  }
}

module.exports = {
  createTerminalShellController,
  isExecutableFile,
  posixShellSpec,
  shellSpecFor,
  windowsShellSpec
}
