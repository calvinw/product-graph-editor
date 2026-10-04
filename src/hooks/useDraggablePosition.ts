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

/**
 * Confines a panel of the given size to the current viewport. The upper bounds
 * floor at EDGE_MARGIN so a panel larger than the viewport still starts on
 * screen rather than being pushed off the opposite edge.
 */
function clampToViewport({ offset, top }: Offset, width: number, height: number): Offset {
  const maxOffset = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN)
  const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN)
  return {
    offset: Math.min(Math.max(EDGE_MARGIN, offset), maxOffset),
    top: Math.min(Math.max(EDGE_MARGIN, top), maxTop),
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
export function useDraggablePosition<T extends HTMLElement = HTMLDivElement>(storageKey: string, { anchor = "left" }: { anchor?: Anchor } = {}) {
  const [stored, setStored] = useState<Offset | null>(() => storedPosition(storageKey, anchor))
  const panelRef = useRef<T | null>(null)
  const storedRef = useRef(stored)
  storedRef.current = stored

  const reconcile = useCallback(() => {
    const current = storedRef.current
    const panel = panelRef.current
    if (!current || !panel) return
    const next = clampToViewport(current, panel.offsetWidth, panel.offsetHeight)
    if (next.offset === current.offset && next.top === current.top) return
    storedRef.current = next
    setStored(next)
    persistPosition(storageKey, anchor, next)
  }, [anchor, storageKey])

  // Layout effect so a stranded panel is corrected before it can be painted.
  useLayoutEffect(reconcile, [reconcile])

  useEffect(() => {
    window.addEventListener("resize", reconcile)
    return () => window.removeEventListener("resize", reconcile)
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
      next = clampToViewport(
        { offset: offsetFor(moveEvent.clientX - grabX), top: moveEvent.clientY - grabY },
        panel.offsetWidth,
        panel.offsetHeight,
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
  }, [anchor, storageKey])

  const position: DraggedPosition | null = stored ? { [anchor]: stored.offset, top: stored.top } : null
  return { position, startDrag, panelRef }
}
