import { useEffect, useRef, useState } from 'react'

/**
 * Accepts a file dropped anywhere in the window, and reports whether a drag is
 * currently over it so the UI can show a target.
 *
 * The window-level `dragover` handler is not optional: without a
 * `preventDefault` there, the browser treats the drop as navigation and
 * replaces the app with the raw file.
 */
export function useWindowFileDrop(onFiles: (files: readonly File[]) => void): boolean {
  const [isDraggingFile, setDraggingFile] = useState(false)

  // Kept in a ref so a new handler identity doesn't tear down the listeners.
  const onFileRef = useRef(onFiles)
  onFileRef.current = onFiles

  useEffect(
    () =>
      watchFileDrag(window, {
        onDragging: setDraggingFile,
        onFiles: (files) => onFileRef.current(files),
      }),
    [],
  )

  return isDraggingFile
}

/**
 * The listeners behind {@link useWindowFileDrop}, on any target, so a test can
 * drive them without a DOM. Returns the teardown.
 *
 * **What lets go of the overlay** (M28 F12). A screen's own drop zone — Home's
 * band, Read files, Paychecks — stops its `drop` from reaching the window, so
 * the ledger's mapper does not read the same files twice. That stop also kept
 * the window from hearing the drop *at all*, and the overlay that says "drop
 * here" stayed up until another drag came and went. So the drop that clears
 * the overlay is heard in the **capture** phase, before any zone can stop it;
 * the drop that *reads* stays in the bubble phase, where a zone's stop still
 * wins. Leaving the window (`relatedTarget` is nobody) and `Escape` clear it
 * too, whatever the depth count says.
 */
export function watchFileDrag(
  target: EventTarget,
  on: { readonly onDragging: (dragging: boolean) => void; readonly onFiles: (files: readonly File[]) => void },
): () => void {
  // `dragenter`/`dragleave` fire again for every element the pointer crosses,
  // so a boolean flickers. Count depth instead.
  let depth = 0
  let dragging = false
  const set = (next: boolean): void => {
    if (next === dragging) return
    dragging = next
    on.onDragging(next)
  }
  const reset = (): void => {
    depth = 0
    set(false)
  }

  const carriesFiles = (event: Event): boolean => {
    const transfer = (event as DragEvent).dataTransfer
    return transfer !== null && transfer !== undefined && Array.from(transfer.types).includes('Files')
  }

  const handleDragEnter = (event: Event): void => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    depth += 1
    set(true)
  }

  const handleDragOver = (event: Event): void => {
    if (!carriesFiles(event)) return
    event.preventDefault()
    const transfer = (event as DragEvent).dataTransfer
    if (transfer !== null) transfer.dropEffect = 'copy'
  }

  const handleDragLeave = (event: Event): void => {
    if (!carriesFiles(event)) return
    // Out of the window: there is no element the pointer went to.
    if ((event as DragEvent).relatedTarget === null) {
      reset()
      return
    }
    depth = Math.max(0, depth - 1)
    if (depth === 0) set(false)
  }

  /** Capture: heard even when a screen's drop zone stops the event. */
  const handleDropCapture = (): void => reset()

  const handleDrop = (event: Event): void => {
    event.preventDefault()
    reset()
    // Every file dropped, since M28 U5: Home reads any number at once.
    const files = Array.from((event as DragEvent).dataTransfer?.files ?? [])
    if (files.length > 0) on.onFiles(files)
  }

  const handleKeyDown = (event: Event): void => {
    if ((event as KeyboardEvent).key === 'Escape' && dragging) reset()
  }

  target.addEventListener('dragenter', handleDragEnter)
  target.addEventListener('dragover', handleDragOver)
  target.addEventListener('dragleave', handleDragLeave)
  target.addEventListener('drop', handleDropCapture, true)
  target.addEventListener('drop', handleDrop)
  target.addEventListener('dragend', handleDropCapture, true)
  target.addEventListener('keydown', handleKeyDown)

  return () => {
    target.removeEventListener('dragenter', handleDragEnter)
    target.removeEventListener('dragover', handleDragOver)
    target.removeEventListener('dragleave', handleDragLeave)
    target.removeEventListener('drop', handleDropCapture, true)
    target.removeEventListener('drop', handleDrop)
    target.removeEventListener('dragend', handleDropCapture, true)
    target.removeEventListener('keydown', handleKeyDown)
  }
}
