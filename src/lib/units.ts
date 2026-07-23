const unitAliases: Record<string, string> = {
  kg: "kilogram",
  kilogram: "kilogram",
  kilograms: "kilogram",
}

const canonicalUnit = (unit: string | undefined) => {
  const normalized = unit?.trim().toLowerCase() ?? ""
  return unitAliases[normalized] ?? normalized
}

export const unitsAreCompatible = (left: string | undefined, right: string | undefined) => (
  Boolean(left && right) && canonicalUnit(left) === canonicalUnit(right)
)
