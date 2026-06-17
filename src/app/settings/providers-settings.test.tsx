import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getEnvVars = vi.fn()
const setEnvVar = vi.fn()
const deleteEnvVar = vi.fn()
const revealEnvVar = vi.fn()

vi.mock('@/hermes', () => ({
  deleteEnvVar: (key: string) => deleteEnvVar(key),
  getEnvVars: () => getEnvVars(),
  revealEnvVar: (key: string) => revealEnvVar(key),
  setEnvVar: (key: string, value: string) => setEnvVar(key, value)
}))

vi.mock('@/store/notifications', () => ({
  notify: vi.fn(),
  notifyError: vi.fn()
}))

beforeEach(() => {
  getEnvVars.mockResolvedValue({
    OPENAI_API_KEY: {
      advanced: false,
      category: 'provider',
      description: 'gflabtoken API key used by One Person Lab model access.',
      is_password: true,
      is_set: false,
      redacted_value: null,
      tools: ['codex'],
      url: null
    },
    OPENAI_BASE_URL: {
      advanced: true,
      category: 'provider',
      description: 'OpenAI-compatible Base URL',
      is_password: false,
      is_set: false,
      redacted_value: null,
      tools: ['codex'],
      url: null
    },
    NOUS_API_KEY: {
      advanced: false,
      category: 'provider',
      description: 'Nous Portal key',
      is_password: true,
      is_set: false,
      redacted_value: null,
      tools: ['hermes'],
      url: null
    }
  })
  setEnvVar.mockResolvedValue({ ok: true })
  deleteEnvVar.mockResolvedValue({ ok: true })
  revealEnvVar.mockResolvedValue({ key: 'OPENAI_API_KEY', value: 'sk-test' })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

async function renderProvidersSettings() {
  const { ProvidersSettings } = await import('./providers-settings')

  return render(<ProvidersSettings />)
}

describe('ProvidersSettings', () => {
  it('shows only the One Person Lab gflabtoken model-access key in the ordinary provider page', async () => {
    await renderProvidersSettings()

    expect(await screen.findByText('gflabtoken')).toBeTruthy()
    expect(screen.getByText(/gflabtoken API key/)).toBeTruthy()
    expect(screen.queryByText(/OpenAI-compatible Base URL/)).toBeNull()
    expect(screen.queryByText(/Nous Portal/)).toBeNull()
  })

  it('saves the gflabtoken API key through the single accepted env var', async () => {
    await renderProvidersSettings()

    const input = await screen.findByPlaceholderText(/Paste gflabtoken key/i)
    fireEvent.change(input, { target: { value: 'sk-gflab-test' } })
    const saveButton = screen.getAllByRole('button', { name: /Save/i }).find(element => element.tagName === 'BUTTON')
    expect(saveButton).toBeTruthy()
    fireEvent.click(saveButton!)

    await waitFor(() => expect(setEnvVar).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk-gflab-test'))
  })
})
