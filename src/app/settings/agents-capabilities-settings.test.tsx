import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'

const getOplCodexSkills = vi.fn()

vi.mock('@/hermes', () => ({
  getOplCodexSkills: () => getOplCodexSkills()
}))

vi.mock('@/store/notifications', () => ({
  notifyError: vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AgentsCapabilitiesSettings', () => {
  it('renders OPL Codex skills as user-facing chat invocation entries', async () => {
    getOplCodexSkills.mockResolvedValue({
      surface_kind: 'opl_hermes_codex_skill_catalog.v1',
      route_owner: 'codex',
      shell_role: 'implementation_adapter_only',
      bridge_mode: 'codex_app_server_skill_first_adapter',
      authority_boundary: {
        uses_codex_skill_plugin_authority: true,
        gui_executes_domain_commands: false,
        creates_second_truth_source: false,
        can_write_domain_truth: false,
        can_create_owner_receipt: false,
        can_create_typed_blocker: false,
        can_claim_domain_ready: false
      },
      skills: [
        {
          skill_id: 'mas',
          invocation: '$mas',
          agent_id: 'mas',
          project_id: 'medautoscience',
          target_domain_id: 'med-autoscience',
          label: 'Med Auto Science',
          available: true,
          codex_skill_name: 'mas',
          codex_skill_path: '/Users/gaofeng/.codex/plugins/cache/mas-local/mas/0.1.0a4/skills/mas/SKILL.md',
          codex_skill_scope: 'USER',
          codex_skill_description: 'Use when Codex should operate MedAutoScience.',
          ordinary_golden_path: 'study -> owner receipt',
          codex_prompt_contract: 'Codex chooses and operates MAS.'
        },
        {
          skill_id: 'mag',
          invocation: '$mag',
          agent_id: 'mag',
          project_id: 'medautogrant',
          target_domain_id: 'med-auto-grant',
          label: 'Med Auto Grant',
          available: true,
          codex_skill_name: 'mag',
          codex_skill_path: '/Users/gaofeng/.codex/plugins/cache/mag-local/mag/0.1.0/skills/mag/SKILL.md',
          codex_skill_scope: 'USER',
          codex_skill_description: 'Use when Codex should operate Med Auto Grant.',
          ordinary_golden_path: 'grant -> owner receipt',
          codex_prompt_contract: 'Codex chooses and operates MAG.'
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
    expect(screen.getAllByText('Codex 已发现').length).toBe(2)
    expect(screen.getByText('/mas')).toBeTruthy()
    expect(screen.getByText('/mag')).toBeTruthy()
    expect(screen.getByText('$mas')).toBeTruthy()
    expect(screen.getByText('$mag')).toBeTruthy()
    expect(screen.getAllByText(/已加入 \/ 命令面板/).length).toBe(2)
    expect(screen.getAllByText(/领域真相/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/medautoscience/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/SKILL\.md/)).toBeNull()
  })
})
