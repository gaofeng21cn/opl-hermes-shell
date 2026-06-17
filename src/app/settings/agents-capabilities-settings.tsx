import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { getOplPurposeRoutes } from '@/hermes'
import { useI18n } from '@/i18n'
import { Brain, CheckCircle2 } from '@/lib/icons'
import { notifyError } from '@/store/notifications'
import type { OplPurposeRouteCatalog } from '@/types/hermes'

import { EmptyState, ListRow, LoadingState, SectionHeading, SettingsContent } from './primitives'

export function AgentsCapabilitiesSettings() {
  const { t } = useI18n()
  const copy = t.settings.agentsCapabilities
  const [catalog, setCatalog] = useState<OplPurposeRouteCatalog | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    getOplPurposeRoutes()
      .then(nextCatalog => {
        if (!cancelled) {
          setCatalog(nextCatalog)
        }
      })
      .catch(err => {
        if (!cancelled) {
          notifyError(err, copy.failedLoad)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => void (cancelled = true)
  }, [copy.failedLoad])

  if (loading) {
    return <LoadingState label={copy.loading} />
  }

  const routes = catalog?.routes ?? []

  return (
    <SettingsContent>
      <SectionHeading icon={Brain} meta={catalog?.bridge_mode} title={copy.title} />
      <p className="mb-5 max-w-3xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {copy.intro}
      </p>

      {routes.length === 0 ? (
        <EmptyState description={copy.emptyDesc} title={copy.emptyTitle} />
      ) : (
        <div className="divide-y divide-border/45">
          {routes.map(route => (
            <ListRow
              action={
                <Badge className="gap-1" variant="default">
                  <CheckCircle2 className="size-3" />
                  {copy.routeReady}
                </Badge>
              }
              below={
                <div className="mt-3 grid gap-1.5 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                  <div>
                    <span className="font-medium text-foreground/80">{copy.owner}: </span>
                    <code>{route.owner_surface}</code>
                  </div>
                  <div>
                    <span className="font-medium text-foreground/80">{copy.action}: </span>
                    <code>{route.app_action_id || '-'}</code>
                  </div>
                  <div>
                    <span className="font-medium text-foreground/80">{copy.readback}: </span>
                    <code>{route.start_surface}</code>
                  </div>
                  <div>
                    <span className="font-medium text-foreground/80">{copy.aliases}: </span>
                    {route.aliases.slice(0, 8).join(' / ')}
                  </div>
                  <div>
                    <span className="font-medium text-foreground/80">{copy.authority}: </span>
                    {copy.noDomainTruth}
                  </div>
                </div>
              }
              description={`${copy.project}: ${route.project_id} · ${copy.routeBoundary}`}
              key={route.purpose_id}
              title={route.label}
              wide
            />
          ))}
        </div>
      )}
    </SettingsContent>
  )
}
