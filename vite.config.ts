import { createHash } from 'node:crypto'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const applicationBase = '/'
const localOnlyCsp = "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*"
const localOnlyHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': localOnlyCsp,
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
}

const reactRefreshPreamble = react.preambleCode.replace('__BASE__', applicationBase)
const reactRefreshPreambleHash = `sha256-${createHash('sha256').update(reactRefreshPreamble).digest('base64')}`
const localDevelopmentHeaders = {
  ...localOnlyHeaders,
  // Vite injects this one inline module in development. Keep preview strict and
  // authorize only the exact installed plugin preamble instead of unsafe-inline.
  'Content-Security-Policy': localOnlyCsp.replace(
    "script-src 'self'",
    `script-src 'self' '${reactRefreshPreambleHash}'`,
  ),
}

export default defineConfig({
  base: applicationBase,
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'vendor-react',
              test: /node_modules[\\/](?:react|react-dom)[\\/]/,
              priority: 10,
            },
            {
              name: 'vendor-idb',
              test: /node_modules[\\/]idb[\\/]/,
              priority: 9,
            },
          ],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    headers: localDevelopmentHeaders,
    port: 4173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    headers: localOnlyHeaders,
    port: 4173,
    strictPort: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/test/**'],
      thresholds: {
        statements: 70,
        branches: 65,
        functions: 67,
        lines: 76,
      },
    },
  },
})
