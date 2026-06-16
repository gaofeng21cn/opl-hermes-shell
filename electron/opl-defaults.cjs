const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const DEFAULT_OPL_SKILL_DIRS = [
  '/Users/gaofeng/.codex/plugins/cache/mas-local/mas/0.1.0a4/skills',
  '/Users/gaofeng/.codex/plugins/cache/mag-local/mag/0.1.0/skills',
  '/Users/gaofeng/.codex/plugins/cache/rca-local/rca/0.1.0/plugins/rca/skills'
]

function existingDirectories(paths) {
  return paths.filter(candidate => {
    try {
      return fs.statSync(candidate).isDirectory()
    } catch {
      return false
    }
  })
}

function seedScript() {
  return String.raw`
import json
import os
import sys

from hermes_cli.config import load_config, save_config

skill_dirs = json.loads(os.environ.get("OPL_HERMES_SKILL_DIRS_JSON", "[]"))
language = os.environ.get("OPL_HERMES_DEFAULT_LANGUAGE", "zh").strip() or "zh"

config = load_config()
changed = False

model = config.get("model")
if not isinstance(model, dict):
    model = {}
    config["model"] = model

if not str(model.get("openai_runtime") or "").strip():
    model["openai_runtime"] = "codex_app_server"
    changed = True

display = config.get("display")
if not isinstance(display, dict):
    display = {}
    config["display"] = display

if not str(display.get("language") or "").strip():
    display["language"] = language
    changed = True

skills = config.get("skills")
if not isinstance(skills, dict):
    skills = {}
    config["skills"] = skills

raw_dirs = skills.get("external_dirs")
if isinstance(raw_dirs, str):
    external_dirs = [raw_dirs]
elif isinstance(raw_dirs, list):
    external_dirs = list(raw_dirs)
else:
    external_dirs = []

seen = {str(item) for item in external_dirs}
for item in skill_dirs:
    if item not in seen:
        external_dirs.append(item)
        seen.add(item)
        changed = True

if external_dirs != raw_dirs:
    skills["external_dirs"] = external_dirs
    changed = True

if changed:
    save_config(config)

print(json.dumps({
    "changed": changed,
    "openai_runtime": model.get("openai_runtime"),
    "language": display.get("language"),
    "external_dirs_added": [item for item in skill_dirs if item in external_dirs],
}, ensure_ascii=True))
`
}

function seedOplHermesDefaults({ backend, hermesHome, rememberLog = () => undefined, skillDirs = DEFAULT_OPL_SKILL_DIRS } = {}) {
  if (!backend?.command) {
    return { skipped: true, reason: 'missing_backend_command' }
  }
  const existingSkillDirs = existingDirectories(skillDirs)
  const result = spawnSync(backend.command, ['-c', seedScript()], {
    cwd: backend.root || process.cwd(),
    env: {
      ...process.env,
      HERMES_HOME: hermesHome,
      ...backend.env,
      OPL_HERMES_SKILL_DIRS_JSON: JSON.stringify(existingSkillDirs),
      OPL_HERMES_DEFAULT_LANGUAGE: process.env.OPL_HERMES_DEFAULT_LANGUAGE || 'zh'
    },
    encoding: 'utf8',
    shell: false
  })

  const stdout = (result.stdout || '').trim()
  const stderr = (result.stderr || '').trim()
  if (stdout) rememberLog(`[opl-defaults] ${stdout}`)
  if (stderr) rememberLog(`[opl-defaults] stderr: ${stderr}`)

  if (result.status !== 0) {
    const message = `OPL Hermes default seeding failed with ${result.status}: ${stderr || stdout || 'no output'}`
    rememberLog(`[opl-defaults] ${message}`)
    return { skipped: true, reason: 'seed_failed', error: message }
  }

  try {
    return JSON.parse(stdout)
  } catch {
    return { changed: false, raw: stdout }
  }
}

module.exports = {
  DEFAULT_OPL_SKILL_DIRS,
  existingDirectories,
  seedOplHermesDefaults,
  seedScript
}
