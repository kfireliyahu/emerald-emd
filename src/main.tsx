import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './ui/theme/tokens.css'
import { App } from './App'
import { initLanguage } from './i18n/current.ts'
import { initTheme } from './ui/theme/useTheme.ts'

// Before the first render, so the correct palette is on the root element for
// the first paint and there is no flash of the wrong theme — and the page is
// in its language and runs its way (`<html lang dir>`, M60 U1) from the first.
initTheme()
initLanguage()

// One frame later, turn on the colour transitions — so the theme *toggle*
// animates but the initial load does not animate into place from a default.
requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'))

// `window.emeraldProbe()` for a session checking a screen (D-534); a dev
// build only, so the shipped app carries none of it.
if (import.meta.env.DEV) void import('./ui/probe.ts').then((probe) => probe.install())

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    {/*
      Hash routing, not path routing. It began as a `file://` requirement and
      stays now that there is no `file://` (D-133): it costs nothing, the shell
      serves the page from one `app://` origin with no server-side routing
      behind it either, and every bookmarked hash in the app keeps working.
      Changing it would be churn. See docs/conventions.md.
    */}
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
