import { useEffect } from 'react'

import { shellWindow } from '@/data/storage/desktop.ts'
import { CommandPaletteButton } from '@/ui/CommandPalette.tsx'
import { DocumentBar } from '@/ui/DocumentBar.tsx'
import { HistoryArrows } from '@/ui/HistoryArrows.tsx'
import { useTheme } from '@/ui/theme/useTheme.ts'
import { useWindowFocused, useWindowFrame } from '@/ui/useWindowFrame.ts'

/**
 * The title bar the app draws, in a window with no frame of its own (D-130).
 *
 * It exists because the row the OS was drawing said nothing. This one carries
 * the document — its name and whether it is saved — which D-021 makes permanent
 * context rather than a thing you go and look up, and it is where `DocumentBar`
 * lives in the shell.
 *
 * **The drag region is the whole point and the whole risk.** A window you
 * cannot drag by its title bar is worse than one the OS drew, and so is a title
 * bar that eats the click meant for Save. The rule is declared once, in
 * `tokens.css`: this element is a drag handle, and every interactive descendant
 * opts back out. Nothing here has to remember to.
 *
 * **In a browser tab it is the same row without the drag region.** The top
 * header is gone (D-130) and the document has to live somewhere; one row that
 * is a window title bar in the shell and a document row in a tab is a smaller
 * thing to hold in your head than two layouts.
 */
export function TitleBar() {
  const frame = useWindowFrame()
  const focused = useWindowFocused()
  const { resolved } = useTheme()

  // The caption buttons are painted by the platform, from colours the shell
  // holds; the theme is in the page's localStorage and the shell cannot read
  // it. So the page says which one it settled on, whenever that changes.
  useEffect(() => shellWindow()?.setTheme(resolved), [resolved])

  return (
    <div
      // `app-drag` is what makes this a window handle, and only the shell gets
      // it: the double-click to maximise and the OS's snap gestures come with
      // it for free, and in a browser tab it would only stop text selecting.
      className={`flex shrink-0 items-center gap-3 border-b border-hairline bg-surface transition-opacity duration-[var(--duration-base)] ${
        frame === undefined ? 'px-6 py-2' : 'app-drag'
      }`}
      style={
        frame === undefined
          ? {}
          : {
              height: frame.height,
              paddingInlineStart: Math.max(frame.insetStart, 12),
              paddingInlineEnd: frame.insetEnd,
            }
      }
      data-inactive={frame !== undefined && !focused}
    >
      <HistoryArrows />
      {/* The palette's button (M46 U1): beside the arrows, which no document name crowds out. */}
      <CommandPaletteButton />
      <DocumentBar />
    </div>
  )
}
