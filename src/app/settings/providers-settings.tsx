import { useState } from 'react'

import { useI18n } from '@/i18n'
import type { EnvVarInfo } from '@/types/hermes'

import { isKeyVar, ProviderKeyRows } from './credential-key-ui'
import { useEnvCredentials } from './env-credentials'
import { providerMeta, providerPriority } from './helpers'
import { LoadingState, SettingsContent } from './primitives'

// Group the OPL model-access env catalog. The current candidate deliberately
// exposes only the gflabtoken API key as the ordinary user path.
function buildProviderKeyGroups(vars: Record<string, EnvVarInfo>): ProviderKeyGroup[] {
  const buckets = new Map<string, [string, EnvVarInfo][]>()

  for (const [key, info] of Object.entries(vars)) {
    if (info.category !== 'provider') {
      continue
    }

    if (key !== 'OPENAI_API_KEY') {
      continue
    }

    const name = 'gflabtoken'

    buckets.set(name, [...(buckets.get(name) ?? []), [key, info]])
  }

  const groups: ProviderKeyGroup[] = []

  for (const [name, entries] of buckets) {
    const primary = entries.find(([k, i]) => !i.advanced && isKeyVar(k, i)) ?? entries.find(([k, i]) => isKeyVar(k, i))

    if (!primary) {
      continue
    }

    const meta = providerMeta(name)

    groups.push({
      advanced: [],
      description: meta?.description ?? primary[1].description,
      docsUrl: meta?.docsUrl ?? primary[1].url ?? undefined,
      hasAnySet: entries.some(([, i]) => i.is_set),
      name,
      primary,
      priority: providerPriority(name)
    })
  }

  return groups.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name))
}

function NoProviderKeys() {
  const { t } = useI18n()

  return (
    <div className="grid min-h-32 place-items-center px-4 py-8 text-center text-[length:var(--conversation-caption-font-size)] text-muted-foreground">
      {t.settings.providers.noProviderKeys}
    </div>
  )
}

export function ProvidersSettings() {
  const { t } = useI18n()
  const { rowProps, vars } = useEnvCredentials()
  const [openProvider, setOpenProvider] = useState<null | string>(null)

  if (!vars) {
    return <LoadingState label={t.settings.providers.loading} />
  }

  const keyGroups = buildProviderKeyGroups(vars)

  return (
    <SettingsContent>
      <p className="mb-3 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {t.settings.providers.intro}
      </p>
      {keyGroups.length > 0 ? (
        <div className="grid gap-2">
          {keyGroups.map(group => (
            <ProviderKeyRows
              expanded={openProvider === group.name}
              group={group}
              key={group.name}
              onExpand={() => setOpenProvider(group.name)}
              onToggle={() => setOpenProvider(prev => (prev === group.name ? null : group.name))}
              rowProps={rowProps}
            />
          ))}
        </div>
      ) : (
        <NoProviderKeys />
      )}
    </SettingsContent>
  )
}

interface ProviderKeyGroup {
  advanced: [string, EnvVarInfo][]
  description?: string
  docsUrl?: string
  hasAnySet: boolean
  name: string
  primary: [string, EnvVarInfo]
  priority: number
}
