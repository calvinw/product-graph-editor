import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

type Theme = "dark" | "light"

type DisplaySettings = {
  decimalPlaces: number
  setDecimalPlaces: (value: number) => void
  showAllDecimalPlaces: boolean
  setShowAllDecimalPlaces: (value: boolean) => void
  theme: Theme
  setTheme: (value: Theme) => void
  formatNumber: (value: number) => string
  formatPercent: (value: number) => string
}

const DisplaySettingsContext = createContext<DisplaySettings | null>(null)

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [decimalPlaces, setDecimalPlacesState] = useState(6)
  const [showAllDecimalPlaces, setShowAllDecimalPlaces] = useState(false)
  const [theme, setTheme] = useState<Theme>("dark")
  const setDecimalPlaces = (value: number) => setDecimalPlacesState(Math.min(8, Math.max(0, Math.floor(value))))
  const formatter = useMemo(() => new Intl.NumberFormat("en", {
    minimumFractionDigits: showAllDecimalPlaces ? 0 : decimalPlaces,
    maximumFractionDigits: showAllDecimalPlaces ? 20 : decimalPlaces,
  }), [decimalPlaces, showAllDecimalPlaces])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  const value = useMemo(() => ({
    decimalPlaces,
    setDecimalPlaces,
    showAllDecimalPlaces,
    setShowAllDecimalPlaces,
    theme,
    setTheme,
    formatNumber: (number: number) => formatter.format(number),
    formatPercent: (number: number) => `${formatter.format(number)}%`,
  }), [decimalPlaces, formatter, showAllDecimalPlaces, theme])

  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>
}

// The provider and its hook belong together; the fast-refresh cost is a full
// reload of this file only.
// eslint-disable-next-line react-refresh/only-export-components
export function useDisplaySettings() {
  const settings = useContext(DisplaySettingsContext)
  if (!settings) throw new Error("Display settings must be used inside DisplaySettingsProvider.")
  return settings
}
