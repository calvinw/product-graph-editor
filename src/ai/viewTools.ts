import type { ActiveDocument, SessionDocument } from "@/lib/modelWorkspace"
import type { LcaResult, ProductGraphTemplate } from "@/lib/lcaApi"
import { buildGraphFromYaml } from "@/lib/yamlGraph"
import { parse } from "yaml"
import type {
  GraphConnectionStyle, GraphMode, GraphOrientation, ProductGraphView, SelectedGraphNode,
} from "@/state/productGraphStore"

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

export type GraphToolNode = SelectedGraphNode & {
  inputCount: number
  outputCount: number
  emissionCount: number
  extractionCount: number
  biosphereCount: number
}

export type AppToolRuntime = {
  activeView: ProductGraphView
  hasCurrentResults: boolean
  workspace: {
    activeDocument: ActiveDocument | null
    sessionDocuments: SessionDocument[]
    yamlDirty: boolean
    yamlValid: boolean
    appliedRevision: number
    calculatedRevision: number | null
    calculationStatus: "idle" | "calculating" | "error" | "complete"
    calculationError: string
    contributionLoading: boolean
    yamlDraft: string
  }
  templates: ProductGraphTemplate[]
  result: LcaResult | null
  graph: {
    nodes: GraphToolNode[]
    connectionCount: number
    mode: GraphMode
    orientation: GraphOrientation
    connectionStyle: GraphConnectionStyle
    showReferenceAmounts: boolean
    maximumProcesses: number
    selectedNodeId: string | null
  }
  actions: {
    switchView(view: ProductGraphView): SwitchViewOutcome
    selectNode(nodeId: string): void
    clearNodeSelection(): void
    setGraphDisplay(settings: {
      mode?: GraphMode
      orientation?: GraphOrientation
      connections?: GraphConnectionStyle
      showReferenceAmounts?: boolean
      maximumProcesses?: number
    }): void
    fitGraph(): void
    calculateCurrentModel(): void
    saveCurrentModel(): boolean
    saveModelAs(name: string): boolean
    openModel(kind: "template" | "session", id: string): void
    newModel(): void
    downloadYaml(): void
    exportResults(format: "json" | "markdown"): void
    deleteSessionModel(id: string): void
  }
}

export const confirmedToolNames = new Set([
  "calculate_current_model",
  "save_current_model",
  "save_model_as",
  "open_model",
  "new_model",
  "download_yaml",
  "export_results",
  "delete_session_model",
])

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
  { id: "realtime", label: "Realtime", description: "Live scenario preview for background inputs.", requiresResults: true },
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

const noArguments = { type: "object", properties: {}, additionalProperties: false }
const boundedLimit = { type: "integer", minimum: 1, maximum: 25, default: 10 }

export const appToolDefinitions: ViewToolDefinition[] = [
  ...viewToolDefinitions,
  { type: "function", function: { name: "get_workspace_status", description: "Get bounded status for the active model workspace without reading YAML contents.", parameters: noArguments } },
  { type: "function", function: { name: "get_calculation_status", description: "Get current LCA calculation and result availability status.", parameters: noArguments } },
  { type: "function", function: { name: "list_session_models", description: "List browser-session models without returning their YAML contents.", parameters: noArguments } },
  { type: "function", function: { name: "list_model_templates", description: "List available product-graph templates without returning their YAML contents.", parameters: noArguments } },
  { type: "function", function: { name: "get_graph_summary", description: "Get bounded metadata about the displayed product graph.", parameters: noArguments } },
  {
    type: "function",
    function: {
      name: "find_graph_nodes",
      description: "Find displayed graph nodes by label, kind, scope, or short description.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", minLength: 1 }, limit: boundedLimit },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_graph_node_summary",
      description: "Get a bounded summary for one displayed graph node.",
      parameters: {
        type: "object",
        properties: { nodeId: { type: "string", minLength: 1 } },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "select_graph_node",
      description: "Select one displayed graph node and open its inspector.",
      parameters: {
        type: "object",
        properties: { nodeId: { type: "string", minLength: 1 } },
        required: ["nodeId"],
        additionalProperties: false,
      },
    },
  },
  { type: "function", function: { name: "clear_graph_selection", description: "Clear the selected graph node.", parameters: noArguments } },
  {
    type: "function",
    function: {
      name: "set_graph_display",
      description: "Change one or more registered graph presentation settings.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["structure", "scaled"] },
          orientation: { type: "string", enum: ["horizontal", "vertical"] },
          connections: { type: "string", enum: ["curved", "straight", "step"] },
          showReferenceAmounts: { type: "boolean" },
          maximumProcesses: { type: "integer", minimum: 1, maximum: 1000 },
        },
        additionalProperties: false,
      },
    },
  },
  { type: "function", function: { name: "fit_graph_view", description: "Fit the displayed graph inside its viewport.", parameters: noArguments } },
  { type: "function", function: { name: "list_impact_categories", description: "List impact categories available in the current LCA result.", parameters: noArguments } },
  {
    type: "function",
    function: {
      name: "get_lca_summary",
      description: "Get a bounded summary of the current LCA result, optionally filtered by impact category.",
      parameters: {
        type: "object",
        properties: {
          categories: { type: "array", maxItems: 25, items: { type: "string", minLength: 1 } },
          limit: boundedLimit,
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inventory_summary",
      description: "Get a bounded list of the largest inventory inputs or outputs by absolute amount.",
      parameters: {
        type: "object",
        properties: { direction: { type: "string", enum: ["input", "output"] }, limit: boundedLimit },
        required: ["direction"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_process_results_summary",
      description: "Get bounded impact results for one process ID in the current result.",
      parameters: {
        type: "object",
        properties: { processId: { type: "string", minLength: 1 }, limit: boundedLimit },
        required: ["processId"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_contributors",
      description: "Get bounded top process contributors for one impact category.",
      parameters: {
        type: "object",
        properties: {
          impactCategory: { type: "string", minLength: 1 },
          scope: { type: "string", enum: ["all", "foreground", "background"], default: "all" },
          limit: boundedLimit,
        },
        required: ["impactCategory"],
        additionalProperties: false,
      },
    },
  },
  { type: "function", function: { name: "validate_yaml_draft", description: "Validate the current YAML draft and return bounded structural errors without returning its contents.", parameters: noArguments } },
  { type: "function", function: { name: "get_yaml_outline", description: "Get a bounded structural outline of the current YAML draft without returning the complete document.", parameters: noArguments } },
  { type: "function", function: { name: "calculate_current_model", description: "Calculate the currently applied model after explicit user confirmation.", parameters: noArguments } },
  { type: "function", function: { name: "save_current_model", description: "Save changes to the active writable session model after explicit user confirmation.", parameters: noArguments } },
  {
    type: "function",
    function: {
      name: "save_model_as",
      description: "Save the current valid YAML draft as a new browser-session model after explicit user confirmation.",
      parameters: { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 120 } }, required: ["name"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "open_model",
      description: "Open a registered template or browser-session model after explicit user confirmation.",
      parameters: {
        type: "object",
        properties: { kind: { type: "string", enum: ["template", "session"] }, id: { type: "string", minLength: 1 } },
        required: ["kind", "id"],
        additionalProperties: false,
      },
    },
  },
  { type: "function", function: { name: "new_model", description: "Start a new blank model after explicit user confirmation.", parameters: noArguments } },
  { type: "function", function: { name: "download_yaml", description: "Download the current YAML draft after explicit user confirmation.", parameters: noArguments } },
  {
    type: "function",
    function: {
      name: "export_results",
      description: "Export current LCA results in a registered format after explicit user confirmation.",
      parameters: { type: "object", properties: { format: { type: "string", enum: ["json", "markdown"] } }, required: ["format"], additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_session_model",
      description: "Delete one inactive browser-session model after explicit user confirmation.",
      parameters: { type: "object", properties: { id: { type: "string", minLength: 1 } }, required: ["id"], additionalProperties: false },
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

export function confirmationSummary(call: ViewToolCall, runtime: AppToolRuntime) {
  const args = parseArguments(call)
  switch (call.function.name) {
    case "calculate_current_model": return `Calculate the applied revision of ${runtime.workspace.activeDocument?.title ?? "the current model"}?`
    case "save_current_model": return `Save changes to ${runtime.workspace.activeDocument?.title ?? "the current model"}?`
    case "save_model_as": return `Save the current draft as “${String(args.name ?? "").trim()}”?`
    case "open_model": return `Open the ${String(args.kind ?? "model")} “${String(args.id ?? "")}"? Unsaved-work protections will still apply.`
    case "new_model": return "Start a new blank model? Unsaved-work protections will still apply."
    case "download_yaml": return `Download ${runtime.workspace.activeDocument?.filename ?? "the current YAML draft"}?`
    case "export_results": return `Export the current LCA results as ${String(args.format ?? "the requested format")}?`
    case "delete_session_model": return `Permanently delete the browser-session model “${String(args.id ?? "")}"?`
    default: return `Run ${call.function.name}?`
  }
}

function requireNoArguments(name: string, args: Record<string, unknown>) {
  if (Object.keys(args).length) throw new Error(`${name} does not accept arguments.`)
}

function nodeFor(runtime: AppToolRuntime, value: unknown) {
  if (typeof value !== "string" || !value) throw new Error("A non-empty nodeId is required.")
  const node = runtime.graph.nodes.find((candidate) => candidate.id === value)
  if (!node) throw new Error(`Displayed graph node not found: ${value}`)
  return node
}

function boundedNode(node: GraphToolNode) {
  return {
    id: node.id,
    label: node.label,
    kind: node.kind,
    detail: node.detail,
    scope: node.scope,
    inputCount: node.inputCount,
    outputCount: node.outputCount,
    emissionCount: node.emissionCount,
    extractionCount: node.extractionCount,
    biosphereCount: node.biosphereCount,
  }
}

function currentResult(runtime: AppToolRuntime) {
  if (!runtime.hasCurrentResults || !runtime.result) {
    return { unavailable: { status: "unavailable", code: "RESULTS_REQUIRED", reason: RESULT_REQUIRED_REASON } as const }
  }
  return { result: runtime.result }
}

function readLimit(value: unknown) {
  const limit = value === undefined ? 10 : Number(value)
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("limit must be an integer from 1 to 25.")
  return limit
}

function findContributionCategory(result: LcaResult, query: string) {
  const normalized = query.trim().toLocaleLowerCase()
  const categories = result.process_contributions.categories
  return categories.find((category) => category.id.toLocaleLowerCase() === normalized || category.label.toLocaleLowerCase() === normalized)
    ?? categories.filter((category) => category.label.toLocaleLowerCase().includes(normalized)).at(0)
}

export async function executeAppTool(call: ViewToolCall, runtime: AppToolRuntime) {
  const args = parseArguments(call)
  const name = call.function.name
  if (viewToolDefinitions.some((definition) => definition.function.name === name)) {
    return executeViewTool({
      call,
      activeView: runtime.activeView,
      hasCurrentResults: runtime.hasCurrentResults,
      switchView: runtime.actions.switchView,
    })
  }
  if (name === "get_workspace_status") {
    requireNoArguments(name, args)
    const { activeDocument } = runtime.workspace
    return {
      yamlDirty: runtime.workspace.yamlDirty,
      yamlValid: runtime.workspace.yamlValid,
      appliedRevision: runtime.workspace.appliedRevision,
      calculatedRevision: runtime.workspace.calculatedRevision,
      calculationStatus: runtime.workspace.calculationStatus,
      calculationError: runtime.workspace.calculationError || null,
      contributionLoading: runtime.workspace.contributionLoading,
      activeModel: activeDocument ? {
        id: "id" in activeDocument ? activeDocument.id : null,
        title: activeDocument.title,
        filename: activeDocument.filename,
        kind: activeDocument.kind,
      } : null,
      hasCurrentResults: runtime.hasCurrentResults,
    }
  }
  if (name === "get_calculation_status") {
    requireNoArguments(name, args)
    return {
      status: runtime.workspace.calculationStatus,
      error: runtime.workspace.calculationError || null,
      appliedRevision: runtime.workspace.appliedRevision,
      calculatedRevision: runtime.workspace.calculatedRevision,
      hasCurrentResults: runtime.hasCurrentResults,
      contributionLoading: runtime.workspace.contributionLoading,
    }
  }
  if (name === "list_session_models") {
    requireNoArguments(name, args)
    return runtime.workspace.sessionDocuments.map(({ id, title, filename, source }) => ({
      id, title, filename, source, active: runtime.workspace.activeDocument?.kind === "session" && runtime.workspace.activeDocument.id === id,
    }))
  }
  if (name === "list_model_templates") {
    requireNoArguments(name, args)
    return runtime.templates.map(({ id, name: title, filename }) => ({
      id, title, filename, active: runtime.workspace.activeDocument?.kind === "template" && runtime.workspace.activeDocument.id === id,
    }))
  }
  if (name === "get_graph_summary") {
    requireNoArguments(name, args)
    return {
      nodeCount: runtime.graph.nodes.length,
      connectionCount: runtime.graph.connectionCount,
      foregroundNodeCount: runtime.graph.nodes.filter((node) => node.scope !== "background").length,
      backgroundNodeCount: runtime.graph.nodes.filter((node) => node.scope === "background").length,
      mode: runtime.graph.mode,
      orientation: runtime.graph.orientation,
      connectionStyle: runtime.graph.connectionStyle,
      showReferenceAmounts: runtime.graph.showReferenceAmounts,
      maximumProcesses: runtime.graph.maximumProcesses,
      selectedNode: runtime.graph.selectedNodeId
        ? boundedNode(nodeFor(runtime, runtime.graph.selectedNodeId))
        : null,
      scaledModeAvailable: runtime.hasCurrentResults,
    }
  }
  if (name === "find_graph_nodes") {
    if (typeof args.query !== "string" || !args.query.trim()) throw new Error("find_graph_nodes requires a non-empty query.")
    const limit = args.limit === undefined ? 10 : Number(args.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 25) throw new Error("limit must be an integer from 1 to 25.")
    const query = args.query.trim().toLocaleLowerCase()
    return runtime.graph.nodes
      .filter((node) => `${node.label} ${node.kind} ${node.scope ?? ""} ${node.detail}`.toLocaleLowerCase().includes(query))
      .slice(0, limit)
      .map(boundedNode)
  }
  if (name === "get_graph_node_summary") return boundedNode(nodeFor(runtime, args.nodeId))
  if (name === "select_graph_node") {
    const node = nodeFor(runtime, args.nodeId)
    runtime.actions.selectNode(node.id)
    return { status: "completed", node: boundedNode(node) }
  }
  if (name === "clear_graph_selection") {
    requireNoArguments(name, args)
    runtime.actions.clearNodeSelection()
    return { status: "completed" }
  }
  if (name === "set_graph_display") {
    const allowed = new Set(["mode", "orientation", "connections", "showReferenceAmounts", "maximumProcesses"])
    if (!Object.keys(args).length || Object.keys(args).some((key) => !allowed.has(key))) throw new Error("Supply one or more registered graph display settings.")
    if (args.mode !== undefined && args.mode !== "structure" && args.mode !== "scaled") throw new Error("Invalid graph mode.")
    if (args.mode === "scaled" && !runtime.hasCurrentResults) return { status: "unavailable", code: "RESULTS_REQUIRED", reason: RESULT_REQUIRED_REASON }
    if (args.orientation !== undefined && args.orientation !== "horizontal" && args.orientation !== "vertical") throw new Error("Invalid graph orientation.")
    if (args.connections !== undefined && !["curved", "straight", "step"].includes(String(args.connections))) throw new Error("Invalid graph connection style.")
    if (args.showReferenceAmounts !== undefined && typeof args.showReferenceAmounts !== "boolean") throw new Error("showReferenceAmounts must be boolean.")
    if (args.maximumProcesses !== undefined && (!Number.isInteger(args.maximumProcesses) || Number(args.maximumProcesses) < 1 || Number(args.maximumProcesses) > 1000)) throw new Error("maximumProcesses must be an integer from 1 to 1000.")
    const settings = args as Parameters<AppToolRuntime["actions"]["setGraphDisplay"]>[0]
    runtime.actions.setGraphDisplay(settings)
    return { status: "completed", settings }
  }
  if (name === "fit_graph_view") {
    requireNoArguments(name, args)
    runtime.actions.fitGraph()
    return { status: "completed" }
  }
  if (name === "list_impact_categories") {
    requireNoArguments(name, args)
    const state = currentResult(runtime)
    if (state.unavailable) return state.unavailable
    return Object.entries(state.result.lcia).map(([id, value]) => ({ id, label: id.split("|")[0].trim(), unit: value.unit, score: value.score }))
  }
  if (name === "get_lca_summary") {
    const state = currentResult(runtime)
    if (state.unavailable) return state.unavailable
    const limit = readLimit(args.limit)
    if (args.categories !== undefined && (!Array.isArray(args.categories) || args.categories.some((value) => typeof value !== "string") || args.categories.length > 25)) throw new Error("categories must contain at most 25 strings.")
    const requested = new Set((args.categories as string[] | undefined)?.map((value) => value.toLocaleLowerCase()))
    const categories = Object.entries(state.result.lcia)
      .filter(([id]) => !requested?.size || requested.has(id.toLocaleLowerCase()) || requested.has(id.split("|")[0].trim().toLocaleLowerCase()))
      .slice(0, limit)
      .map(([id, value]) => ({ id, label: id.split("|")[0].trim(), score: value.score, unit: value.unit }))
    return { resultId: state.result.result_id, name: state.result.name, method: state.result.method, functionalUnit: state.result.functional_unit, categories }
  }
  if (name === "get_inventory_summary") {
    const state = currentResult(runtime)
    if (state.unavailable) return state.unavailable
    if (args.direction !== "input" && args.direction !== "output") throw new Error("direction must be input or output.")
    const limit = readLimit(args.limit)
    const input = (type: string) => /resource|extraction|input/i.test(type)
    return Object.entries(state.result.lci)
      .map(([flow, value]) => ({ flow, ...value }))
      .filter((item) => args.direction === "input" ? input(item.type) : !input(item.type))
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
      .slice(0, limit)
  }
  if (name === "get_process_results_summary") {
    const state = currentResult(runtime)
    if (state.unavailable) return state.unavailable
    if (typeof args.processId !== "string" || !args.processId) throw new Error("A non-empty processId is required.")
    const limit = readLimit(args.limit)
    const categories = state.result.process_contributions.categories.flatMap((category) => {
      const process = category.processes.find((item) => item.process_id === args.processId)
      return process ? [{ categoryId: category.id, category: category.label, unit: category.unit, totalScore: category.total_score, directScore: process.direct_score, percentage: process.percentage, processName: process.process_name, scope: process.scope }] : []
    }).slice(0, limit)
    if (!categories.length) throw new Error(`Process not found in current results: ${args.processId}`)
    return { processId: args.processId, categories }
  }
  if (name === "get_top_contributors") {
    const state = currentResult(runtime)
    if (state.unavailable) return state.unavailable
    if (typeof args.impactCategory !== "string" || !args.impactCategory.trim()) throw new Error("A non-empty impactCategory is required.")
    const scope = args.scope ?? "all"
    if (!["all", "foreground", "background"].includes(String(scope))) throw new Error("scope must be all, foreground, or background.")
    const category = findContributionCategory(state.result, args.impactCategory)
    if (!category) throw new Error(`Impact category not found: ${args.impactCategory}`)
    const limit = readLimit(args.limit)
    return {
      category: { id: category.id, label: category.label, unit: category.unit, totalScore: category.total_score },
      contributors: category.processes
        .filter((process) => scope === "all" || process.scope === scope)
        .slice()
        .sort((left, right) => Math.abs(right.direct_score) - Math.abs(left.direct_score))
        .slice(0, limit)
        .map((process) => ({ processId: process.process_id, processName: process.process_name, scope: process.scope, directScore: process.direct_score, percentage: process.percentage })),
    }
  }
  if (name === "validate_yaml_draft") {
    requireNoArguments(name, args)
    if (!runtime.workspace.yamlDraft.trim()) return { valid: false, code: "EMPTY_DRAFT", message: "The YAML draft is empty." }
    try {
      const graph = buildGraphFromYaml(runtime.workspace.yamlDraft, "structure")
      return { valid: true, nodeCount: graph.nodes.length, connectionCount: graph.edges.length }
    } catch (error) {
      return { valid: false, code: "INVALID_YAML", message: error instanceof Error ? error.message.slice(0, 500) : "The YAML draft is invalid." }
    }
  }
  if (name === "get_yaml_outline") {
    requireNoArguments(name, args)
    if (!runtime.workspace.yamlDraft.trim()) return { status: "unavailable", code: "EMPTY_DRAFT", reason: "The YAML draft is empty." }
    try {
      const document = parse(runtime.workspace.yamlDraft) as {
        name?: unknown
        functional_unit?: { description?: unknown; amount?: unknown; unit?: unknown }
        products?: unknown[]
        processes?: Array<{ id?: unknown; name?: unknown }>
        units?: Record<string, unknown>
      }
      const graph = buildGraphFromYaml(runtime.workspace.yamlDraft, "structure")
      return {
        name: typeof document?.name === "string" ? document.name : null,
        functionalUnit: document?.functional_unit ? {
          description: typeof document.functional_unit.description === "string" ? document.functional_unit.description : null,
          amount: typeof document.functional_unit.amount === "number" ? document.functional_unit.amount : null,
          unit: typeof document.functional_unit.unit === "string" ? document.functional_unit.unit : null,
        } : null,
        products: Array.isArray(document?.products) ? document.products.length : 0,
        units: document?.units && typeof document.units === "object" ? Object.keys(document.units).slice(0, 50) : [],
        processes: Array.isArray(document?.processes) ? document.processes.slice(0, 50).map((process) => ({
          id: typeof process.id === "string" ? process.id : null,
          name: typeof process.name === "string" ? process.name : null,
        })) : [],
        nodeCount: graph.nodes.length,
        connectionCount: graph.edges.length,
        truncated: Array.isArray(document?.processes) && document.processes.length > 50,
      }
    } catch (error) {
      return { status: "unavailable", code: "INVALID_YAML", reason: error instanceof Error ? error.message.slice(0, 500) : "The YAML draft is invalid." }
    }
  }
  if (name === "calculate_current_model") {
    requireNoArguments(name, args)
    if (runtime.workspace.yamlDirty) return { status: "unavailable", code: "UNSAVED_DRAFT", reason: "Save or discard YAML changes before calculating the applied model." }
    if (!runtime.workspace.yamlValid) return { status: "unavailable", code: "INVALID_YAML", reason: "The current model is not valid." }
    if (runtime.workspace.calculationStatus === "calculating") return { status: "unavailable", code: "CALCULATION_IN_PROGRESS", reason: "A calculation is already running." }
    runtime.actions.calculateCurrentModel()
    return { status: "completed", appliedRevision: runtime.workspace.appliedRevision }
  }
  if (name === "save_current_model") {
    requireNoArguments(name, args)
    if (runtime.workspace.activeDocument?.kind !== "session") return { status: "unavailable", code: "NOT_WRITABLE", reason: "The active model is not a writable session model. Use save_model_as instead." }
    if (!runtime.workspace.yamlDirty) return { status: "unavailable", code: "NO_CHANGES", reason: "The active model has no unsaved changes." }
    if (!runtime.workspace.yamlValid) return { status: "unavailable", code: "INVALID_YAML", reason: "Fix the YAML draft before saving." }
    if (!runtime.actions.saveCurrentModel()) throw new Error("The current model could not be saved.")
    return { status: "completed", modelId: runtime.workspace.activeDocument.id }
  }
  if (name === "save_model_as") {
    if (typeof args.name !== "string" || !args.name.trim() || args.name.trim().length > 120) throw new Error("name must contain 1 to 120 characters.")
    const title = args.name.trim()
    if (!runtime.workspace.yamlValid) return { status: "unavailable", code: "INVALID_YAML", reason: "Fix the YAML draft before saving." }
    if (runtime.workspace.sessionDocuments.some((document) => document.title.toLocaleLowerCase() === title.toLocaleLowerCase())) throw new Error("A session model with that name already exists.")
    if (!runtime.actions.saveModelAs(title)) throw new Error("The model could not be saved.")
    return { status: "completed", title }
  }
  if (name === "open_model") {
    if (args.kind !== "template" && args.kind !== "session") throw new Error("kind must be template or session.")
    if (typeof args.id !== "string" || !args.id) throw new Error("A non-empty model id is required.")
    const exists = args.kind === "template" ? runtime.templates.some((template) => template.id === args.id) : runtime.workspace.sessionDocuments.some((document) => document.id === args.id)
    if (!exists) throw new Error(`${args.kind} model not found: ${args.id}`)
    runtime.actions.openModel(args.kind, args.id)
    return { status: runtime.workspace.yamlDirty ? "confirmation_required" : "completed", kind: args.kind, id: args.id }
  }
  if (name === "new_model") {
    requireNoArguments(name, args)
    runtime.actions.newModel()
    return { status: runtime.workspace.yamlDirty ? "confirmation_required" : "completed" }
  }
  if (name === "download_yaml") {
    requireNoArguments(name, args)
    if (!runtime.workspace.yamlDraft.trim()) return { status: "unavailable", code: "EMPTY_DRAFT", reason: "There is no YAML to download." }
    runtime.actions.downloadYaml()
    return { status: "completed", filename: runtime.workspace.activeDocument?.filename ?? "untitled-model.yaml" }
  }
  if (name === "export_results") {
    if (args.format !== "json" && args.format !== "markdown") throw new Error("format must be json or markdown.")
    const state = currentResult(runtime)
    if (state.unavailable) return state.unavailable
    runtime.actions.exportResults(args.format)
    return { status: "completed", format: args.format, resultId: state.result.result_id }
  }
  if (name === "delete_session_model") {
    if (typeof args.id !== "string" || !args.id) throw new Error("A non-empty session model id is required.")
    const document = runtime.workspace.sessionDocuments.find((candidate) => candidate.id === args.id)
    if (!document) throw new Error(`Session model not found: ${args.id}`)
    if (runtime.workspace.activeDocument?.kind === "session" && runtime.workspace.activeDocument.id === args.id) {
      return { status: "unavailable", code: "ACTIVE_MODEL", reason: "Open another model before deleting the active session model." }
    }
    runtime.actions.deleteSessionModel(args.id)
    return { status: "completed", id: args.id, title: document.title }
  }
  throw new Error(`Unknown tool: ${name}`)
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
