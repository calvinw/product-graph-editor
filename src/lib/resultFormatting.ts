import { impactCategoryAbbreviation } from "./lcaApi"
import { chemicalFlowLabel } from "./flowLabels"

export type ImpactYaml = {
  processes?: Array<{
    name: string
    emissions?: Array<{ flow: string; amount: number; unit?: string }>
    extractions?: Array<{ flow: string; amount: number; unit?: string }>
    resources?: Array<{ flow: string; amount: number; unit?: string }>
    resource_inputs?: Array<{ flow: string; amount: number; unit?: string }>
  }>
}

export const productGraphLabel = (name: string) => name.replace(/\s+—\s+1\s+.*$/, "")

export const isInventoryInput = (type: string) => /resource|extraction|input/i.test(type)

export const inventoryFlowName = (name: string) => {
  const base = name.split(/[|,]/)[0].trim()
  const symbol = chemicalFlowLabel(base)
    .replaceAll("₂", "2")
    .replaceAll("₃", "3")
    .replaceAll("₄", "4")
    .replaceAll("ₓ", "x")
  return symbol === base ? name : `${name} (${symbol})`
}

export const cleanImpactProcessName = (name: string) => name.replace(/^(?:p?\d+)\s*[:.\-–—]\s*/i, "").trim()

export const normalizedFlow = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()

export const impactFactor = (category: string, flow: string) => {
  const indicator = impactCategoryAbbreviation(category).toUpperCase()
  const normalizedCategory = normalizedFlow(category)
  const normalized = normalizedFlow(flow)
  const isGlobalWarming = /^GWP(?:\d+)?$/.test(indicator) || /global warming|climate change/.test(normalizedCategory)
  if (isGlobalWarming) {
    if (/carbon dioxide|\bco2\b/.test(normalized)) return 1
    if (/methane|\bch4\b/.test(normalized)) return 25
  }
  if (indicator === "EP" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 0.04429
  if (indicator === "AP" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 0.7
  if (indicator === "PMFP" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 0.00722
  if (indicator === "MIR" && /nitrogen oxides?|\bnox\b/.test(normalized)) return 24.79359
  return null
}
