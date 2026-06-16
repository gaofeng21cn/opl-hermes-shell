import { describe, expect, it } from 'vitest'

import {
  browserLocale,
  DEFAULT_LOCALE,
  isLocale,
  isSupportedLocaleValue,
  localeConfigValue,
  normalizeLocale
} from './languages'

describe('desktop i18n languages', () => {
  it('normalizes supported locale aliases', () => {
    expect(normalizeLocale('en')).toBe('en')
    expect(normalizeLocale('EN-US')).toBe('en')
    expect(normalizeLocale('zh')).toBe('zh')
    expect(normalizeLocale('zh-CN')).toBe('zh')
    expect(normalizeLocale('zh-Hans')).toBe('zh')
    expect(normalizeLocale(' zh_hans_cn ')).toBe('zh')
    expect(normalizeLocale('zh-Hant')).toBe('zh-hant')
    expect(normalizeLocale('zh-TW')).toBe('zh-hant')
    expect(normalizeLocale('zh_HK')).toBe('zh-hant')
    expect(normalizeLocale('ja')).toBe('ja')
    expect(normalizeLocale('ja-JP')).toBe('ja')
  })

  it('falls back to English for empty or unsupported values', () => {
    expect(normalizeLocale(null)).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('')).toBe(DEFAULT_LOCALE)
    expect(normalizeLocale('de')).toBe(DEFAULT_LOCALE)
  })

  it('distinguishes exact locale ids from supported config aliases', () => {
    expect(isSupportedLocaleValue('zh-CN')).toBe(true)
    expect(isSupportedLocaleValue('zh-TW')).toBe(true)
    expect(isSupportedLocaleValue('ja-JP')).toBe(true)
    expect(isSupportedLocaleValue('de')).toBe(false)
    expect(isLocale('zh-CN')).toBe(false)
    expect(isLocale('zh')).toBe(true)
    expect(isLocale('zh-hant')).toBe(true)
    expect(isLocale('ja')).toBe(true)
  })

  it('returns the persisted config value for supported locales', () => {
    expect(localeConfigValue('en')).toBe('en')
    expect(localeConfigValue('zh')).toBe('zh')
    expect(localeConfigValue('zh-hant')).toBe('zh-hant')
    expect(localeConfigValue('ja')).toBe('ja')
  })

  it('uses the browser language list as the first-render locale default', () => {
    const originalLanguages = Object.getOwnPropertyDescriptor(window.navigator, 'languages')
    const originalLanguage = Object.getOwnPropertyDescriptor(window.navigator, 'language')

    Object.defineProperty(window.navigator, 'languages', {
      configurable: true,
      value: ['zh-CN', 'en-US']
    })
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'en-US'
    })

    expect(browserLocale()).toBe('zh')

    if (originalLanguages) {
      Object.defineProperty(window.navigator, 'languages', originalLanguages)
    }
    if (originalLanguage) {
      Object.defineProperty(window.navigator, 'language', originalLanguage)
    }
  })
})
