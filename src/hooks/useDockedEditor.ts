import { useEffect, useState } from "react"

const DOCKED_QUERY = "(min-width: 901px)"

/**
 * At desktop widths the property editor is docked on the right of the graph and
 * always shown; narrower layouts keep the overlay that opens on a click (#80).
 */
export function useDockedEditor() {
  const [docked, setDocked] = useState(() => window.matchMedia(DOCKED_QUERY).matches)
  useEffect(() => {
    const query = window.matchMedia(DOCKED_QUERY)
    const update = () => setDocked(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return docked
}
