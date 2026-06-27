const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  codexPathCompletions,
  codexSkillSlashCatalog,
  codexSkillSlashCompletions,
  describeOplCodexGatewayScope,
  isOplCodexBridgeRestRoute,
  isOplCodexBridgeRpcMethod,
  requestedCodexSkillIds,
  stripLegacyPurposeRouteReceipt
} = require('./opl-codex-gateway-surface.cjs')

test('gateway surface exposes bridge-owned routes and Codex skill slash commands', () => {
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/model/options'), true)
  assert.equal(isOplCodexBridgeRestRoute('POST', '/api/model/options'), false)
  assert.equal(isOplCodexBridgeRestRoute('GET', '/api/cron/jobs/job-1/runs'), true)
  assert.equal(isOplCodexBridgeRpcMethod('complete.slash'), true)
  assert.equal(isOplCodexBridgeRpcMethod('purpose.route.resolve'), false)

  const scope = describeOplCodexGatewayScope()
  assert.deepEqual(scope.codexSkills.map(skill => skill.skill_id), ['mas', 'mag', 'rca', 'opl'])

  const catalog = codexSkillSlashCatalog()
  assert.deepEqual(catalog.pairs.map(pair => pair[0]), ['/mas', '/mag', '/rca'])
  assert.deepEqual(codexSkillSlashCompletions('/m').items.map(item => item.text), ['/mas', '/mag'])
})

test('gateway surface normalizes explicit skill requests and legacy prompt wrappers', () => {
  assert.deepEqual(requestedCodexSkillIds('$mas and $MAG and $unknown and $mas'), ['mas', 'mag'])
  assert.equal(
    stripLegacyPurposeRouteReceipt('OPL purpose route receipt: {"route":"old"}\n\n用户输入：\n$rca 做图\n\nsession: s\ncwd: /tmp'),
    '$rca 做图'
  )
})

test('gateway surface completes local paths without throwing on missing directories', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opl-gateway-surface-'))
  try {
    fs.writeFileSync(path.join(tempDir, 'alpha.txt'), 'alpha')
    fs.mkdirSync(path.join(tempDir, 'assets'))

    const result = codexPathCompletions({ prefix: path.join(tempDir, 'a'), cwd: tempDir })
    assert.deepEqual(result.items.map(item => item.display).sort(), ['alpha.txt', 'assets/'])
    assert.equal(result.bridge_mode, 'codex_app_server_skill_first_adapter')

    const missing = codexPathCompletions({ prefix: path.join(tempDir, 'missing', 'x'), cwd: tempDir })
    assert.deepEqual(missing.items, [])
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})
