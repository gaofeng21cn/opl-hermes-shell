import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { type CommandCenterSection } from '@/app/command-center'
import {
  appViewForPath,
  COMMAND_CENTER_ROUTE,
  isOverlayView,
  NEW_CHAT_ROUTE,
  redirectForHiddenFullHermesRoute,
  SETTINGS_ROUTE
} from '@/app/routes'

const SECTIONS = ['sessions', 'system'] as const satisfies readonly CommandCenterSection[]

export function useOverlayRouting() {
  const location = useLocation()
  const navigate = useNavigate()

  const currentView = appViewForPath(location.pathname)
  const settingsOpen = currentView === 'settings'
  const commandCenterOpen = currentView === 'command-center'
  const agentsOpen = settingsOpen && new URLSearchParams(location.search).get('tab') === 'agents'
  const chatOpen = currentView === 'chat'
  const overlayOpen = isOverlayView(currentView)
  const hiddenRouteRedirect = redirectForHiddenFullHermesRoute(location.pathname)

  // Overlay routes (settings/command-center/agents) stash the underlying path
  // so closing them returns there instead of bouncing to /.
  const returnPathRef = useRef(NEW_CHAT_ROUTE)

  useEffect(() => {
    if (!overlayOpen) {
      returnPathRef.current = `${location.pathname}${location.search}${location.hash}`
    }
  }, [location.hash, location.pathname, location.search, overlayOpen])

  useEffect(() => {
    if (hiddenRouteRedirect) {
      navigate(hiddenRouteRedirect, { replace: true })
    }
  }, [hiddenRouteRedirect, navigate])

  const commandCenterInitialSection = useMemo<CommandCenterSection | undefined>(
    () => SECTIONS.find(value => value === new URLSearchParams(location.search).get('section')),
    [location.search]
  )

  const openCommandCenterSection = useCallback(
    (section: CommandCenterSection) => navigate(`${COMMAND_CENTER_ROUTE}?section=${section}`),
    [navigate]
  )

  const closeOverlayToPreviousRoute = useCallback(
    () => navigate(returnPathRef.current || NEW_CHAT_ROUTE, { replace: true }),
    [navigate]
  )

  const toggleCommandCenter = useCallback(() => {
    if (commandCenterOpen) {
      closeOverlayToPreviousRoute()
    } else {
      navigate(COMMAND_CENTER_ROUTE)
    }
  }, [closeOverlayToPreviousRoute, commandCenterOpen, navigate])

  const openAgents = useCallback(() => navigate(`${SETTINGS_ROUTE}?tab=agents`), [navigate])

  return {
    agentsOpen,
    chatOpen,
    closeOverlayToPreviousRoute,
    commandCenterInitialSection,
    commandCenterOpen,
    currentView,
    openAgents,
    openCommandCenterSection,
    settingsOpen,
    toggleCommandCenter
  }
}
