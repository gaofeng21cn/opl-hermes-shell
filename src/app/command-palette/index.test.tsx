import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { closeCommandPalette, openCommandPalette } from '@/store/command-palette'

import { CommandPalette } from './index'

vi.mock('@/hermes', () => ({
  getHermesConfigRecord: vi.fn().mockResolvedValue({ mcp_servers: {} }),
  listAllProfileSessions: vi.fn().mockResolvedValue({ sessions: [] })
}))

vi.mock('@/themes/context', () => ({
  useTheme: () => ({
    availableThemes: [],
    resolvedMode: 'light',
    setMode: vi.fn(),
    setTheme: vi.fn(),
    themeName: 'stitch'
  })
}))

vi.mock('@/themes/user-themes', () => ({
  isUserTheme: () => false,
  resolveTheme: () => null
}))

vi.mock('@/themes/color', () => ({
  luminance: () => 1
}))

afterEach(() => {
  closeCommandPalette()
  cleanup()
  vi.clearAllMocks()
})

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: ResizeObserverStub
  })

  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  })
})

function renderCommandPalette() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  })

  render(
    <I18nProvider configClient={null} initialLocale="en">
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <CommandPalette />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>
  )

  act(() => openCommandPalette())
}

describe('CommandPalette OPL settings shape', () => {
  it('keeps ordinary settings navigation on OPL model access and hides upstream gateway/key pages', async () => {
    renderCommandPalette()

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Model Access')).toBeTruthy()
    expect(screen.getByText('Agents & Capabilities')).toBeTruthy()
    expect(screen.getByText('MCP')).toBeTruthy()
    expect(screen.getByText('Archived Chats')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()

    expect(screen.queryByText('Connection diagnostics')).toBeNull()
    expect(screen.queryByText('Tools & Keys')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('Search sessions, views, and actions'), {
      target: { value: 'gateway' }
    })

    expect(screen.queryByText('Connection diagnostics')).toBeNull()
  })
})
