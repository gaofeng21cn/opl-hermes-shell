import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

const getOplPurposeRoutes = vi.fn()

vi.mock('@/hermes', () => ({
  getOplPurposeRoutes: () => getOplPurposeRoutes()
}))

vi.mock('@/store/notifications', () => ({
  notifyError: vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AgentsCapabilitiesSettings', () => {
  it('renders OPL purpose routes as read-only capability entries', async () => {
    getOplPurposeRoutes.mockResolvedValue({
      surface_kind: 'opl_hermes_purpose_route_catalog.v1',
      route_owner: 'one-person-lab',
      shell_role: 'implementation_adapter_only',
      bridge_mode: 'executor_agent_route_bridge',
      authority_boundary: {
        uses_opl_cli_app_action_or_skill_authority: true,
        creates_second_truth_source: false,
        can_write_domain_truth: false,
        can_create_owner_receipt: false,
        can_create_typed_blocker: false,
        can_claim_domain_ready: false
      },
      routes: [
        {
          purpose_id: 'mas',
          aliases: ['mas', '科研', '论文', '糖尿病'],
          agent_id: 'mas',
          project_id: 'medautoscience',
          target_domain_id: 'med-autoscience',
          label: 'Med Auto Science',
          owner_surface: 'opl foundry agents list --json',
          start_surface: 'opl start --project medautoscience --json',
          app_action_id: 'workspace_ensure',
          app_action_payload: { agent_id: 'mas' },
          ordinary_golden_path: 'study -> owner receipt',
          codex_prompt_contract: 'Do not write MAS truth.'
        },
        {
          purpose_id: 'mag',
          aliases: ['mag', '基金'],
          agent_id: 'mag',
          project_id: 'medautogrant',
          target_domain_id: 'med-auto-grant',
          label: 'Med Auto Grant',
          owner_surface: 'opl foundry agents list --json',
          start_surface: 'opl start --project medautogrant --json',
          app_action_id: 'workspace_ensure',
          app_action_payload: { agent_id: 'mag' },
          ordinary_golden_path: 'grant -> owner receipt',
          codex_prompt_contract: 'Do not write MAG truth.'
        }
      ]
    })

    const { AgentsCapabilitiesSettings } = await import('./agents-capabilities-settings')

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <AgentsCapabilitiesSettings />
      </I18nProvider>
    )

    expect(await screen.findByText('Med Auto Science')).toBeTruthy()
    expect(screen.getByText('Med Auto Grant')).toBeTruthy()
    expect(screen.getAllByText('可路由').length).toBe(2)
    expect(screen.getAllByText(/不写领域真相/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/medautoscience/).length).toBeGreaterThan(0)
  })
})
