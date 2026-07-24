import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

type Theme = "dark" | "light"

type DisplaySettings = {
  decimalPlaces: number
  setDecimalPlaces: (value: number) => void
  theme: Theme
  setTheme: (value: Theme) => void
  formatNumber: (value: number) => string
  formatPercent: (value: number) => string
}

const DisplaySettingsContext = createContext<DisplaySettings | null>(null)

export function DisplaySettingsProvider({ children }: { children: ReactNode }) {
  const [decimalPlaces, setDecimalPlacesState] = useState(2)
  const [theme, setTheme] = useState<Theme>("dark")
  const setDecimalPlaces = (value: number) => setDecimalPlacesState(Math.min(8, Math.max(0, Math.floor(value))))
  const formatter = useMemo(() => new Intl.NumberFormat("en", {
    minimumFractionDigits: decimalPlaces,
    maximumFractionDigits: decimalPlaces,
  }), [decimalPlaces])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  const value = useMemo(() => ({
    decimalPlaces,
    setDecimalPlaces,
    theme,
    setTheme,
    formatNumber: (number: number) => formatter.format(number),
    formatPercent: (number: number) => `${formatter.format(number)}%`,
  }), [decimalPlaces, formatter, theme])

  return <DisplaySettingsContext.Provider value={value}>{children}</DisplaySettingsContext.Provider>
}

export function useDisplaySettings() {
  const settings = useContext(DisplaySettingsContext)
  if (!settings) throw new Error("Display settings must be used inside DisplaySettingsProvider.")
  return settings
}
