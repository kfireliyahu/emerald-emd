import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import {
  samePort,
  type Edge,
  type GraphNode,
  type GraphPort,
  type Port,
} from '@/domain/format/connections.ts'
import type { GraphPlace } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { TypeGlyph } from '@/ui/formats/TypeGlyph.tsx'
import {
  anchorOf,
  foldedInto,
  nearestPort,
  pathBetween,
  placeGraph,
  PORT_HEIGHT,
  HEAD_HEIGHT,
  type PlacedGroup,
  type PlacedPort,
} from '@/ui/formats/connectionLayout.ts'

/**
 * **The graph** — M20 U5, [D-233](../../../docs/09-decision-log.md); a canvas
 * since M26 U4 (D-291).
 *
 * Each format is a bubble, its columns are endpoints around it, and a
 * connection is a drag from one endpoint to another. The bubbles are ordinary
 * DOM and the edges are one SVG layer over them, which is not a compromise: an
 * endpoint is a control a person operates, so it is a `button` — focusable,
 * hoverable, and reachable by a keyboard — rather than a `circle` with a
 * listener. The SVG is `pointer-events: none` except on the curves themselves,
 * so it draws over the bubbles without standing in front of them.
 *
 * ## Three ways to make the same connection, because a drag is not always one
 *
 * A **drag** from an endpoint to another. A **press on one endpoint and then on
 * another**, which is the same gesture with the finger up in between and is what
 * makes this screen usable with a trackpad and a small window. And **a keyboard**
 * — Enter or Space on a focused endpoint is the press, Escape lets it go.
 *
 * That third one is not politeness. `useRowCursor` is the house rule for a
 * table and this is not a table, but the harness a session drives the shell
 * with delivers a keydown and synthesizes no click (D-232): an endpoint that
 * only answered a pointer would be an endpoint nothing but a person could ever
 * check.
 *
 * ## The canvas: a drag on the background pans, a wheel or a pinch zooms
 *
 * The bubbles and the curves sit in one layer under a single transform, so the
 * arithmetic in `connectionLayout.ts` stays in canvas pixels and only
 * `pointAt` knows the view exists. **A bubble moves by its grip**, not by its
 * head: the head is the row endpoint, and a drag from it is a connection. The
 * grip answers the arrow keys too, for D-232's reason. A move is written to the
 * document when the pointer lets go — one write per move, not one per frame.
 *
 * ## The drop is resolved against coordinates, not against the element
 *
 * `nearestPort` answers what the pointer is over, from the endpoints' own
 * positions. A curve, a label and a bubble all sit between a finger and the dot
 * it is aiming at, and a hit test through the DOM would make the drop depend on
 * which of them happened to be on top.
 */

/** How far the canvas is panned, in screen pixels, and how far it is zoomed. */
interface View {
  readonly x: number
  readonly y: number
  readonly zoom: number
}

const NEAREST_ZOOM = 2.5
const FARTHEST_ZOOM = 0.2
/** A press that moves less than this is a click, not a drag. */
const STILL = 4
/** One arrow key on a grip. */
const NUDGE = 16

function clampZoom(zoom: number): number {
  return Math.min(NEAREST_ZOOM, Math.max(FARTHEST_ZOOM, zoom))
}

/** What a grip, or a folded group's head, answers. */
interface DragHandlers {
  readonly onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
  readonly onPointerCancel: () => void
  readonly onKeyDown: (event: ReactKeyboardEvent) => void
}

/** A bubble or a folded group being dragged, and where it started. */
interface Moving {
  readonly kind: 'FORMAT' | 'PACK'
  readonly name: string
  readonly from: { readonly x: number; readonly y: number }
  readonly start: { readonly x: number; readonly y: number }
  readonly by: { readonly x: number; readonly y: number }
}

export function ConnectionGraph({
  nodes,
  edges,
  armed,
  onArm,
  onConnect,
  onOpen,
  packOf,
  opened,
  onOpenPack,
  found,
  places,
  onPlace,
  focus,
}: {
  nodes: readonly GraphNode[]
  edges: readonly Edge[]
  /** The endpoint waiting for its other half, held by the screen so the panel can name it. */
  armed: Port | undefined
  onArm: (port: Port | undefined) => void
  onConnect: (from: Port, to: Port) => void
  onOpen: (edge: Edge) => void
  /** The pack that owns each format a pack owns (D-269). */
  packOf: ReadonlyMap<string, string>
  /** The packs opened; every other pack is one bubble. */
  opened: ReadonlySet<string>
  onOpenPack: (pack: string) => void
  /** A format somebody searched for: the view goes to it, each time it is asked (M29 F9). */
  found?: { readonly name: string; readonly at: number } | undefined
  /** Where a person left things, from the document (D-291). */
  places: readonly GraphPlace[]
  /** Somebody let go of a bubble: these are its new places, to be written. */
  onPlace: (places: readonly GraphPlace[]) => void
  /**
   * The formats the connection window is open on (M29 F10). When the window
   * takes some of the canvas's height, the view moves so these stay in sight —
   * at 600 pixels tall the window used to push the bottom one out of view.
   */
  focus?: readonly string[] | undefined
}) {
  const [moving, setMoving] = useState<Moving | undefined>(undefined)
  const shown = moving === undefined ? places : withMove(places, moving)
  const placement = placeGraph(nodes, { packOf, opened, places: shown })

  const viewport = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>(() => ({ x: 0, y: 0, zoom: 1 }))
  const viewNow = useRef(view)
  viewNow.current = view
  /** The background pointers down: one is a pan, two are a pinch. */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pan = useRef<{ readonly view: View; readonly x: number; readonly y: number } | undefined>(
    undefined,
  )
  const pinch = useRef<{ readonly view: View; readonly distance: number } | undefined>(undefined)

  /**
   * The armed endpoint, readable *now* rather than after a render.
   *
   * `armed` is a prop, so between pressing an endpoint and the screen coming
   * back with it there is a frame in which this component's handlers still see
   * `undefined` — and the first `pointermove` of a quick drag lands in exactly
   * that frame. A drag that dropped nothing because the press had not been
   * acknowledged yet is the kind of intermittence nobody can reproduce, so the
   * two pointer handlers read the ref and the drawing reads the prop.
   */
  const armedNow = useRef<Port | undefined>(armed)
  armedNow.current = armed
  const [cursor, setCursor] = useState<{ readonly x: number; readonly y: number } | undefined>(
    undefined,
  )
  const [over, setOver] = useState<Port | undefined>(undefined)

  /** Zoom about a point on the screen, so what is under the pointer stays there. */
  const zoomAbout = (factor: number, screenX: number, screenY: number): void => {
    setView((now) => {
      const zoom = clampZoom(now.zoom * factor)
      const scale = zoom / now.zoom
      return { zoom, x: screenX - (screenX - now.x) * scale, y: screenY - (screenY - now.y) * scale }
    })
  }

  /** The buttons zoom about the middle of the canvas. */
  const zoomCentre = (factor: number): void => {
    const box = viewport.current?.getBoundingClientRect()
    zoomAbout(factor, (box?.width ?? 0) / 2, (box?.height ?? 0) / 2)
  }

  // A wheel listener has to be registered by hand: React's is passive, and a
  // passive listener cannot stop the page scrolling under the zoom. A trackpad
  // pinch arrives as a wheel with Ctrl held, in smaller steps.
  useEffect(() => {
    const element = viewport.current
    if (element === null) return
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      const box = element.getBoundingClientRect()
      const rate = event.ctrlKey ? 0.01 : 0.0015
      zoomAbout(Math.exp(-event.deltaY * rate), event.clientX - box.left, event.clientY - box.top)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  /** A pointer on the screen, in canvas pixels — the only place the view is undone. */
  const pointAt = (event: { clientX: number; clientY: number }): { x: number; y: number } | undefined => {
    const box = viewport.current?.getBoundingClientRect()
    if (box === undefined) return undefined
    const { x, y, zoom } = viewNow.current
    return { x: (event.clientX - box.left - x) / zoom, y: (event.clientY - box.top - y) / zoom }
  }

  /**
   * One endpoint touched: it either arms, or completes what was armed.
   *
   * The same function for a press and for a key, which is what keeps the three
   * gestures from being three code paths that drift.
   */
  const touch = (port: Port): void => {
    const held = armedNow.current
    if (held === undefined) {
      armedNow.current = port
      onArm(port)
      return
    }
    if (samePort(held, port)) {
      armedNow.current = undefined
      onArm(undefined)
      return
    }
    armedNow.current = undefined
    onConnect(held, port)
    onArm(undefined)
  }

  /** Where a move lands, as the places to write: a group carries its placed members. */
  const settle = (kind: 'FORMAT' | 'PACK', name: string, x: number, y: number, dx: number, dy: number): void => {
    const writes: GraphPlace[] = [{ kind, name, x, y }]
    if (kind === 'PACK') {
      for (const each of places) {
        if (each.kind === 'FORMAT' && packOf.get(each.name) === name) {
          writes.push({ ...each, x: each.x + dx, y: each.y + dy })
        }
      }
    }
    onPlace(writes)
  }

  /** The grip's pointer handlers, and a folded group's: a drag moves it. */
  const dragHandlers = (
    kind: 'FORMAT' | 'PACK',
    name: string,
    from: { readonly x: number; readonly y: number },
    onStill?: () => void,
  ): DragHandlers => ({
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.setPointerCapture(event.pointerId)
      setMoving({ kind, name, from, start: { x: event.clientX, y: event.clientY }, by: { x: 0, y: 0 } })
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => {
      setMoving((now) =>
        now === undefined || now.kind !== kind || now.name !== name
          ? now
          : {
              ...now,
              by: {
                x: (event.clientX - now.start.x) / viewNow.current.zoom,
                y: (event.clientY - now.start.y) / viewNow.current.zoom,
              },
            },
      )
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      const now = moving
      setMoving(undefined)
      if (now === undefined || now.kind !== kind || now.name !== name) return
      const distance = Math.hypot(event.clientX - now.start.x, event.clientY - now.start.y)
      if (distance < STILL) {
        onStill?.()
        return
      }
      settle(
        kind,
        name,
        Math.round(now.from.x + now.by.x),
        Math.round(now.from.y + now.by.y),
        Math.round(now.by.x),
        Math.round(now.by.y),
      )
    },
    onPointerCancel: () => setMoving(undefined),
    onKeyDown: (event: ReactKeyboardEvent) => {
      const step = ARROWS[event.key]
      if (step === undefined) return
      event.preventDefault()
      const dx = step.x * NUDGE
      const dy = step.y * NUDGE
      settle(kind, name, from.x + dx, from.y + dy, dx, dy)
    },
  })

  /** The rubber band: to the endpoint under the pointer, or to the pointer. */
  const armedAnchor = armed === undefined ? undefined : anchorOf(placement, armed)
  const overAnchor = over === undefined ? undefined : anchorOf(placement, over)
  const band =
    armedAnchor === undefined
      ? undefined
      : overAnchor !== undefined
        ? pathBetween(armedAnchor, overAnchor)
        : cursor === undefined
          ? undefined
          : `M ${armedAnchor.x} ${armedAnchor.y} L ${cursor.x} ${cursor.y}`

  // **A search goes to what it found** (M29 F9): once the pack it is in is
  // open, the bubble is brought into the middle of the canvas at a zoom it can
  // be read at. Keyed on the moment it was asked, so asking twice goes twice.
  const foundAt = found?.at
  useEffect(() => {
    if (found === undefined) return
    const placed = placement.nodes.find((each) => each.node.name === found.name)
    const box = viewport.current?.getBoundingClientRect()
    if (placed === undefined || box === undefined) return
    const zoom = clampZoom(Math.max(viewNow.current.zoom, 0.8))
    const x = box.width / 2 - (placed.x + placed.width / 2) * zoom
    const tall = placed.height * zoom > box.height - 48
    const y = tall ? 24 - placed.y * zoom : box.height / 2 - (placed.y + placed.height / 2) * zoom
    setView({ zoom, x, y })
    // The placement is read as it is on the render the search landed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foundAt])

  // **What the window is about stays in sight** (M29 F10). The canvas's height
  // is watched, because the window docking under it is what takes it away; when
  // either bubble is out of the box the view moves by the least that brings
  // both back, and zooms out only when they cannot fit as they are.
  const [tall, setTall] = useState(0)
  useEffect(() => {
    const element = viewport.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const watch = new ResizeObserver(() => setTall(element.getBoundingClientRect().height))
    watch.observe(element)
    return () => watch.disconnect()
  }, [])
  const focusKey = (focus ?? []).join(' ')
  useEffect(() => {
    const box = viewport.current?.getBoundingClientRect()
    if (focusKey === '' || box === undefined || box.height === 0) return
    const drawn = (focus ?? []).flatMap((name): readonly { x: number; y: number; width: number; height: number }[] => {
      const placed = placement.nodes.find((each) => each.node.name === name)
      if (placed !== undefined) return [placed]
      const group = foldedInto(placement, name)
      return group === undefined ? [] : [group]
    })
    if (drawn.length === 0) return
    const left = Math.min(...drawn.map((each) => each.x))
    const top = Math.min(...drawn.map((each) => each.y))
    const right = Math.max(...drawn.map((each) => each.x + each.width))
    const bottom = Math.max(...drawn.map((each) => each.y + each.height))
    setView((now) => {
      const pad = 16
      const fits = (right - left) * now.zoom <= box.width - 2 * pad && (bottom - top) * now.zoom <= box.height - 2 * pad
      if (!fits) {
        const zoom = clampZoom(Math.min(now.zoom, (box.width - 2 * pad) / (right - left), (box.height - 2 * pad) / (bottom - top)))
        return {
          zoom,
          x: box.width / 2 - ((left + right) / 2) * zoom,
          y: box.height / 2 - ((top + bottom) / 2) * zoom,
        }
      }
      const shift = (low: number, high: number, size: number): number =>
        low < pad ? pad - low : high > size - pad ? size - pad - high : 0
      const dx = shift(left * now.zoom + now.x, right * now.zoom + now.x, box.width)
      const dy = shift(top * now.zoom + now.y, bottom * now.zoom + now.y, box.height)
      return dx === 0 && dy === 0 ? now : { ...now, x: now.x + dx, y: now.y + dy }
    })
    // The placement is read as it is when the window opens or the canvas resizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, tall])

  /** Everything drawn, for fitting the view to it. */
  const fit = (): void => {
    const box = viewport.current?.getBoundingClientRect()
    const drawn = [...placement.nodes, ...placement.groups.filter((each) => !each.open)]
    if (box === undefined || drawn.length === 0) return
    const left = Math.min(...drawn.map((each) => each.x))
    const top = Math.min(...drawn.map((each) => each.y))
    const right = Math.max(...drawn.map((each) => each.x + each.width))
    const bottom = Math.max(...drawn.map((each) => each.y + each.height))
    const zoom = clampZoom(Math.min(1, (box.width - 48) / (right - left), (box.height - 48) / (bottom - top)))
    setView({ zoom, x: 24 - left * zoom, y: 24 - top * zoom })
  }

  return (
    <div
      ref={viewport}
      data-canvas
      className="relative h-full w-full touch-none select-none overflow-hidden"
      style={{ cursor: pan.current !== undefined ? 'grabbing' : undefined }}
      onPointerDown={(event) => {
        // The background only: a bubble, a curve and the controls are not it.
        const target = event.target as Element
        if (event.button !== 0 || target.closest('[data-no-pan]') !== null) return
        event.currentTarget.setPointerCapture(event.pointerId)
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        const [one, two] = [...pointers.current.values()]
        if (one !== undefined && two !== undefined) {
          pan.current = undefined
          pinch.current = { view: viewNow.current, distance: Math.hypot(one.x - two.x, one.y - two.y) }
        } else {
          pan.current = { view: viewNow.current, x: event.clientX, y: event.clientY }
        }
      }}
      onPointerMove={(event) => {
        if (pointers.current.has(event.pointerId)) {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          const [one, two] = [...pointers.current.values()]
          if (pinch.current !== undefined && one !== undefined && two !== undefined) {
            const box = viewport.current?.getBoundingClientRect()
            const from = pinch.current.view
            const zoom = clampZoom(
              (from.zoom * Math.hypot(one.x - two.x, one.y - two.y)) / Math.max(1, pinch.current.distance),
            )
            const midX = (one.x + two.x) / 2 - (box?.left ?? 0)
            const midY = (one.y + two.y) / 2 - (box?.top ?? 0)
            const scale = zoom / viewNow.current.zoom
            setView((now) => ({ zoom, x: midX - (midX - now.x) * scale, y: midY - (midY - now.y) * scale }))
            return
          }
          if (pan.current !== undefined) {
            const { view: from, x, y } = pan.current
            setView({ ...from, x: from.x + event.clientX - x, y: from.y + event.clientY - y })
            return
          }
        }
        if (armedNow.current === undefined) return
        const point = pointAt(event)
        if (point === undefined) return
        setCursor(point)
        setOver(nearestPort(placement, point.x, point.y))
      }}
      onPointerUp={(event) => {
        if (pointers.current.delete(event.pointerId)) {
          pinch.current = undefined
          pan.current = undefined
          return
        }
        const held = armedNow.current
        if (held === undefined) return
        const point = pointAt(event)
        const target = point === undefined ? undefined : nearestPort(placement, point.x, point.y)
        setCursor(undefined)
        setOver(undefined)
        // A press with no move leaves the endpoint armed on purpose: that is the
        // first half of the press-then-press gesture, and undoing it here would
        // make a click do nothing at all.
        if (target === undefined || samePort(target, held)) return
        armedNow.current = undefined
        onConnect(held, target)
        onArm(undefined)
      }}
      onPointerCancel={(event) => {
        pointers.current.delete(event.pointerId)
        pinch.current = undefined
        pan.current = undefined
      }}
      onPointerLeave={() => {
        setCursor(undefined)
        setOver(undefined)
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={placement.width}
          height={placement.height}
          aria-hidden
        >
          {edges.map((edge) => {
            // Inside one folded pack, a connection has nowhere to be drawn.
            const fromGroup = foldedInto(placement, edge.from.format)
            if (fromGroup !== undefined && fromGroup === foldedInto(placement, edge.to.format)) {
              return undefined
            }
            const from = anchorOf(placement, edge.from)
            const to = anchorOf(placement, edge.to)
            if (from === undefined || to === undefined) return undefined
            const path = pathBetween(from, to)
            const key = edge.kind === 'LINK' ? `${edge.format}.${edge.column}` : `${edge.format}:${edge.figure}`
            // **The many end is the column's** (M29 F10): a link runs from its
            // column to the row it names, and a total back to that column.
            const manyEnd = edge.to.kind === 'COLUMN' ? to : from
            const oneEnd = edge.to.kind === 'COLUMN' ? from : to
            const tone = edge.dangling ? 'stroke-[var(--color-negative)]' : 'stroke-[var(--color-ink-secondary)]'
            return (
              <g key={key}>
                {/* The wide invisible stroke is the hit area. A curve is one and a
                    half pixels wide and nobody can click one. */}
                <path
                  d={path}
                  data-no-pan
                  stroke="transparent"
                  strokeWidth={14}
                  fill="none"
                  style={{ pointerEvents: 'stroke' }}
                  className="cursor-pointer"
                  onClick={() => onOpen(edge)}
                />
                <path
                  d={path}
                  fill="none"
                  strokeWidth={1.5}
                  strokeDasharray={edge.kind === 'FIGURE' ? '4 3' : undefined}
                  className={tone}
                />
                <Ends many={manyEnd} one={oneEnd} tone={tone} words={edge.kind === 'LINK'} />
              </g>
            )
          })}

          {band !== undefined && (
            <path
              d={band}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="3 3"
              className="stroke-[var(--color-accent)]"
            />
          )}

          {placement.nodes.flatMap((node) =>
            [node.row, ...node.ports].map((each) => {
              const live = armed !== undefined && samePort(armed, each.port)
              const hot = over !== undefined && samePort(over, each.port)
              if (each.port.kind === 'NEW_LINK' || each.port.kind === 'NEW_FIGURE') {
                if (!live && !hot) return undefined
              }
              const key = `${each.port.kind}:${each.port.format}:${each.x},${each.y}`
              return (
                <circle
                  key={key}
                  cx={each.x}
                  cy={each.y}
                  r={live || hot ? 5.5 : 3.5}
                  className={
                    live || hot
                      ? 'fill-[var(--color-accent)]'
                      : 'fill-[var(--color-background)] stroke-[var(--color-hairline-strong)]'
                  }
                  strokeWidth={1.5}
                />
              )
            }),
          )}
        </svg>

        {placement.groups
          .filter((group) => !group.open)
          .map((group) => (
            <Group
              key={`pack:${group.pack}`}
              group={group}
              handlers={dragHandlers('PACK', group.pack, group, () => onOpenPack(group.pack))}
              onOpen={() => onOpenPack(group.pack)}
            />
          ))}

        {placement.nodes.map((placed) => (
          <div
            key={placed.node.name}
            data-no-pan
            data-bubble={placed.node.name}
            data-found={found?.name === placed.node.name ? '' : undefined}
            className={`fc-view-enter absolute border bg-elevated ${
              found?.name === placed.node.name
                ? 'border-accent outline outline-2 outline-[var(--color-accent-soft)]'
                : 'border-hairline-strong'
            }`}
            style={{
              left: placed.x,
              top: placed.y,
              width: placed.width,
              height: placed.height,
              borderRadius: 'var(--radius-card)',
            }}
          >
            <div className="flex border-b border-hairline" style={{ height: HEAD_HEIGHT }}>
              <button
                type="button"
                aria-label={`Move ${placed.node.title}`}
                title={`Move ${placed.node.title} — drag, or the arrow keys`}
                className="flex w-6 shrink-0 cursor-grab items-center justify-center text-ink-tertiary hover:bg-surface hover:text-ink-secondary active:cursor-grabbing"
                {...dragHandlers('FORMAT', placed.node.name, placed)}
              >
                <Grip />
              </button>
              <button
                type="button"
                // The tour's anchor (M33 U2): a bubble's head, `bubble-receipt_line`.
                data-tour={`bubble-${placed.node.name}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  touch(placed.node.row.port)
                }}
                onKeyDown={(event) => onKey(event, () => touch(placed.node.row.port), onArm)}
                title={placed.node.row.says}
                className={`flex min-w-0 flex-1 items-center gap-2 pr-3 text-left ${
                  armed !== undefined && samePort(armed, placed.node.row.port)
                    ? 'bg-accent-soft'
                    : 'hover:bg-surface'
                }`}
              >
                <span className="flex min-w-0 font-medium">
                  <Bidi className="min-w-0 truncate">{placed.node.title}</Bidi>
                </span>
                <code className="ml-auto shrink-0 text-caption text-ink-tertiary">
                  {placed.node.name}
                </code>
              </button>
            </div>

            {placed.node.ports.map((port, index) => (
              <PortButton
                key={`${port.port.kind}-${port.label}-${index}`}
                port={port}
                armed={armed !== undefined && samePort(armed, port.port)}
                onTouch={() => touch(port.port)}
                onLetGo={onArm}
              />
            ))}
          </div>
        ))}
      </div>

      <div
        data-no-pan
        className="absolute bottom-3 right-3 flex items-center gap-1 border border-hairline bg-elevated px-1 py-0.5"
        style={{ borderRadius: 'var(--radius-control)' }}
      >
        <IconAction label="Zoom out" onClick={() => zoomCentre(1 / 1.2)}>
          <path d="M5 12h14" />
        </IconAction>
        <span className="w-10 text-center text-caption tabular-nums text-ink-secondary">
          {Math.round(view.zoom * 100)}%
        </span>
        <IconAction label="Zoom in" onClick={() => zoomCentre(1.2)}>
          <path d="M12 5v14M5 12h14" />
        </IconAction>
        <IconAction label="Fit everything in view" onClick={fit}>
          <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
        </IconAction>
      </div>
    </div>
  )
}

const ARROWS: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
}

/** The places as they are while something is being dragged. */
function withMove(places: readonly GraphPlace[], moving: Moving): readonly GraphPlace[] {
  const moved: GraphPlace = {
    kind: moving.kind,
    name: moving.name,
    x: moving.from.x + moving.by.x,
    y: moving.from.y + moving.by.y,
  }
  return [...places.filter((each) => each.kind !== moving.kind || each.name !== moving.name), moved]
}

/**
 * **A pack, folded** (D-269): one bubble for every format the pack declared.
 *
 * Its head is its grip — a pack's group has no endpoints to arm — so a drag
 * moves it, and a press that does not move opens it. Enter opens it too.
 */
function Group({
  group,
  handlers,
  onOpen,
}: {
  group: PlacedGroup
  handlers: DragHandlers
  onOpen: () => void
}) {
  const count = group.members.length
  return (
    <div
      data-no-pan
      data-group={group.pack}
      className="fc-view-enter absolute border border-dashed border-hairline-strong bg-surface"
      style={{
        left: group.x,
        top: group.y,
        width: group.width,
        height: group.height,
        borderRadius: 'var(--radius-card)',
      }}
    >
      <button
        type="button"
        title={`The ${group.pack} pack's formats — ${group.members.join(', ')}. Press to open, drag to move, or the arrow keys.`}
        className="flex h-full w-full cursor-grab flex-col items-start justify-center px-3 text-left hover:bg-elevated active:cursor-grabbing"
        {...handlers}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen()
            return
          }
          handlers.onKeyDown(event)
        }}
      >
        <span className="font-medium">
          <Bidi>{group.pack}</Bidi>
        </span>
        <span className="text-caption text-ink-secondary">
          {count === 1 ? '1 format inside' : `${String(count)} formats inside`} — press to open
        </span>
      </button>
    </div>
  )
}

/** Six dots: the thing a bubble is moved by. */
function Grip() {
  return (
    <svg viewBox="0 0 8 14" width="8" height="14" aria-hidden className="fill-current">
      {[2, 7, 12].flatMap((y) => [
        <circle key={`a${y}`} cx={2} cy={y} r={1.1} />,
        <circle key={`b${y}`} cx={6} cy={y} r={1.1} />,
      ])}
    </svg>
  )
}

/**
 * One endpoint, as a control.
 *
 * A quiet port — a column no connection runs through — is still an endpoint and
 * is still draggable, because making it a link is exactly what a person comes
 * here to do. What it is not is *advertised*: the two `NEW_` ports carry the
 * accent, because they are the ones whose whole job is to say the gesture
 * exists (D-125 — `accent` marks what you can act on).
 */
function PortButton({
  port,
  armed,
  onTouch,
  onLetGo,
}: {
  port: GraphPort
  armed: boolean
  onTouch: () => void
  onLetGo: (port: Port | undefined) => void
}) {
  const proposing = port.port.kind === 'NEW_LINK' || port.port.kind === 'NEW_FIGURE'
  return (
    <button
      type="button"
      // The tour's anchor (M33 U2): `has-many-receipt`, `belongs-to-receipt`.
      data-tour={
        port.port.kind === 'NEW_FIGURE'
          ? `has-many-${port.port.format}`
          : port.port.kind === 'NEW_LINK'
            ? `belongs-to-${port.port.format}`
            : undefined
      }
      onPointerDown={(event) => {
        event.preventDefault()
        onTouch()
      }}
      onKeyDown={(event) => onKey(event, onTouch, onLetGo)}
      style={{ height: PORT_HEIGHT }}
      title={port.says}
      className={`flex w-full items-center gap-2 px-3 text-left text-caption ${
        armed ? 'bg-accent-soft' : 'hover:bg-surface'
      } ${proposing ? 'text-accent' : port.edges > 0 ? 'text-ink' : 'text-ink-secondary'}`}
    >
      {port.type !== undefined && <TypeGlyph type={port.type} className="h-3.5 w-3.5 shrink-0" />}
      {port.port.kind === 'FIGURE' && <span className="shrink-0 text-ink-tertiary">Σ</span>}
      {proposing && <span className="shrink-0">+</span>}
      <span className="flex min-w-0">
        <Bidi className="min-w-0 truncate">{port.label}</Bidi>
      </span>
      {port.detail !== undefined && (
        <span className="ml-auto flex min-w-0 shrink-0 whitespace-nowrap text-ink-secondary">
          <Bidi>{port.detail}</Bidi>
        </span>
      )}
    </button>
  )
}

/**
 * **One-to-many, drawn on the line** (M29 F10): a fork where it touches the
 * many, a bar where it touches the one, and on a link the two words. A total's
 * dashed line carries the same marks and leaves the words to the link it runs
 * along, which already says them.
 */
function Ends({
  many,
  one,
  tone,
  words,
}: {
  many: PlacedPort
  one: PlacedPort
  tone: string
  words: boolean
}) {
  const out = (end: PlacedPort): number => (end.side === 'RIGHT' ? 1 : -1)
  const m = out(many)
  const o = out(one)
  return (
    <>
      <path
        d={`M ${many.x} ${many.y - 6.5} L ${many.x + m * 10} ${many.y} L ${many.x} ${many.y + 6.5} M ${many.x + m * 10} ${many.y} H ${many.x}`}
        fill="none"
        strokeWidth={1.5}
        className={tone}
      />
      <path d={`M ${one.x + o * 7} ${one.y - 6} V ${one.y + 6}`} fill="none" strokeWidth={1.5} className={tone} />
      {words && (
        <>
          <text
            x={many.x + m * 12}
            y={many.y - 7}
            textAnchor={m > 0 ? 'start' : 'end'}
            className="fill-[var(--color-ink-secondary)] text-[10px] font-medium"
          >
            many
          </text>
          <text
            x={one.x + o * 12}
            y={one.y - 7}
            textAnchor={o > 0 ? 'start' : 'end'}
            className="fill-[var(--color-ink-secondary)] text-[10px] font-medium"
          >
            one
          </text>
        </>
      )}
    </>
  )
}

/**
 * Enter and Space are the press; Escape lets go.
 *
 * Handled rather than left to the browser's own activation, for the reason
 * D-232 records: the harness a session drives this with delivers the keydown
 * and synthesizes no click, so a control that relied on the default would have
 * shipped on the argument that it *ought* to work.
 */
function onKey(
  event: ReactKeyboardEvent,
  touch: () => void,
  letGo: (port: Port | undefined) => void,
): void {
  if (event.key === 'Enter' || event.key === ' ') {
    // Space on a button scrolls the page and then clicks it. Neither is wanted:
    // the press has already been handled here.
    event.preventDefault()
    touch()
    return
  }
  if (event.key === 'Escape') letGo(undefined)
}
