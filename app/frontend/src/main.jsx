import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { removeInjectedDisclaimerBanner } from './lib/stripAiDisclaimer.js'

const CHUNK_RELOAD = 'inspire-chunk-reload'
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem(CHUNK_RELOAD) || 0)
  if (Date.now() - last < 30000) return
  sessionStorage.setItem(CHUNK_RELOAD, String(Date.now()))
  event.preventDefault()
  window.location.reload()
})

removeInjectedDisclaimerBanner()
let _discClaimerTimer
const _discClaimerObs = new MutationObserver(() => {
  clearTimeout(_discClaimerTimer)
  _discClaimerTimer = setTimeout(removeInjectedDisclaimerBanner, 100)
})
_discClaimerObs.observe(document.body, { childList: true, subtree: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
