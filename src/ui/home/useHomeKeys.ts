import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * **Keys for Home** (S5): ← → page the period, M and Y switch
 * between Month and Year, and Ctrl+Shift+O reads files.
 *
 * **Ctrl+Shift+O and not Ctrl+O**: Ctrl+O is File › Open in the shell's menu
 * (`electron/menu.ts`), a registered accelerator that reaches the window before
 * the page ever could, and opening another document is not something a key on
 * one screen gets to take over. Recorded in D-313.
 *
 * None of them fires while something that takes typing has focus.
 */
export function useHomeKeys(handlers: {
  readonly page?: (step: -1 | 1) => void
  readonly readFiles: () => void
}): void {
  const navigate = useNavigate()
  const ref = useRef(handlers)
  ref.current = handlers

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey) return
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="menu"], [role="dialog"]')) {
        return
      }
      const key = event.key.toLowerCase()
      const command = event.ctrlKey || event.metaKey

      if (command && event.shiftKey && key === 'o') {
        event.preventDefault()
        ref.current.readFiles()
        return
      }
      if (command || event.shiftKey) return

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (ref.current.page === undefined) return
        event.preventDefault()
        ref.current.page(event.key === 'ArrowLeft' ? -1 : 1)
      } else if (key === 'm') {
        navigate('/')
      } else if (key === 'y') {
        navigate('/year')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])
}
