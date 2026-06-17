const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { defaultLanguageFromLocale, existingDirectories, seedOplHermesDefaults } = require('./opl-defaults.cjs')

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opl-hermes-defaults-'))
}

function writePythonConfigHarness(root) {
  const packageDir = path.join(root, 'hermes_cli')
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(path.join(packageDir, '__init__.py'), '')
  fs.writeFileSync(
    path.join(packageDir, 'config.py'),
    `
import json
import os
from pathlib import Path

def _path():
    home = Path(os.environ["HERMES_HOME"])
    home.mkdir(parents=True, exist_ok=True)
    return home / "config.json"

def load_config():
    p = _path()
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))

def save_config(config):
    _path().write_text(json.dumps(config, sort_keys=True), encoding="utf-8")
`
  )
}

function readConfig(home) {
  const file = path.join(home, 'config.json')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

test('existingDirectories filters absent OPL skill directories', () => {
  const root = tmpDir()
  try {
    const present = path.join(root, 'skills')
    fs.mkdirSync(present)
    assert.deepEqual(existingDirectories([present, path.join(root, 'missing')]), [present])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('defaultLanguageFromLocale maps supported system locales', () => {
  assert.equal(defaultLanguageFromLocale('zh-CN'), 'zh')
  assert.equal(defaultLanguageFromLocale('zh_Hans_CN.UTF-8'), 'zh')
  assert.equal(defaultLanguageFromLocale('zh-TW'), 'zh')
  assert.equal(defaultLanguageFromLocale('ja-JP'), 'en')
  assert.equal(defaultLanguageFromLocale('en-US'), 'en')
  assert.equal(defaultLanguageFromLocale('de-DE'), 'en')
})

test('seedOplHermesDefaults adds OPL runtime, language, and skill dirs without Hermes backend replacement', () => {
  const root = tmpDir()
  const home = path.join(root, 'home')
  const skillDir = path.join(root, 'mas-skills')
  fs.mkdirSync(skillDir, { recursive: true })
  writePythonConfigHarness(root)

  try {
    const logs = []
    const result = seedOplHermesDefaults({
      backend: {
        command: 'python3',
        env: { PYTHONPATH: root },
        root
      },
      hermesHome: home,
      rememberLog: line => logs.push(String(line)),
      skillDirs: [skillDir, path.join(root, 'missing-skills')],
      defaultLanguage: 'zh'
    })

    assert.equal(result.changed, true)
    assert.equal(result.openai_runtime, 'codex_app_server')
    assert.equal(result.language, 'zh')
    assert.deepEqual(readConfig(home), {
      display: { language: 'zh' },
      model: { openai_runtime: 'codex_app_server' },
      skills: { external_dirs: [skillDir] }
    })
    assert.ok(logs.some(line => line.includes('[opl-defaults]')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('seedOplHermesDefaults preserves user runtime, language, and external skill dirs', () => {
  const root = tmpDir()
  const home = path.join(root, 'home')
  const existingSkillDir = path.join(root, 'existing-skills')
  const oplSkillDir = path.join(root, 'opl-skills')
  fs.mkdirSync(existingSkillDir, { recursive: true })
  fs.mkdirSync(oplSkillDir, { recursive: true })
  writePythonConfigHarness(root)
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(
    path.join(home, 'config.json'),
    JSON.stringify({
      display: { language: 'en' },
      model: { openai_runtime: 'auto' },
      skills: { external_dirs: [existingSkillDir] }
    })
  )

  try {
    const result = seedOplHermesDefaults({
      backend: {
        command: 'python3',
        env: { PYTHONPATH: root },
        root
      },
      hermesHome: home,
      skillDirs: [oplSkillDir]
    })

    assert.equal(result.changed, true)
    assert.deepEqual(readConfig(home), {
      display: { language: 'en' },
      model: { openai_runtime: 'auto' },
      skills: { external_dirs: [existingSkillDir, oplSkillDir] }
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
