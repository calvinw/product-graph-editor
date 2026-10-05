import { useEffect, useState, type RefObject } from "react"

/**
 * Drag handle on the right edge of the left-hand rail.
 *
 * The scenario panel and the property editor share one width, because two
 * docked panels of different widths would read as a mistake. The width is
 * published as the --rail-width CSS variable, so the canvas inset follows
 * without a re-render, and it is remembered across reloads.
 */
const RAIL_WIDTH_STORAGE = "product-graph-editor:rail-width"
export const RAIL_DEFAULT = 286
export const RAIL_MIN = 240
/** Canvas width kept free however wide the rail is dragged. */
const CANVAS_MIN = 320
const KEYBOARD_STEP = 20

const railMaximum = () => Math.max(RAIL_MIN, window.innerWidth - CANVAS_MIN)
const clampRailWidth = (width: number) => Math.min(railMaximum(), Math.max(RAIL_MIN, width))

function storedRailWidth() {
  try {
    const value = Number(localStorage.getItem(RAIL_WIDTH_STORAGE))
    return Number.isFinite(value) && value >= RAIL_MIN ? value : RAIL_DEFAULT
  } catch { return RAIL_DEFAULT }
}

function applyRailWidth(width: number) {
  document.documentElement.style.setProperty("--rail-width", `${Math.round(width)}px`)
}

function storeRailWidth(width: number) {
  try { localStorage.setItem(RAIL_WIDTH_STORAGE, String(Math.round(width))) } catch { /* Optional preference. */ }
}

export function RailResizeHandle({ panelRef, label }: { panelRef: RefObject<HTMLElement | null>; label: string }) {
  const [width, setWidth] = useState(storedRailWidth)

  useEffect(() => { applyRailWidth(clampRailWidth(storedRailWidth())) }, [])

  const update = (next: number) => {
    const clamped = clampRailWidth(next)
    applyRailWidth(clamped)
    setWidth(Math.round(clamped))
    return clamped
  }

  const startResize = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelRef.current?.offsetWidth ?? RAIL_DEFAULT
    let next = startWidth
    // The rail is on the left and resizes from its right edge.
    const resize = (moveEvent: PointerEvent) => { next = update(startWidth + moveEvent.clientX - startX) }
    const finish = () => {
      window.removeEventListener("pointermove", resize)
      window.removeEventListener("pointerup", finish)
      document.body.classList.remove("is-resizing-rail")
      storeRailWidth(next)
    }
    document.body.classList.add("is-resizing-rail")
    window.addEventListener("pointermove", resize)
    window.addEventListener("pointerup", finish, { once: true })
  }

  const resizeByKeyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = panelRef.current?.offsetWidth ?? RAIL_DEFAULT
    const targets: Record<string, number> = {
      ArrowRight: current + KEYBOARD_STEP,
      ArrowLeft: current - KEYBOARD_STEP,
      Home: RAIL_MIN,
      End: railMaximum(),
    }
    if (!(event.key in targets)) return
    event.preventDefault()
    storeRailWidth(update(targets[event.key]))
  }

  const reset = () => storeRailWidth(update(RAIL_DEFAULT))

  return <button
    type="button"
    className="rail-resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label={label}
    aria-valuemin={RAIL_MIN}
    aria-valuemax={railMaximum()}
    aria-valuenow={width}
    title="Drag to resize. Double-click to reset."
    onPointerDown={startResize}
    onKeyDown={resizeByKeyboard}
    onDoubleClick={reset}
  />
}
