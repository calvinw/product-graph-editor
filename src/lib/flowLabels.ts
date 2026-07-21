const chemicalSymbols: Record<string, string> = {
  "aluminium": "Al",
  "ammonia": "NH₃",
  "carbon dioxide": "CO₂",
  "carbon monoxide": "CO",
  "chromium": "Cr",
  "copper": "Cu",
  "dinitrogen monoxide": "N₂O",
  "hydrogen": "H₂",
  "iron": "Fe",
  "lead": "Pb",
  "methane": "CH₄",
  "nickel": "Ni",
  "nitrogen": "N₂",
  "nitrogen oxides": "NOₓ",
  "nitrous oxide": "N₂O",
  "oxygen": "O₂",
  "sulfur dioxide": "SO₂",
  "sulphur dioxide": "SO₂",
  "water": "H₂O",
  "zinc": "Zn",
}

export function chemicalFlowLabel(name: string) {
  const [base, ...qualifierParts] = name.split(",")
  const symbol = chemicalSymbols[base.trim().toLowerCase()]
  if (!symbol) return name
  const qualifier = qualifierParts.join(",").trim()
  return qualifier ? `${symbol} (${qualifier})` : symbol
}
