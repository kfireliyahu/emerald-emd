import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import './ui/theme/tokens.css'
import { App } from './App'
import { initTheme } from './ui/theme/useTheme.ts'

// Before the first render, so the correct palette is on the root element for
// the first paint and there is no flash of the wrong theme.
initTheme()

// One frame later, turn on the colour transitions — so the theme *toggle*
// animates but the initial load does not animate into place from a default.
requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'))

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
