'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const IS_WINDOWS = process.platform === 'win32'

const STAGES = [
  {
    name: 'opl-cli-check',
    title: 'Check One Person Lab CLI',
    category: 'opl',
    needs_user_input: false
  },
  {
    name: 'codex-cli-check',
    title: 'Check Codex CLI',
    category: 'opl',
    needs_user_input: false
  },
  {
    name: 'opl-initialize',
    title: 'Read One Person Lab status',
    category: 'opl',
    needs_user_input: false
  },
  {
    name: 'opl-core-setup',
    title: 'Prepare One Person Lab core components',
    category: 'opl',
    needs_user_input: false
  },
  {
    name: 'opl-post-setup-check',
    title: 'Verify One Person Lab setup',
    category: 'opl',
    needs_user_input: false
  },
  {
    name: 'opl-model-access',
    title: 'Check model access',
    category: 'opl',
    needs_user_input: true
  },
  {
    name: 'opl-codex-adapter',
    title: 'Prepare Codex desktop adapter',
    category: 'opl',
    needs_user_input: false
  },
  {
    name: 'opl-maintenance-schedule',
    title: 'Schedule background maintenance',
    category: 'opl',
    needs_user_input: false
  }
]

function hiddenWindowsChildOptions(options = {}) {
  if (!IS_WINDOWS || Object.prototype.hasOwnProperty.call(options, 'windowsHide')) {
    return options
  }
  return { ...options, windowsHide: true }
}

function pathEntries(env) {
  return String(env.PATH || process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
}

function executableNames(command, env) {
  if (!IS_WINDOWS || path.extname(command)) return [command]
  const pathext = String(env.PATHEXT || process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map(ext => ext.trim())
    .filter(Boolean)
  return [command, ...pathext.map(ext => `${command}${ext.toLowerCase()}`), ...pathext.map(ext => `${command}${ext.toUpperCase()}`)]
}

function isExecutableFile(filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    fs.accessSync(filePath, IS_WINDOWS ? fs.constants.F_OK : fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function resolveExecutable(command, env = process.env) {
  if (command.includes('/') || (IS_WINDOWS && command.includes('\\'))) {
    return isExecutableFile(command) ? command : null
  }

  for (const entry of pathEntries(env)) {
    for (const name of executableNames(command, env)) {
      const candidate = path.join(entry, name)
      if (isExecutableFile(candidate)) return candidate
    }
  }

  return null
}

function openRunLog(logRoot) {
  fs.mkdirSync(logRoot, { recursive: true })
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = path.join(logRoot, `opl-bootstrap-${ts}.log`)
  const fd = fs.openSync(logPath, 'a')
  const stream = {
    write(data) {
      fs.writeSync(fd, data)
    },
    end() {
      fs.closeSync(fd)
    }
  }
  return { path: logPath, stream }
}

function emitLine(emit, stage, line, stream = 'stdout') {
  emit({ type: 'log', stage, line, stream })
}

function emitStage(emit, name, state, options = {}) {
  const {
    durationMs = 0,
    error = null,
    reason = null,
    skipped = state === 'skipped'
  } = options
  const json = { ok: state !== 'failed', stage: name }
  if (skipped) json.skipped = true
  if (reason) json.reason = reason
  emit({
    type: 'stage',
    name,
    state,
    durationMs,
    json,
    error
  })
}

async function runExecutableCheckStage({ name, command, label, required, env, emit }) {
  const startedAt = Date.now()
  emit({ type: 'stage', name, state: 'running' })
  const resolved = resolveExecutable(command, env)
  const durationMs = Date.now() - startedAt

  if (resolved) {
    emitStage(emit, name, 'succeeded', { durationMs })
    return { ok: true, path: resolved }
  }

  const error = `${label} was not found on PATH.`
  if (required) {
    emitStage(emit, name, 'failed', { durationMs, error, reason: error })
    emit({ type: 'failed', stage: name, error })
    return { ok: false, failedStage: name, error }
  }

  emitStage(emit, name, 'skipped', { durationMs, reason: error })
  return { ok: true, skipped: true, error }
}

function safeJsonParse(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1))
    }
    throw new Error('Command did not return JSON.')
  }
}

function runCommand(command, args, options = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    input = null,
    abortSignal = null,
    stage = command,
    emit = () => undefined,
    timeoutMs = 120_000,
    maxBufferBytes = 64 * 1024 * 1024,
    emitOutput = true,
    captureOutput = true
  } = options

  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const child = spawn(
      command,
      args,
      hiddenWindowsChildOptions({
        cwd,
        env,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    )

    const finish = result => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      abortSignal?.removeEventListener?.('abort', onAbort)
      resolve(result)
    }

    const fail = error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      abortSignal?.removeEventListener?.('abort', onAbort)
      reject(error)
    }

    const onAbort = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
      finish({ code: null, signal: 'SIGTERM', stdout, stderr, cancelled: true })
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {
        void 0
      }
      fail(new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    if (abortSignal?.aborted) {
      onAbort()
      return
    }
    abortSignal?.addEventListener?.('abort', onAbort, { once: true })

    child.stdout.on('data', chunk => {
      const text = chunk.toString('utf8')
      if (captureOutput) {
        stdout += text
        if (stdout.length > maxBufferBytes) {
          fail(new Error(`${command} stdout exceeded ${maxBufferBytes} bytes`))
          try {
            child.kill('SIGTERM')
          } catch {
            void 0
          }
          return
        }
      }
      if (emitOutput) {
        for (const line of text.split(/\r?\n/).filter(Boolean).slice(-40)) {
          emitLine(emit, stage, line)
        }
      }
    })

    child.stderr.on('data', chunk => {
      const text = chunk.toString('utf8')
      stderr += text
      if (emitOutput) {
        for (const line of text.split(/\r?\n/).filter(Boolean).slice(-40)) {
          emitLine(emit, stage, line, 'stderr')
        }
      }
    })

    child.once('error', fail)
    child.once('exit', (code, signal) => finish({ code, signal, stdout, stderr, cancelled: false }))

    if (input !== null && input !== undefined) {
      child.stdin.end(String(input))
    } else {
      child.stdin.end()
    }
  })
}

function getSystemInitialize(payload) {
  return payload?.system_initialize || payload?.initialize || payload || {}
}

function getSetupFlow(initializePayload) {
  return getSystemInitialize(initializePayload).setup_flow || {}
}

function getChecklist(initializePayload) {
  const checklist = getSystemInitialize(initializePayload).checklist
  return Array.isArray(checklist) ? checklist : []
}

function codexConfigItem(initializePayload) {
  return getChecklist(initializePayload).find(item => item?.item_id === 'codex_config') || null
}

function apiKeyPresent(initializePayload) {
  const system = getSystemInitialize(initializePayload)
  const coreValue = system?.core_engines?.codex?.api_key_present
  if (typeof coreValue === 'boolean') return coreValue
  const checklistValue = codexConfigItem(initializePayload)?.last_attempt?.api_key_present
  return typeof checklistValue === 'boolean' ? checklistValue : false
}

function readyToLaunch(initializePayload) {
  return Boolean(getSetupFlow(initializePayload).ready_to_launch)
}

function blockingItems(initializePayload) {
  const items = getSetupFlow(initializePayload).blocking_items
  return Array.isArray(items) ? items.map(String) : []
}

function hasOnlyApiKeyBlocker(initializePayload) {
  const blockers = blockingItems(initializePayload)
  if (blockers.length === 0) return false
  return blockers.every(item => item === 'codex_config' || /api|key|codex_config/i.test(item))
}

async function runJsonStage({ name, command, args, cwd, env, abortSignal, emit, timeoutMs }) {
  const startedAt = Date.now()
  emit({ type: 'stage', name, state: 'running' })
  const result = await runCommand(command, args, { cwd, env, abortSignal, stage: name, emit, timeoutMs })
  const durationMs = Date.now() - startedAt
  if (result.cancelled) {
    emit({ type: 'failed', stage: name, error: 'bootstrap cancelled by user' })
    return { ok: false, cancelled: true }
  }
  if (result.code !== 0) {
    const error = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
    emit({
      type: 'stage',
      name,
      state: 'failed',
      durationMs,
      json: { ok: false, stage: name, reason: error },
      error
    })
    emit({ type: 'failed', stage: name, error })
    return { ok: false, error, failedStage: name }
  }

  const json = safeJsonParse(result.stdout)
  emit({
    type: 'stage',
    name,
    state: 'succeeded',
    durationMs,
    json: { ok: true, stage: name }
  })
  return { ok: true, json, stdout: result.stdout }
}

async function runBestEffortJsonStage({
  name,
  command,
  args,
  cwd,
  env,
  abortSignal,
  emit,
  timeoutMs,
  emitOutput = true,
  captureOutput = true,
  parseJson = true
}) {
  const startedAt = Date.now()
  emit({ type: 'stage', name, state: 'running' })
  try {
    const result = await runCommand(command, args, {
      cwd,
      env,
      abortSignal,
      stage: name,
      emit,
      timeoutMs,
      emitOutput,
      captureOutput
    })
    const durationMs = Date.now() - startedAt
    if (result.cancelled) {
      emit({ type: 'failed', stage: name, error: 'bootstrap cancelled by user' })
      return { ok: false, cancelled: true }
    }
    if (result.code !== 0) {
      const error = result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
      emit({
        type: 'stage',
        name,
        state: 'skipped',
        durationMs,
        json: { ok: true, skipped: true, stage: name, reason: error }
      })
      return { ok: true, skipped: true, error }
    }
    const json = parseJson ? safeJsonParse(result.stdout) : null
    emit({
      type: 'stage',
      name,
      state: 'succeeded',
      durationMs,
      json: { ok: true, stage: name }
    })
    return { ok: true, json, stdout: result.stdout }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    const message = error instanceof Error ? error.message : String(error)
    emit({
      type: 'stage',
      name,
      state: 'skipped',
      durationMs,
      json: { ok: true, skipped: true, stage: name, reason: message }
    })
    return { ok: true, skipped: true, error: message }
  }
}

async function runOplMaintenanceStages({ cwd, env, abortSignal, emit, emitOutput = false }) {
  const startup = await runBestEffortJsonStage({
    name: 'opl-startup-maintenance',
    command: 'opl',
    args: ['system', 'startup-maintenance', '--json'],
    cwd,
    env,
    abortSignal,
    emit,
    timeoutMs: 600_000,
    emitOutput,
    captureOutput: false,
    parseJson: false
  })
  if (!startup.ok) return startup

  const reconcile = await runBestEffortJsonStage({
    name: 'opl-reconcile-modules',
    command: 'opl',
    args: ['system', 'reconcile-modules', '--json'],
    cwd,
    env,
    abortSignal,
    emit,
    timeoutMs: 600_000,
    emitOutput,
    captureOutput: false,
    parseJson: false
  })
  if (!reconcile.ok) return reconcile

  return { ok: true, startup, reconcile }
}

async function runOplBootstrap(opts = {}) {
  const {
    cwd = process.env.HOME || process.cwd(),
    env = process.env,
    logRoot = path.join(process.env.HOME || process.cwd(), 'Library', 'Logs', 'One Person Lab'),
    onEvent,
    abortSignal
  } = opts

  if (abortSignal?.aborted) {
    onEvent?.({ type: 'failed', error: 'bootstrap cancelled by user' })
    return { ok: false, cancelled: true }
  }

  const runLog = openRunLog(logRoot)
  const emit = ev => {
    try {
      runLog.stream.write(JSON.stringify(ev) + '\n')
    } catch {
      void 0
    }
    try {
      onEvent?.(ev)
    } catch {
      void 0
    }
  }

  emit({
    type: 'manifest',
    stages: STAGES,
    protocolVersion: 1
  })
  emit({ type: 'log', line: `[opl-bootstrap] starting at ${new Date().toISOString()}; runLog=${runLog.path}` })

  let initial = null
  try {
    const oplCli = await runExecutableCheckStage({
      name: 'opl-cli-check',
      command: 'opl',
      label: 'One Person Lab CLI',
      required: true,
      env,
      emit
    })
    if (!oplCli.ok) return oplCli

    const codexCli = await runExecutableCheckStage({
      name: 'codex-cli-check',
      command: 'codex',
      label: 'Codex CLI',
      required: true,
      env,
      emit
    })
    if (!codexCli.ok) return codexCli

    const first = await runJsonStage({
      name: 'opl-initialize',
      command: 'opl',
      args: ['system', 'initialize', '--json'],
      cwd,
      env,
      abortSignal,
      emit,
      timeoutMs: 180_000
    })
    if (!first.ok) return first
    initial = first.json

    const needsCoreSetup = !readyToLaunch(initial) && !hasOnlyApiKeyBlocker(initial)
    if (needsCoreSetup) {
      const core = await runJsonStage({
        name: 'opl-core-setup',
        command: 'opl',
        args: ['install', '--skip-gui-open', '--skip-modules', '--skip-native-helper-repair', '--json'],
        cwd,
        env,
        abortSignal,
        emit,
        timeoutMs: 600_000
      })
      if (!core.ok) return core

      const second = await runJsonStage({
        name: 'opl-post-setup-check',
        command: 'opl',
        args: ['system', 'initialize', '--json'],
        cwd,
        env,
        abortSignal,
        emit,
        timeoutMs: 180_000
      })
      if (!second.ok) return second
      initial = second.json
    } else {
      emitStage(emit, 'opl-core-setup', 'skipped', {
        reason: 'One Person Lab core components are already available.'
      })
      emitStage(emit, 'opl-post-setup-check', 'skipped', {
        reason: 'No core setup changes required.'
      })
    }

    if (apiKeyPresent(initial)) {
      emitStage(emit, 'opl-model-access', 'succeeded')
    } else {
      emitStage(emit, 'opl-model-access', 'skipped', {
        reason: 'API key entry continues in the model access screen.'
      })
    }

    if (!readyToLaunch(initial) && !hasOnlyApiKeyBlocker(initial)) {
      const blockers = blockingItems(initial)
      const error = blockers.length
        ? `OPL initialization still has blocking items: ${blockers.join(', ')}`
        : 'OPL initialization did not reach ready_to_launch.'
      emit({ type: 'failed', stage: 'opl-initialize', error })
      return { ok: false, failedStage: 'opl-initialize', error, initialize: initial }
    }

    emitStage(emit, 'opl-codex-adapter', 'succeeded')
    if (apiKeyPresent(initial)) {
      emitStage(emit, 'opl-maintenance-schedule', 'succeeded')
    } else {
      emitStage(emit, 'opl-maintenance-schedule', 'skipped', {
        reason: 'Background maintenance will run after model access is configured.'
      })
    }

    const marker = {
      kind: 'opl-app-initialize',
      ready_to_launch: readyToLaunch(initial),
      api_key_present: apiKeyPresent(initial),
      maintenance_deferred: apiKeyPresent(initial),
      completed_at: new Date().toISOString()
    }
    emit({ type: 'complete', marker })
    return {
      ok: true,
      initialize: initial,
      marker,
      needsApiKey: !apiKeyPresent(initial),
      maintenanceDeferred: apiKeyPresent(initial)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emit({ type: 'failed', stage: 'opl-initialize', error: message })
    return { ok: false, failedStage: 'opl-initialize', error: message, initialize: initial }
  } finally {
    try {
      runLog.stream.end()
    } catch {
      void 0
    }
  }
}

module.exports = {
  apiKeyPresent,
  blockingItems,
  codexConfigItem,
  getSystemInitialize,
  getSetupFlow,
  hasOnlyApiKeyBlocker,
  readyToLaunch,
  runCommand,
  runOplMaintenanceStages,
  runOplBootstrap
}
