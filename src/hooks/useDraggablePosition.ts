import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

/**
 * Distance of the panel from its anchored viewport edge, and from the top.
 * Left-anchored panels (the toolbars) store `{ left, top }`; right-anchored
 * panels (the property editor, which resizes from its left edge and so must
 * keep its right edge still) store `{ right, top }`.
 */
type Anchor = "left" | "right"
type Offset = { offset: number; top: number }
export type DraggedPosition = { left?: number; right?: number; top: number }

/** Keeps at least this much of the panel inside every viewport edge. */
const EDGE_MARGIN = 8

function storedPosition(key: string, anchor: Anchor): Offset | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Record<Anchor | "top", number>>
    const offset = parsed[anchor]
    return typeof offset === "number" && typeof parsed.top === "number" ? { offset, top: parsed.top } : null
  } catch { return null }
}

function persistPosition(key: string, anchor: Anchor, position: Offset) {
  try { localStorage.setItem(key, JSON.stringify({ [anchor]: position.offset, top: position.top })) } catch { /* Optional preference. */ }
}

type Bounds = { left: number; top: number; right: number; bottom: number }

const viewportBounds = (): Bounds => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight })

/**
 * Confines a panel of the given size to `bounds` (the viewport unless the
 * panel has a container, such as the graph canvas). The upper limits floor at
 * the lower ones so a panel larger than its bounds still starts inside them
 * rather than being pushed off the opposite edge.
 */
function clampToBounds({ offset, top }: Offset, width: number, height: number, anchor: Anchor, bounds: Bounds): Offset {
  const left = anchor === "left" ? offset : window.innerWidth - offset - width
  const minLeft = bounds.left + EDGE_MARGIN
  const maxLeft = Math.max(minLeft, bounds.right - width - EDGE_MARGIN)
  const minTop = bounds.top + EDGE_MARGIN
  const maxTop = Math.max(minTop, bounds.bottom - height - EDGE_MARGIN)
  const clampedLeft = Math.min(Math.max(minLeft, left), maxLeft)
  return {
    offset: anchor === "left" ? clampedLeft : window.innerWidth - clampedLeft - width,
    top: Math.min(Math.max(minTop, top), maxTop),
  }
}

/**
 * Lets an absolutely-positioned floating panel be dragged by a handle.
 * Returns null until the user actually drags it once, so the panel keeps
 * following its CSS (including responsive breakpoint) position by default.
 *
 * A restored position is re-confined to the viewport on mount and on resize:
 * coordinates saved on a large window would otherwise strand the panel
 * off-screen on a smaller one, where its own drag handle is unreachable.
 * Attach the returned `panelRef` to the panel so its real size can be measured.
 */
export function useDraggablePosition<T extends HTMLElement = HTMLDivElement>(
  storageKey: string,
  { anchor = "left", container, topLimit }: {
    anchor?: Anchor
    /** Keep the panel inside this element (e.g. the graph canvas) rather than the viewport. */
    container?: () => HTMLElement | null
    /** Let the panel rise above the container's top, up to this viewport y (e.g. the navbar's bottom). */
    topLimit?: () => number | null
  } = {},
) {
  const [stored, setStored] = useState<Offset | null>(() => storedPosition(storageKey, anchor))
  const panelRef = useRef<T | null>(null)
  const storedRef = useRef(stored)
  storedRef.current = stored

  const containerRef = useRef(container)
  containerRef.current = container
  const topLimitRef = useRef(topLimit)
  topLimitRef.current = topLimit
  const bounds = useCallback((): Bounds => {
    const element = containerRef.current?.()
    const rect = element ? element.getBoundingClientRect() : viewportBounds()
    const top = topLimitRef.current?.() ?? rect.top
    return { left: rect.left, top: Math.min(top, rect.top), right: rect.right, bottom: rect.bottom }
  }, [])

  const reconcile = useCallback(() => {
    const current = storedRef.current
    const panel = panelRef.current
    if (!current || !panel) return
    const next = clampToBounds(current, panel.offsetWidth, panel.offsetHeight, anchor, bounds())
    if (next.offset === current.offset && next.top === current.top) return
    storedRef.current = next
    setStored(next)
    persistPosition(storageKey, anchor, next)
  }, [anchor, bounds, storageKey])

  // Layout effect so a stranded panel is corrected before it can be painted.
  useLayoutEffect(reconcile, [reconcile])

  // Re-confine when the window or the container changes size -- the canvas
  // narrows when the chat opens, which could otherwise leave the panel outside.
  useEffect(() => {
    window.addEventListener("resize", reconcile)
    const element = containerRef.current?.()
    const observer = element ? new ResizeObserver(() => reconcile()) : null
    if (element) observer!.observe(element)
    return () => {
      window.removeEventListener("resize", reconcile)
      observer?.disconnect()
    }
  }, [reconcile])

  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const panel = event.currentTarget.closest<HTMLElement>("[data-draggable-panel]")
    if (!panel) return
    event.preventDefault()
    const rect = panel.getBoundingClientRect()
    const grabX = event.clientX - rect.left
    const grabY = event.clientY - rect.top
    const offsetFor = (left: number) => anchor === "left" ? left : window.innerWidth - left - rect.width
    let next: Offset = { offset: offsetFor(rect.left), top: rect.top }
    const move = (moveEvent: PointerEvent) => {
      // Measure live: a panel can change size once it starts floating.
      next = clampToBounds(
        { offset: offsetFor(moveEvent.clientX - grabX), top: moveEvent.clientY - grabY },
        panel.offsetWidth,
        panel.offsetHeight,
        anchor,
        bounds(),
      )
      setStored(next)
    }
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      persistPosition(storageKey, anchor, next)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish, { once: true })
  }, [anchor, bounds, storageKey])

  /** Forget the dragged position so the panel returns to its CSS default. */
  const reset = useCallback(() => {
    storedRef.current = null
    setStored(null)
    try { localStorage.removeItem(storageKey) } catch { /* Optional preference. */ }
  }, [storageKey])

  const position: DraggedPosition | null = stored ? { [anchor]: stored.offset, top: stored.top } : null
  return { position, startDrag, reset, panelRef }
}
