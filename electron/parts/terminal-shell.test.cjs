const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  createTerminalShellController,
  isExecutableFile,
  posixShellSpec,
  shellSpecFor,
  windowsShellSpec
} = require('./terminal-shell.cjs')

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-terminal-shell-'))
  try {
    return fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

function withEnv(updates, fn) {
  const previous = {}
  for (const [key, value] of Object.entries(updates)) {
    previous[key] = process.env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return fn()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

test('shell specs preserve existing platform command shapes', () => {
  assert.deepEqual(posixShellSpec('/bin/zsh'), { args: ['-il'], command: '/bin/zsh', name: 'zsh' })
  assert.deepEqual(posixShellSpec('/bin/fish'), { args: ['-i'], command: '/bin/fish', name: 'fish' })
  assert.deepEqual(shellSpecFor('/usr/local/bin/pwsh'), {
    args: ['-NoLogo'],
    command: '/usr/local/bin/pwsh',
    name: 'pwsh'
  })
  assert.deepEqual(shellSpecFor('cmd.exe'), {
    args: [],
    command: 'cmd.exe',
    name: 'cmd.exe'
  })
})

test('windowsShellSpec prefers pwsh before Windows PowerShell and cmd', () => {
  const seen = []
  const spec = withEnv({ SystemRoot: '/missing-system-root', COMSPEC: 'cmd.exe' }, () =>
    windowsShellSpec({
      findOnPath: command => {
        seen.push(command)
        return command === 'pwsh' ? '/usr/local/bin/pwsh' : null
      }
    })
  )

  assert.deepEqual(seen, ['pwsh.exe', 'pwsh'])
  assert.deepEqual(spec, { args: ['-NoLogo'], command: '/usr/local/bin/pwsh', name: 'pwsh' })
})

test('terminal shell controller resolves override, cwd, and cleaned env', () =>
  withTempDir(dir => {
    const shellPath = path.join(dir, 'custom-shell')
    const filePath = path.join(dir, 'file.txt')
    fs.writeFileSync(shellPath, '#!/bin/sh\n')
    fs.chmodSync(shellPath, 0o755)
    fs.writeFileSync(filePath, 'x')

    const controller = createTerminalShellController({
      app: {
        getPath: name => {
          assert.equal(name, 'home')
          return dir
        },
        getVersion: () => '1.2.3'
      },
      findOnPath: command => (command === 'custom-shell' ? shellPath : null),
      isWindows: false,
      nodePtyDir: null
    })

    withEnv(
      {
        COLORFGBG: '15;0',
        FORCE_COLOR: '0',
        HERMES_DESKTOP_SHELL: 'custom-shell',
        NO_COLOR: '1',
        npm_config_prefix: '/tmp/npm',
        npm_package_name: 'desktop'
      },
      () => {
        assert.deepEqual(controller.terminalShellCommand(), {
          args: ['-i'],
          command: shellPath,
          name: 'custom-shell'
        })

        assert.equal(controller.safeTerminalCwd(filePath), dir)
        assert.equal(controller.safeTerminalCwd(path.join(dir, 'missing')), dir)

        const env = controller.terminalShellEnv()
        assert.equal(env.NO_COLOR, undefined)
        assert.equal(env.FORCE_COLOR, undefined)
        assert.equal(env.COLORFGBG, undefined)
        assert.equal(env.npm_config_prefix, undefined)
        assert.equal(env.npm_package_name, undefined)
        assert.equal(env.COLORTERM, 'truecolor')
        assert.equal(env.TERM, 'xterm-256color')
        assert.equal(env.TERM_PROGRAM, 'Hermes')
        assert.equal(env.TERM_PROGRAM_VERSION, '1.2.3')
        assert.equal(env.HERMES_DESKTOP_TERMINAL, '1')
      }
    )
  }))

test('isExecutableFile requires an absolute executable file path', () =>
  withTempDir(dir => {
    const executable = path.join(dir, 'run')
    const plain = path.join(dir, 'plain')
    fs.writeFileSync(executable, '')
    fs.writeFileSync(plain, '')
    fs.chmodSync(executable, 0o755)

    assert.equal(isExecutableFile(executable), true)
    assert.equal(isExecutableFile(plain), false)
    assert.equal(isExecutableFile('run'), false)
  }))
