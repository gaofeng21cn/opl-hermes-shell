import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { getOplCodexSkills } from '@/hermes'
import { useI18n } from '@/i18n'
import { Brain, CheckCircle2, Sparkles } from '@/lib/icons'
import { notifyError } from '@/store/notifications'
import type { OplCodexSkillCatalog } from '@/types/hermes'

import { EmptyState, ListRow, LoadingState, SectionHeading, SettingsContent } from './primitives'

export function AgentsCapabilitiesSettings() {
  const { t } = useI18n()
  const copy = t.settings.agentsCapabilities
  const [catalog, setCatalog] = useState<OplCodexSkillCatalog | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    getOplCodexSkills()
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

  const skills = catalog?.skills ?? []

  return (
    <SettingsContent>
      <SectionHeading icon={Brain} title={copy.title} />
      <p className="mb-5 max-w-3xl text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
        {copy.intro}
      </p>
      <p className="mb-5 max-w-3xl rounded-lg border border-border/45 bg-(--ui-bg-secondary) px-3 py-2 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-foreground/78">
        {copy.invocationFlow}
      </p>

      {skills.length === 0 ? (
        <EmptyState description={copy.emptyDesc} title={copy.emptyTitle} />
      ) : (
        <div className="divide-y divide-border/45">
          {skills.map(skill => (
            <ListRow
              action={
                <Badge className="gap-1" variant="default">
                  <CheckCircle2 className="size-3" />
                  {skill.available ? copy.skillReady : copy.skillMissing}
                </Badge>
              }
              below={
                <div className="mt-3 grid gap-1.5 text-[length:var(--conversation-caption-font-size)] leading-(--conversation-caption-line-height) text-(--ui-text-tertiary)">
                  <div>
                    <span className="font-medium text-foreground/80">{copy.chatInvocation}: </span>
                    <code>/{skill.skill_id}</code>
                    <span className="mx-1 text-muted-foreground/60">或</span>
                    <code>{skill.invocation}</code>
                  </div>
                  <div>
                    <span className="font-medium text-foreground/80">{copy.execution}: </span>
                    {copy.executionDesc}
                  </div>
                  <div>
                    <span className="font-medium text-foreground/80">{copy.project}: </span>
                    {skill.project_id}
                  </div>
                  <div>
                    <span className="font-medium text-foreground/80">{copy.boundary}: </span>
                    {copy.noDomainTruth}
                  </div>
                  {skill.available && (
                    <div className="inline-flex items-center gap-1.5 text-foreground/75">
                      <Sparkles className="size-3.5" />
                      {copy.slashAvailable}
                    </div>
                  )}
                </div>
              }
              description={skill.available ? copy.skillBoundary : copy.missingHint}
              key={skill.skill_id}
              title={skill.label}
              wide
            />
          ))}
        </div>
      )}
    </SettingsContent>
  )
}
