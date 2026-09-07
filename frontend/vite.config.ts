import { defineConfig } from 'vite'
import { reactRouter } from '@react-router/dev/vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

/**
 * Storybook builds the same app without the React Router framework plugin:
 * `reactRouter()` expects a routes module and a server build, neither of which
 * exists inside a story. The `storybook` scripts set STORYBOOK=1.
 */
const isStorybook = process.env.STORYBOOK === '1'

export default defineConfig(() => {
  return {
    plugins: [
      tailwindcss(),
      ...(isStorybook
        ? []
        : [
            reactRouter(),
          ]),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, './src'),
      },
    },
    server: {
      // The e2e suite and the API's CORS allowlist both assume port 3000.
      port: 3000,
      strictPort: true,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'esnext',
      minify: 'esbuild' as const,
      sourcemap: true,
      // No manualChunks: React Router splits per route, and hand-rolled vendor
      // chunks fight that and produce worse request waterfalls.
    },
  }
})
