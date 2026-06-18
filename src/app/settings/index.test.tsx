import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

vi.mock('@/hermes', () => ({
  getHermesConfigDefaults: vi.fn(),
  getHermesConfigRecord: vi.fn(),
  saveHermesConfig: vi.fn()
}))

vi.mock('./agents-capabilities-settings', () => ({ AgentsCapabilitiesSettings: () => <div>agents panel</div> }))
vi.mock('./appearance-settings', () => ({ AppearanceSettings: () => <div>appearance panel</div> }))
vi.mock('./config-settings', () => ({ ConfigSettings: () => <div>model strategy panel</div> }))
vi.mock('./mcp-settings', () => ({ McpSettings: () => <div>MCP panel</div> }))
vi.mock('./notifications-settings', () => ({ NotificationsSettings: () => <div>notifications panel</div> }))
vi.mock('./providers-settings', () => ({ ProvidersSettings: () => <div>model access panel</div> }))
vi.mock('./sessions-settings', () => ({ SessionsSettings: () => <div>sessions panel</div> }))
vi.mock('./about-settings', () => ({ AboutSettings: () => <div>about panel</div> }))

afterEach(() => {
  cleanup()
})

describe('SettingsView OPL shape', () => {
  it('keeps ordinary settings focused on OPL model access and hides upstream backend noise', async () => {
    const { SettingsView } = await import('./index')

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <MemoryRouter>
          <SettingsView onClose={() => undefined} />
        </MemoryRouter>
      </I18nProvider>
    )

    expect(screen.getByRole('button', { name: '模型策略' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '模型访问' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '智能体与能力' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'MCP' })).toBeNull()
    expect(screen.getByRole('button', { name: '关于' })).toBeTruthy()

    expect(screen.queryByRole('button', { name: '连接诊断' })).toBeNull()
    expect(screen.queryByRole('button', { name: '工具与密钥' })).toBeNull()
    expect(screen.queryByRole('button', { name: '工具' })).toBeNull()
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
  })

  it('keeps MCP available only as a deep-linked diagnostics surface', async () => {
    const { SettingsView } = await import('./index')

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <MemoryRouter initialEntries={['/settings?tab=mcp']}>
          <SettingsView onClose={() => undefined} />
        </MemoryRouter>
      </I18nProvider>
    )

    expect(screen.getByText('MCP panel')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'MCP' })).toBeNull()
  })
})
