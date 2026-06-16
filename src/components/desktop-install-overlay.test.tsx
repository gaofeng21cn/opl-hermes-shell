import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/i18n'
import type { DesktopBootstrapState } from '@/global'

import { DesktopInstallOverlay } from './desktop-install-overlay'

const activeBootstrapState: DesktopBootstrapState = {
  active: true,
  completedAt: null,
  error: null,
  log: [],
  manifest: {
    protocolVersion: 1,
    stages: [
      { category: 'opl', name: 'opl-cli-check', title: 'Check One Person Lab CLI' },
      { category: 'opl', name: 'codex-cli-check', title: 'Check Codex CLI' },
      { category: 'opl', name: 'opl-initialize', title: 'Read One Person Lab status' },
      { category: 'opl', name: 'opl-core-setup', title: 'Prepare One Person Lab core components' },
      { category: 'opl', name: 'opl-post-setup-check', title: 'Verify One Person Lab setup' },
      { category: 'opl', name: 'opl-model-access', title: 'Check model access', needs_user_input: true },
      { category: 'opl', name: 'opl-codex-adapter', title: 'Prepare Codex desktop adapter' },
      { category: 'opl', name: 'opl-maintenance-schedule', title: 'Schedule background maintenance' }
    ],
    type: 'manifest'
  },
  stages: {
    'opl-cli-check': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: Date.now() - 4000,
      state: 'running'
    },
    'codex-cli-check': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: null,
      state: 'pending'
    },
    'opl-initialize': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: null,
      state: 'pending'
    },
    'opl-core-setup': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: null,
      state: 'pending'
    },
    'opl-post-setup-check': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: null,
      state: 'pending'
    },
    'opl-model-access': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: null,
      state: 'pending'
    },
    'opl-codex-adapter': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: null,
      state: 'pending'
    },
    'opl-maintenance-schedule': {
      durationMs: null,
      error: null,
      json: null,
      startedAt: null,
      state: 'pending'
    }
  },
  startedAt: Date.now() - 4000,
  unsupportedPlatform: null
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  delete (window as unknown as { hermesDesktop?: unknown }).hermesDesktop
})

describe('DesktopInstallOverlay', () => {
  it('renders localized OPL first-run stages instead of formatting stage ids', async () => {
    ;(window as unknown as { hermesDesktop: unknown }).hermesDesktop = {
      cancelBootstrap: vi.fn().mockResolvedValue({ cancelled: true, ok: true }),
      getBootstrapState: vi.fn().mockResolvedValue(activeBootstrapState),
      onBootstrapEvent: vi.fn(() => () => undefined)
    }

    render(
      <I18nProvider configClient={null} initialLocale="zh">
        <DesktopInstallOverlay />
      </I18nProvider>
    )

    expect(await screen.findByText('正在初始化 One Person Lab')).toBeTruthy()
    expect(screen.getByText(/0\/8 个步骤已完成/)).toBeTruthy()
    expect(screen.getByText(/当前：检查 One Person Lab 命令行/)).toBeTruthy()
    expect(screen.getByText('检查 One Person Lab 命令行')).toBeTruthy()
    expect(screen.getByText('检查 Codex CLI')).toBeTruthy()
    expect(screen.getByText('读取 One Person Lab 状态')).toBeTruthy()
    expect(screen.getByText('准备 One Person Lab 核心组件')).toBeTruthy()
    expect(screen.getByText('复核 One Person Lab 初始化结果')).toBeTruthy()
    expect(screen.getByText('检查模型访问')).toBeTruthy()
    expect(screen.getByText('准备 Codex 桌面适配器')).toBeTruthy()
    expect(screen.getByText('安排后台维护')).toBeTruthy()
    expect(screen.queryByText(/Opl initialize/i)).toBeNull()
    expect(screen.queryByText(/gflabtoken access/i)).toBeNull()
  })
})
