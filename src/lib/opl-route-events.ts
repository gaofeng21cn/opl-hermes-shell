import type { GatewayEventPayload } from '@/lib/chat-messages'

export type OplRouteEventType = 'route.error' | 'route.receipt' | 'route.selected'

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function firstString(...candidates: unknown[]): string {
  for (const value of candidates) {
    if (typeof value === 'string' && value) {
      return value
    }
  }

  return ''
}

export function routeEventToToolPayload(
  eventType: OplRouteEventType,
  payload: GatewayEventPayload | undefined
): GatewayEventPayload | undefined {
  const route = asRecord(payload?.route)
  const receipt = asRecord(payload?.receipt)
  const purposeId = firstString(route.purpose_id, receipt.purpose_id, payload?.purpose_id)

  if (!purposeId) {
    return undefined
  }

  const label = firstString(route.label, receipt.label, purposeId.toUpperCase())
  const status = eventType === 'route.selected' ? 'routing' : eventType === 'route.error' ? 'blocked' : 'routed'

  return {
    name: 'opl_route',
    tool_id: `opl-route:${purposeId}`,
    args: {
      purpose: purposeId,
      label,
      project: firstString(route.project_id, receipt.project_id),
      owner_surface: firstString(route.owner_surface, receipt.owner_surface),
      readback: firstString(route.start_surface, receipt.start_surface)
    },
    result: eventType === 'route.selected' ? undefined : { receipt },
    summary:
      status === 'routing'
        ? `Routing through ${label}`
        : status === 'blocked'
          ? `${label} route returned an OPL blocker`
          : `${label} route receipt recorded`,
    status,
    error: eventType === 'route.error'
  }
}
