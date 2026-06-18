import path from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://127.0.0.1/'
      }
    },
    exclude: ['node_modules/**', 'release/**', 'build/**', 'dist/**', 'out/**'],
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts']
  }
})
