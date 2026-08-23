import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"

type Position = { left: number; top: number }

/** Keeps at least this much of the panel inside every viewport edge. */
const EDGE_MARGIN = 8

function storedPosition(key: string): Position | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Position>
    return typeof parsed.left === "number" && typeof parsed.top === "number" ? { left: parsed.left, top: parsed.top } : null
  } catch { return null }
}

function persistPosition(key: string, position: Position) {
  try { localStorage.setItem(key, JSON.stringify(position)) } catch { /* Optional preference. */ }
}

/**
 * Confines a panel of the given size to the current viewport. The upper bounds
 * floor at EDGE_MARGIN so a panel larger than the viewport still starts on
 * screen rather than being pushed off the opposite edge.
 */
function clampToViewport({ left, top }: Position, width: number, height: number): Position {
  const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN)
  const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN)
  return {
    left: Math.min(Math.max(EDGE_MARGIN, left), maxLeft),
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
export function useDraggablePosition(storageKey: string) {
  const [position, setPosition] = useState<Position | null>(() => storedPosition(storageKey))
  const panelRef = useRef<HTMLDivElement | null>(null)
  const positionRef = useRef(position)
  positionRef.current = position

  const reconcile = useCallback(() => {
    const current = positionRef.current
    const panel = panelRef.current
    if (!current || !panel) return
    const next = clampToViewport(current, panel.offsetWidth, panel.offsetHeight)
    if (next.left === current.left && next.top === current.top) return
    positionRef.current = next
    setPosition(next)
    persistPosition(storageKey, next)
  }, [storageKey])

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
    const offsetX = event.clientX - rect.left
    const offsetY = event.clientY - rect.top
    let next: Position = { left: rect.left, top: rect.top }
    const move = (moveEvent: PointerEvent) => {
      next = clampToViewport(
        { left: moveEvent.clientX - offsetX, top: moveEvent.clientY - offsetY },
        rect.width,
        rect.height,
      )
      setPosition(next)
    }
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      persistPosition(storageKey, next)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish, { once: true })
  }, [storageKey])

  return { position, startDrag, panelRef }
}
