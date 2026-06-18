import { describe, expect, it } from 'vitest'

import {
  appViewForPath,
  COMMAND_CENTER_ROUTE,
  redirectForHiddenFullHermesRoute,
  SETTINGS_ROUTE
} from './routes'

describe('OPL Hermes ordinary route shape', () => {
  it('keeps full-Hermes backend pages out of the ordinary view registry', () => {
    for (const path of ['/skills', '/messaging', '/artifacts', '/cron', '/profiles', '/agents']) {
      expect(appViewForPath(path)).toBe('chat')
    }
  })

  it('redirects hidden full-Hermes deep links to OPL settings or diagnostics surfaces', () => {
    expect(redirectForHiddenFullHermesRoute('/skills')).toBe(`${SETTINGS_ROUTE}?tab=agents`)
    expect(redirectForHiddenFullHermesRoute('/messaging')).toBe(COMMAND_CENTER_ROUTE)
    expect(redirectForHiddenFullHermesRoute('/artifacts')).toBe(COMMAND_CENTER_ROUTE)
    expect(redirectForHiddenFullHermesRoute('/cron')).toBe(`${COMMAND_CENTER_ROUTE}?section=system`)
    expect(redirectForHiddenFullHermesRoute('/profiles')).toBe(SETTINGS_ROUTE)
    expect(redirectForHiddenFullHermesRoute('/agents')).toBe(`${SETTINGS_ROUTE}?tab=agents`)
  })
})
