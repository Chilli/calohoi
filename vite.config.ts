import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/calohoi/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      devOptions: {
        enabled: false,
      },
      includeAssets: ['favicon.svg', 'icons.svg'],
      manifest: {
        name: 'Calorieohhoi',
        short_name: 'Calorieohhoi',
        description: 'Offline-first calorie & macro tracker',
        start_url: '/calohoi/',
        scope: '/calohoi/',
        display: 'standalone',
        background_color: '#fafafa',
        theme_color: '#10b981',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
          {
            src: 'icons.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
})
