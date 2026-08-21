import { useCallback, useState, type PointerEvent as ReactPointerEvent } from "react"

type Position = { left: number; top: number }

function storedPosition(key: string): Position | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Position>
    return typeof parsed.left === "number" && typeof parsed.top === "number" ? { left: parsed.left, top: parsed.top } : null
  } catch { return null }
}

/**
 * Lets an absolutely-positioned floating panel be dragged by a handle.
 * Returns null until the user actually drags it once, so the panel keeps
 * following its CSS (including responsive breakpoint) position by default.
 */
export function useDraggablePosition(storageKey: string) {
  const [position, setPosition] = useState<Position | null>(() => storedPosition(storageKey))

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
      const maxLeft = Math.max(8, window.innerWidth - rect.width - 8)
      const maxTop = Math.max(8, window.innerHeight - rect.height - 8)
      next = {
        left: Math.min(Math.max(8, moveEvent.clientX - offsetX), maxLeft),
        top: Math.min(Math.max(8, moveEvent.clientY - offsetY), maxTop),
      }
      setPosition(next)
    }
    const finish = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
      try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* Optional preference. */ }
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish, { once: true })
  }, [storageKey])

  return { position, startDrag }
}
