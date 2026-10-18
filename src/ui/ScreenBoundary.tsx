import { Component, type ErrorInfo, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { isDemo } from '@/ui/edition.ts'

/**
 * What a screen that throws looks like (D-116's audit).
 *
 * React unmounts the whole tree when a render throws and nothing catches it,
 * so before this the app answered a bug on one screen with a **white window**.
 * In a browser tab that is a reload away from fine. In a document app it is
 * the worst screen there is: the document is bytes in memory, the reload that
 * would fix the window is the thing that discards them, and the shell's own
 * Reload was removed for exactly that reason (D-128).
 *
 * So the boundary sits inside `main` and outside nothing else: the title bar
 * and the sidebar are above it and keep working, which means **the way out is
 * to save**. The document is still there — a render threw, not the database —
 * and this says so and offers the copy.
 *
 * Reset by navigating. The boundary is keyed on the path, so choosing another
 * screen from the sidebar mounts a fresh one rather than showing the same
 * wreckage on every route.
 *
 * **Proven by breaking a real screen**, the standard D-129 packaged the icons
 * under: a throw was put at the top of `NetWorth`, the shell was driven to
 * `#/wealth/worth`, and the check was that the fallback appeared while the
 * title bar, the sidebar and `Ctrl+K` all kept working — then the throw came
 * out. There is no test, because a render test would mean a DOM environment
 * and a testing library this project does not carry.
 */
export function ScreenBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return <Boundary resetKey={pathname}>{children}</Boundary>
}

interface BoundaryProps {
  readonly resetKey: string
  readonly children: ReactNode
}

interface BoundaryState {
  readonly failure: Error | undefined
  /** The path the failure happened on, so navigating away clears it. */
  readonly at: string | undefined
}

class Boundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failure: undefined, at: undefined }

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { failure: error instanceof Error ? error : new Error(String(error)) }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ at: this.props.resetKey })
    // The console is the only place this can go: there is no telemetry and
    // there is not going to be any (D-124). A person reporting a bug reads it
    // out of DevTools, which the shell keeps on F12 (D-126).
    console.error('[emerald] a screen failed to render', error, info.componentStack)
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failure !== undefined) {
      this.setState({ failure: undefined, at: undefined })
    }
  }

  override render(): ReactNode {
    const { failure } = this.state
    if (failure === undefined) return this.props.children
    return <Failed failure={failure} onRetry={() => this.setState({ failure: undefined, at: undefined })} />
  }
}

function Failed({ failure, onRetry }: { failure: Error; onRetry: () => void }) {
  const db = useDocumentStore((state) => state.db)
  const isDirty = useDocumentStore((state) => state.isDirty)
  const busy = useDocumentStore((state) => state.busy)
  const saveCopyAs = useDocumentStore((state) => state.saveCopyAs)

  return (
    <div className="fc-view-enter mx-auto flex h-full max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="text-title">This screen could not be drawn.</p>

      {/* The message, not the stack: a stack in the interface is noise to the
          one person who sees it and the console has it in full. */}
      <p className="text-ink-secondary">{failure.message}</p>

      {db !== undefined && (
        <p className="max-w-md text-ink-secondary">
          <strong className="font-medium text-ink">Your document is still open.</strong> This is a
          bug in one screen, not in your data —{' '}
          {isDirty
            ? 'nothing since your last save has been lost, and saving a copy now keeps it.'
            : 'and there is nothing unsaved to lose.'}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={onRetry}>
          Try again
        </Button>
        {/* Not in the demo (M33 U1): a visitor has no file to keep. */}
        {db !== undefined && !isDemo() && (
          <Button onClick={() => void saveCopyAs()} disabled={busy !== undefined}>
            Save a copy…
          </Button>
        )}
        <a
          href="#/"
          className="text-accent underline underline-offset-4 transition-colors duration-[var(--duration-micro)] hover:text-accent-hover"
        >
          Go to Home
        </a>
      </div>
    </div>
  )
}
