import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { setSwUpdater } from './lib/swUpdate'
import './index.css'
import App from './App.tsx'

if (import.meta.env.PROD) {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event('sw-update-available'))
    },
  }) as unknown as (reloadPage?: boolean) => Promise<void>
  setSwUpdater(() => update(true))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
