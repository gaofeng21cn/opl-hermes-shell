#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const profile = readJson('contracts/opl-hermes-candidate-profile.json')
const pkg = readJson('package.json')

assert(profile.surface_kind === 'opl_hermes_archive_profile', 'archive profile surface kind must be current')
assert(profile.schema_version === 'opl-hermes-archive-profile.v1', 'archive profile schema must be current')
assert(profile.owner === 'opl-hermes-shell', 'archive profile owner must remain opl-hermes-shell')
assert(profile.state === 'archived_provenance', 'Hermes product role must remain archived provenance')

const repository = profile.repository || {}
assert(repository.name_with_owner === 'gaofeng21cn/opl-hermes-shell', 'archive repository identity must be exact')
assert(repository.default_branch === 'main', 'archive must retain main as its default branch')
assert(repository.archive_policy === 'github_read_only_archive', 'archive policy must be read-only GitHub archive')
assert(repository.source_history_retained === true, 'archive must retain source history')
assert(repository.delete_repository === false, 'archive must not authorize repository deletion')

const product = profile.product_policy || {}
assert(product.product_role === 'retired', 'Hermes product role must be retired')
assert(product.repository_role === 'read_only_historical_provenance', 'repository role must be read-only provenance')
for (const field of [
  'active_candidate',
  'replay_route',
  'default_validation_target',
  'development_lane',
  'release_route',
  'maintained_reference',
]) {
  assert(product[field] === false, `product_policy.${field} must be false`)
}
assert(
  product.reopen_requires === 'new_explicit_one-person-lab-app_product_decision',
  'reopening Hermes must require a new explicit App product decision',
)

const execution = profile.build_execution_policy || {}
assert(execution.scope === 'archived_no_execution', 'archive must have no execution scope')
assert(execution.trigger === 'none', 'archive must have no automatic or manual execution trigger')
for (const field of [
  'build_allowed',
  'package_allowed',
  'smoke_allowed',
  'install_allowed',
  'upstream_intake_allowed',
]) {
  assert(execution[field] === false, `build_execution_policy.${field} must be false`)
}
assert(Array.isArray(execution.release_channel_participation), 'release participation must be an array')
assert(execution.release_channel_participation.length === 0, 'archive must not participate in a release channel')

for (const [field, value] of Object.entries(profile.authority_boundary || {})) {
  assert(value === false, `authority_boundary.${field} must be false`)
}

assert(pkg.private === true, 'archived package must remain private')
assert(pkg.scripts?.['validate:archive'] === 'node scripts/validate-hermes-codex-candidate.cjs', 'archive validator command must remain available')
assert(pkg.scripts?.['validate:candidate'] === 'npm run validate:archive', 'historical candidate command must resolve to archive validation')

console.log(JSON.stringify({
  status: 'opl_hermes_archive_profile_valid',
  repository: repository.name_with_owner,
  product_role: product.product_role,
  repository_role: product.repository_role,
  source_history_retained: repository.source_history_retained,
  release_route: product.release_route,
}, null, 2))

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'))
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
