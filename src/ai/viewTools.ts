import type { ProductGraphView } from "@/state/productGraphStore"

export type ViewAvailability = {
  id: ProductGraphView
  label: string
  description: string
  available: boolean
  unavailableReason?: string
}

export type ViewToolCall = {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export type ViewToolDefinition = {
  type: "function"
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export type SwitchViewOutcome = {
  status: "completed" | "confirmation_required"
  view: ProductGraphView
  label: string
  reason?: string
}

const RESULT_REQUIRED_REASON = "Calculate the current model before opening this analysis view."

const VIEW_DEFINITIONS: ReadonlyArray<Omit<ViewAvailability, "available" | "unavailableReason"> & { requiresResults?: boolean }> = [
  { id: "graph", label: "Graph", description: "The interactive product graph." },
  { id: "yaml", label: "Edit", description: "The product graph YAML editor." },
  { id: "results", label: "LCA results", description: "The current model's LCA report and calculation status." },
  { id: "inventory", label: "Inventory", description: "Life-cycle inventory inputs and outputs.", requiresResults: true },
  { id: "impact", label: "Impact analysis", description: "Impact-category analysis for current results.", requiresResults: true },
  { id: "process", label: "Process results", description: "Process-level inventory and impact results.", requiresResults: true },
  { id: "contribution", label: "Contributions", description: "Contribution analysis for current results.", requiresResults: true },
  { id: "sankey", label: "Sankey", description: "Sankey visualization for current results.", requiresResults: true },
]

export const viewToolDefinitions: ViewToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "list_views",
      description: "List Product Graph Editor views and whether each one is currently available.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "get_active_view",
      description: "Get the Product Graph Editor view that is currently open.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "switch_view",
      description: "Switch to an available Product Graph Editor view.",
      parameters: {
        type: "object",
        properties: {
          view: {
            type: "string",
            enum: VIEW_DEFINITIONS.map((view) => view.id),
            description: "The registered view to open.",
          },
        },
        required: ["view"],
        additionalProperties: false,
      },
    },
  },
]

export function listViews(hasCurrentResults: boolean): ViewAvailability[] {
  return VIEW_DEFINITIONS.map(({ requiresResults, ...view }) => ({
    ...view,
    available: !requiresResults || hasCurrentResults,
    ...requiresResults && !hasCurrentResults ? { unavailableReason: RESULT_REQUIRED_REASON } : {},
  }))
}

export function getView(viewId: ProductGraphView, hasCurrentResults: boolean) {
  return listViews(hasCurrentResults).find((view) => view.id === viewId)
}

function parseArguments(call: ViewToolCall) {
  const value = JSON.parse(call.function.arguments || "{}") as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Arguments for ${call.function.name} must be an object.`)
  }
  return value as Record<string, unknown>
}

export async function executeViewTool({
  call,
  activeView,
  hasCurrentResults,
  switchView,
}: {
  call: ViewToolCall
  activeView: ProductGraphView
  hasCurrentResults: boolean
  switchView(view: ProductGraphView): SwitchViewOutcome | Promise<SwitchViewOutcome>
}) {
  const args = parseArguments(call)
  if (call.function.name === "list_views") {
    if (Object.keys(args).length) throw new Error("list_views does not accept arguments.")
    return { activeView, views: listViews(hasCurrentResults) }
  }
  if (call.function.name === "get_active_view") {
    if (Object.keys(args).length) throw new Error("get_active_view does not accept arguments.")
    return getView(activeView, hasCurrentResults)
  }
  if (call.function.name !== "switch_view") throw new Error(`Unknown tool: ${call.function.name}`)
  if (typeof args.view !== "string" || !VIEW_DEFINITIONS.some((view) => view.id === args.view)) {
    throw new Error("switch_view requires a registered view identifier.")
  }
  const view = getView(args.view as ProductGraphView, hasCurrentResults)
  if (!view) throw new Error(`Unknown view: ${args.view}`)
  if (!view.available) return { status: "unavailable", view: view.id, label: view.label, reason: view.unavailableReason }
  return switchView(view.id)
}

