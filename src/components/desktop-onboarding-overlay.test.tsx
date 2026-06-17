import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $desktopOnboarding, type DesktopOnboardingState, type OnboardingContext } from '@/store/onboarding'
import type { OAuthProvider } from '@/types/hermes'

import { Picker } from './desktop-onboarding-overlay'

const hermesMocks = vi.hoisted(() => ({
  getGlobalModelOptions: vi.fn()
}))

vi.mock('@/hermes', () => ({
  getGlobalModelOptions: () => hermesMocks.getGlobalModelOptions()
}))

function provider(id: string, name = id): OAuthProvider {
  return {
    cli_command: `hermes login ${id}`,
    docs_url: `https://example.com/${id}`,
    flow: 'pkce',
    id,
    name,
    status: { logged_in: false }
  }
}

function setProviders(providers: OAuthProvider[]) {
  $desktopOnboarding.set({
    configured: false,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers,
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false
  } satisfies DesktopOnboardingState)
}

const ctx: OnboardingContext = { requestGateway: async () => undefined as never }

beforeEach(() => {
  ensureLocalStorage()
  hermesMocks.getGlobalModelOptions.mockResolvedValue({
    providers: [
      { name: 'gflabtoken', slug: 'gflab', models: ['openai/gpt-5.5'], authenticated: false, auth_type: 'api_key', key_env: 'OPENAI_API_KEY' },
      { name: 'DeepSeek', slug: 'deepseek', models: [], authenticated: false, auth_type: 'api_key', key_env: 'DEEPSEEK_API_KEY' }
    ]
  })
})

afterEach(() => {
  cleanup()

  try {
    window.localStorage.clear()
  } catch {
    // jsdom localStorage should always be present; ignore if not.
  }

  $desktopOnboarding.set({
    configured: null,
    flow: { status: 'idle' },
    mode: 'oauth',
    providers: null,
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false
  })
})

describe('onboarding Picker', () => {
  it('renders the Chinese OPL model access copy for API-key first run', () => {
    $desktopOnboarding.set({
      ...baseApiKeyState(),
      reason: 'request timed out: setup.runtime_check'
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Picker ctx={ctx} />
      </I18nProvider>
    )

    expect(screen.getByText('One Person Lab 模型访问')).toBeTruthy()
    expect(screen.getByText('默认模型访问')).toBeTruthy()
    expect(screen.getByText(/为 One Person Lab 默认 Codex 适配器配置 API 密钥/)).toBeTruthy()
    expect(screen.getByPlaceholderText('粘贴 API 密钥')).toBeTruthy()
    expect(screen.queryByText(/访问权限/)).toBeNull()
    expect(screen.queryByText(/request timed out/)).toBeNull()
  })

  it('does not expose upstream API-key marketplace entries in OPL first run', async () => {
    $desktopOnboarding.set({
      ...baseApiKeyState(),
      reason: 'missing model access'
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Picker ctx={ctx} />
      </I18nProvider>
    )

    expect(screen.getByText('One Person Lab 模型访问')).toBeTruthy()
    expect(screen.getByText(/gflabtoken/)).toBeTruthy()
    expect(screen.queryByText('DeepSeek')).toBeNull()
    expect(screen.queryByText('OpenRouter')).toBeNull()
    expect(screen.queryByText(/自托管/)).toBeNull()
  })

  it('does not expose the legacy Base URL endpoint even when local endpoint setup is requested', () => {
    $desktopOnboarding.set({
      ...baseApiKeyState(),
      localEndpoint: true,
      reason: 'legacy local endpoint request'
    })

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <Picker ctx={ctx} />
      </I18nProvider>
    )

    expect(screen.getByText('One Person Lab 模型访问')).toBeTruthy()
    expect(screen.getByPlaceholderText('粘贴 API 密钥')).toBeTruthy()
    expect(screen.queryByDisplayValue('OPENAI_BASE_URL')).toBeNull()
    expect(screen.queryByText(/Base URL/i)).toBeNull()
    expect(screen.queryByText(/自定义/)).toBeNull()
  })

  it('features Nous Portal and hides other providers behind a disclosure', () => {
    setProviders([provider('anthropic', 'Anthropic Claude'), provider('nous', 'Nous Portal')])
    render(<Picker ctx={ctx} />)

    expect(screen.getByText('Nous Portal')).toBeTruthy()
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.queryByText('Anthropic API Key')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Model access configuration' }))

    expect(screen.getByText('Anthropic API Key')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeTruthy()
  })

  it('shows every provider directly when Nous Portal is absent', () => {
    setProviders([provider('anthropic', 'Anthropic Claude'), provider('openai-codex', 'OpenAI Codex / ChatGPT')])
    render(<Picker ctx={ctx} />)

    expect(screen.getByText('Anthropic API Key')).toBeTruthy()
    expect(screen.getByText('OpenAI OAuth (ChatGPT)')).toBeTruthy()
    expect(screen.queryByText('Other sign-in options')).toBeNull()
    expect(screen.queryByText('Recommended')).toBeNull()
  })

  it('offers "choose later" on first run and persists the skip', () => {
    setProviders([provider('nous', 'Nous Portal')])
    render(<Picker ctx={ctx} />)

    const skip = screen.getByRole('button', { name: "I'll configure model access later" })

    fireEvent.click(skip)

    expect($desktopOnboarding.get().firstRunSkipped).toBe(true)
    expect(window.localStorage.getItem('hermes-onboarding-skipped-v1')).toBe('1')
  })

  it('hides "choose later" in manual (add-provider) mode', () => {
    setProviders([provider('nous', 'Nous Portal')])
    $desktopOnboarding.set({ ...$desktopOnboarding.get(), manual: true })
    render(<Picker ctx={ctx} />)

    expect(screen.queryByRole('button', { name: "I'll configure model access later" })).toBeNull()
  })
})

function ensureLocalStorage() {
  if (window.localStorage) {
    return
  }

  const store = new Map<string, string>()

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      key: (index: number) => [...store.keys()][index] ?? null,
      removeItem: (key: string) => store.delete(key),
      setItem: (key: string, value: string) => store.set(key, String(value)),
      get length() {
        return store.size
      }
    }
  })
}

function baseApiKeyState(): DesktopOnboardingState {
  return {
    configured: false,
    flow: { status: 'idle' },
    mode: 'apikey',
    providers: [],
    reason: null,
    requested: false,
    firstRunSkipped: false,
    manual: false,
    localEndpoint: false
  }
}
