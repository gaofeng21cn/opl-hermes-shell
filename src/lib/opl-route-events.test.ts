import { describe, expect, it } from 'vitest'

import { routeEventToToolPayload } from './opl-route-events'

describe('routeEventToToolPayload', () => {
  it('turns a selected purpose route into a running OPL route tool part', () => {
    expect(
      routeEventToToolPayload('route.selected', {
        route: {
          purpose_id: 'mas',
          label: 'Med Auto Science',
          project_id: 'medautoscience',
          owner_surface: 'opl foundry agents list --json',
          start_surface: 'opl start --project medautoscience --json'
        }
      })
    ).toMatchObject({
      name: 'opl_route',
      tool_id: 'opl-route:mas',
      args: {
        purpose: 'mas',
        label: 'Med Auto Science',
        project: 'medautoscience'
      },
      result: undefined,
      status: 'routing',
      error: false
    })
  })

  it('turns route blockers into a completed error tool part without claiming domain readiness', () => {
    const payload = routeEventToToolPayload('route.error', {
      route: { purpose_id: 'mag', label: 'Med Auto Grant', project_id: 'medautogrant' },
      receipt: {
        purpose_id: 'mag',
        status: 'route_readback_with_blockers',
        errors: [{ surface: 'opl start --project medautogrant --json', message: 'manifest missing' }]
      }
    })

    expect(payload).toMatchObject({
      name: 'opl_route',
      tool_id: 'opl-route:mag',
      status: 'blocked',
      error: true,
      summary: 'Med Auto Grant route returned an OPL blocker',
      result: {
        receipt: {
          status: 'route_readback_with_blockers'
        }
      }
    })
  })
})
