import { type CSSProperties } from 'react'

import { requestComposerInsert } from '@/app/chat/composer/focus'
import { useI18n } from '@/i18n'
import type { Translations } from '@/i18n'
import { Brain, FileText, Sparkles } from '@/lib/icons'
import { cn } from '@/lib/utils'

export type IntroProps = {
  personality?: string
  seed?: number
}

type OplRouteId = 'mag' | 'mas' | 'rca'

type OplRouteChip = {
  icon: typeof Brain
  id: OplRouteId
}

const WORDMARK = 'One Person Lab'

const ROUTE_CHIPS: readonly OplRouteChip[] = [
  {
    icon: Brain,
    id: 'mas'
  },
  {
    icon: FileText,
    id: 'mag'
  },
  {
    icon: Sparkles,
    id: 'rca'
  }
]

function routeChipTitle(route: Translations['intro']['routes'][OplRouteId]): string {
  return `${route.label} / ${route.shortLabel} - ${route.description}`
}

export function Intro({ personality, seed }: IntroProps) {
  void personality
  void seed
  const { t } = useI18n()
  const copy = t.intro

  const selectRoute = (route: OplRouteChip) => {
    requestComposerInsert(`$${route.id} `, { mode: 'inline', target: 'main' })
  }

  return (
    <div
      className="flex w-full min-w-0 flex-col items-center justify-center px-0.5 py-6 text-center text-muted-foreground sm:px-6 lg:px-8"
      data-slot="aui_intro"
    >
      <div className="w-full min-w-0">
        <p
          aria-label={WORDMARK}
          className="fit-text pointer-events-none mx-auto mb-1 w-[calc(100%-1rem)] font-['Collapse'] font-bold leading-[0.9] text-midground mix-blend-plus-lighter dark:text-foreground/90"
          style={{ '--fit-min': '2.75rem' } as CSSProperties}
        >
          <span>
            <span>{WORDMARK}</span>
          </span>
          <span aria-hidden="true">{WORDMARK}</span>
        </p>

        <p className="pointer-events-none m-0 text-center leading-normal tracking-tight">{copy.body}</p>
        <div
          aria-label={copy.routeAria}
          className="mx-auto mt-4 flex max-w-[34rem] flex-wrap items-center justify-center gap-2"
        >
          {ROUTE_CHIPS.map(route => {
            const Icon = route.icon
            const routeCopy = copy.routes[route.id]

            return (
              <button
                aria-label={routeChipTitle(routeCopy)}
                className={cn(
                  'group inline-flex h-9 items-center gap-2 rounded-full border border-border/60 bg-(--composer-fill) px-3 text-[0.75rem] font-medium text-foreground/82 shadow-[0_0.375rem_1.5rem_color-mix(in_srgb,var(--dt-foreground)_8%,transparent)]',
                  'backdrop-blur-[0.75rem] backdrop-saturate-[1.08] transition-[border-color,background-color,color,transform,box-shadow] duration-150 ease-out',
                  'hover:-translate-y-px hover:border-primary/45 hover:bg-[color-mix(in_srgb,var(--dt-primary)_8%,var(--composer-fill))] hover:text-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                )}
                data-codex-skill={route.id}
                key={route.id}
                onClick={() => selectRoute(route)}
                title={routeChipTitle(routeCopy)}
                type="button"
              >
                <Icon className="size-4 text-primary/80 transition-colors group-hover:text-primary" strokeWidth={1.75} />
                <span>{routeCopy.label}</span>
                <span className="text-[0.6875rem] font-normal text-(--ui-text-tertiary)">{routeCopy.shortLabel}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
