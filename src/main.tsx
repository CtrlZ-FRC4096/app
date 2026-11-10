import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './core/styles.css'
import App from './App'
import { registerOfflineWorker } from './core/offline'
import { watchForUpdates } from './core/updates'

// After a new version goes live, reload to get it (src/core/updates.ts), and
// keep the app's files on this device so it opens with no connection
// (src/core/offline.ts).
watchForUpdates()
registerOfflineWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
