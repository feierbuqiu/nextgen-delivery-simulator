import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const localOnlyHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
}

export default defineConfig({
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
    headers: localOnlyHeaders,
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
