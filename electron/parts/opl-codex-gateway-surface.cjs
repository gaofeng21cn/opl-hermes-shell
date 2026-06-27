const fs = require('node:fs')
const path = require('node:path')

const OPL_CODEX_SKILLS = Object.freeze({
  mas: {
    skill_id: 'mas',
    invocation: '$mas',
    agent_id: 'mas',
    project_id: 'medautoscience',
    target_domain_id: 'med-autoscience',
    label: 'Med Auto Science',
    ordinary_golden_path:
      'study -> stage -> domain owner receipt or typed blocker -> research artifact handoff',
    prompt_contract:
      'Codex chooses and operates the MAS skill/plugin. The Hermes adapter does not preflight, route, or execute MAS commands.'
  },
  mag: {
    skill_id: 'mag',
    invocation: '$mag',
    agent_id: 'mag',
    project_id: 'medautogrant',
    target_domain_id: 'med-autogrant',
    label: 'Med Auto Grant',
    ordinary_golden_path:
      'grant -> stage -> domain owner receipt or typed blocker -> grant deliverable handoff',
    prompt_contract:
      'Codex chooses and operates the MAG skill/plugin. The Hermes adapter does not preflight, route, or execute MAG commands.'
  },
  rca: {
    skill_id: 'rca',
    invocation: '$rca',
    agent_id: 'rca',
    project_id: 'redcube',
    target_domain_id: 'redcube',
    label: 'RedCube AI',
    ordinary_golden_path:
      'deck -> stage -> domain owner receipt or typed blocker -> visual deliverable handoff',
    prompt_contract:
      'Codex chooses and operates the RCA skill/plugin. The Hermes adapter does not preflight, route, or execute RCA commands.'
  },
  opl: {
    skill_id: 'opl',
    invocation: 'natural language',
    agent_id: 'opl',
    project_id: 'one-person-lab',
    target_domain_id: 'one-person-lab',
    label: 'One Person Lab',
    ordinary_golden_path:
      'purpose -> Codex executor with installed OPL skills/plugins -> refs-only receipt or next action',
    prompt_contract:
      'Codex owns OPL skill/plugin/tool selection. The Hermes adapter stays a thin app-server client.'
  }
})

const BRIDGE_REST_ROUTES = [
  { method: 'GET', path: '/api/status' },
  { method: 'GET', path: '/api/logs' },
  { method: 'GET', path: '/api/profiles/active' },
  { method: 'GET', path: '/api/profiles/sessions' },
  { method: 'GET', path: '/api/profiles' },
  { method: 'POST', path: '/api/profiles' },
  { method: 'GET', path: '/api/config' },
  { method: 'PUT', path: '/api/config' },
  { method: 'GET', path: '/api/config/defaults' },
  { method: 'GET', path: '/api/config/schema' },
  { method: 'GET', path: '/api/cron/jobs' },
  { method: 'GET', path: '/api/env' },
  { method: 'PUT', path: '/api/env' },
  { method: 'DELETE', path: '/api/env' },
  { method: 'GET', path: '/api/providers/oauth' },
  { method: 'POST', path: '/api/providers/validate' },
  { method: 'GET', path: '/api/model/options' },
  { method: 'GET', path: '/api/model/info' },
  { method: 'POST', path: '/api/model/set' },
  { method: 'GET', path: '/api/model/auxiliary' },
  { method: 'GET', path: '/api/model/recommended-default' },
  { method: 'GET', path: '/api/opl/codex-skills' },
  { method: 'GET', path: '/api/smoke/connection' }
]

const BRIDGE_RPC_METHODS = [
  'session.create',
  'session.resume',
  'prompt.submit',
  'session.interrupt',
  'session.usage',
  'session.title',
  'session.cwd.set',
  'session.close',
  'config.get',
  'config.set',
  'reload.mcp',
  'setup.status',
  'setup.runtime_check',
  'codex.skills',
  'model.options',
  'commands.catalog',
  'complete.slash',
  'complete.path',
  'file.attach',
  'image.attach',
  'image.attach_bytes'
]

const BRIDGE_REST_ROUTE_KEYS = new Set(BRIDGE_REST_ROUTES.map(route => routeKey(route.method, route.path)))
const BRIDGE_RPC_METHOD_SET = new Set(BRIDGE_RPC_METHODS)

function normalizeMethod(method) {
  return String(method || 'GET').toUpperCase()
}

function routeKey(method, pathname) {
  return `${normalizeMethod(method)} ${pathname}`
}

function isOplCodexBridgeRestRoute(method, pathname) {
  if (/^\/api\/cron\/jobs\/[^/]+(?:\/runs)?$/.test(String(pathname || ''))) {
    return normalizeMethod(method) === 'GET'
  }
  return BRIDGE_REST_ROUTE_KEYS.has(routeKey(method, pathname))
}

function isOplCodexBridgeRpcMethod(method) {
  return BRIDGE_RPC_METHOD_SET.has(String(method || ''))
}

function canonicalSkillName(value) {
  return String(value || '').trim().replace(/^\$/, '').toLowerCase()
}

function requestedCodexSkillIds(text) {
  const matches = String(text || '').matchAll(/(?:^|\s)\$([a-z][a-z0-9_-]*)\b/gi)
  const requested = []
  const seen = new Set()
  for (const match of matches) {
    const skillId = canonicalSkillName(match[1])
    if (!OPL_CODEX_SKILLS[skillId] || seen.has(skillId)) continue
    requested.push(skillId)
    seen.add(skillId)
  }
  return requested
}

function stripLegacyPurposeRouteReceipt(text) {
  const stripped = String(text || '')
    .replace(/OPL purpose route receipt:\s*\{[\s\S]*?(?=\n\n用户输入：|\n\nsession:|\n用户输入：|$)/g, '')
    .replace(/^\s*Opl route\s*$/gim, '')
    .trim()

  const legacyWrapped = stripped.match(/用户输入：\s*([\s\S]*?)(?:\n\nsession:\s*\S+\s*\ncwd:\s*.*)?$/)
  const userText = legacyWrapped?.[1]?.trim()

  return userText || stripped
}

function codexSkillSlashCommand(skill) {
  return `/${skill.skill_id}`
}

function codexSkillSlashDescription(skill) {
  return `通过 Codex Skill 调用 ${skill.label}（${skill.invocation}）`
}

function codexSkillSlashCatalog() {
  const pairs = Object.values(OPL_CODEX_SKILLS)
    .filter(skill => skill.skill_id !== 'opl')
    .map(skill => [codexSkillSlashCommand(skill), codexSkillSlashDescription(skill)])

  return {
    categories: [
      {
        name: 'Skills',
        pairs
      }
    ],
    pairs,
    skill_count: pairs.length
  }
}

function codexSkillSlashCompletions(text) {
  const query = String(text || '').replace(/^\/+/, '').trim().toLowerCase()
  const items = Object.values(OPL_CODEX_SKILLS)
    .filter(skill => skill.skill_id !== 'opl')
    .map(skill => ({
      text: codexSkillSlashCommand(skill),
      display: `${codexSkillSlashCommand(skill)} · ${skill.label}`,
      meta: codexSkillSlashDescription(skill),
      group: 'Skills'
    }))

  return {
    items: query ? items.filter(item => item.text.slice(1).startsWith(query)) : items,
    replace_from: 1
  }
}

function pathCompletionBase(prefix, cwd) {
  const rawPrefix = String(prefix || '')
  const baseCwd = cwd || process.env.OPL_HERMES_DEFAULT_CWD || process.env.PWD || process.env.HOME || process.cwd()
  const expanded =
    rawPrefix === '~' || rawPrefix.startsWith('~/')
      ? path.join(process.env.HOME || baseCwd, rawPrefix.slice(2))
      : rawPrefix
  const absolute = path.isAbsolute(expanded) ? expanded : path.resolve(baseCwd, expanded || '.')
  const endsWithSeparator = /[\\/]$/.test(expanded)
  const directory = endsWithSeparator ? absolute : path.dirname(absolute)
  const basename = endsWithSeparator ? '' : path.basename(absolute)

  return { absolute, basename, baseCwd, directory }
}

function codexPathCompletions({ prefix = '', cwd = process.env.OPL_HERMES_DEFAULT_CWD || process.env.PWD || process.cwd() } = {}) {
  const { basename, directory } = pathCompletionBase(prefix, cwd)
  let entries = []
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return { items: [], prefix, cwd, bridge_mode: 'codex_app_server_skill_first_adapter' }
  }

  const needle = basename.toLowerCase()
  const items = entries
    .filter(entry => !needle || entry.name.toLowerCase().startsWith(needle))
    .slice(0, 50)
    .map(entry => {
      const fullPath = path.join(directory, entry.name)
      const isDirectory = entry.isDirectory()
      return {
        text: isDirectory ? `${fullPath}${path.sep}` : fullPath,
        display: isDirectory ? `${entry.name}/` : entry.name,
        label: isDirectory ? `${entry.name}/` : entry.name,
        path: fullPath,
        type: isDirectory ? 'directory' : 'file',
        kind: isDirectory ? 'directory' : 'file',
        meta: isDirectory ? 'directory' : 'file'
      }
    })

  return { items, prefix, cwd, bridge_mode: 'codex_app_server_skill_first_adapter' }
}

function describeOplCodexGatewayScope() {
  return {
    mode: 'codex_app_server_skill_first_adapter',
    replacesHermesBackend: false,
    executor: 'codex_app_server',
    restRoutes: BRIDGE_REST_ROUTES.map(route => ({ ...route })),
    rpcMethods: [...BRIDGE_RPC_METHODS],
    codexSkills: Object.values(OPL_CODEX_SKILLS).map(skill => ({
      skill_id: skill.skill_id,
      invocation: skill.invocation,
      agent_id: skill.agent_id,
      project_id: skill.project_id,
      target_domain_id: skill.target_domain_id,
      label: skill.label,
      ordinary_golden_path: skill.ordinary_golden_path
    })),
    upstreamHermesBackendOwns: [
      'config',
      'env',
      'oauth',
      'profiles',
      'persisted sessions',
      'session search',
      'cron',
      'Hermes skills UI',
      'toolsets',
      'messaging',
      'analytics',
      'Hermes update',
      'audio',
      'process catalog',
      'command catalog',
      'path completion'
    ]
  }
}

module.exports = {
  OPL_CODEX_SKILLS,
  canonicalSkillName,
  codexPathCompletions,
  codexSkillSlashCatalog,
  codexSkillSlashCompletions,
  describeOplCodexGatewayScope,
  isOplCodexBridgeRestRoute,
  isOplCodexBridgeRpcMethod,
  normalizeMethod,
  requestedCodexSkillIds,
  stripLegacyPurposeRouteReceipt
}
