import { create } from "zustand"
import type { LcaResult } from "@/lib/lcaApi"
import type { ScenarioOverrides } from "@/lib/realtimeScore"
import {
  initialModelWorkspace,
  modelWorkspaceReducer,
  type ModelWorkspaceAction,
  type ModelWorkspaceState,
} from "@/lib/modelWorkspace"

export type ProductGraphView = "graph" | "yaml" | "inventory" | "impact" | "process" | "contribution" | "sankey" | "results" | "realtime"
export type GraphMode = "scaled" | "structure"
export type GraphOrientation = "vertical" | "horizontal"
export type GraphConnectionStyle = "curved" | "straight" | "step"

export type SelectedGraphNode = {
  id: string
  label: string
  kind: string
  detail: string
  color: string
  scope?: "foreground" | "background"
}

type ProductGraphActions = {
  requestViewChange: (view: ProductGraphView) => void
  selectNode: (node: SelectedGraphNode) => void
  clearNodeSelection: () => void
  setGraphMode: (mode: GraphMode) => void
  setGraphOrientation: (orientation: GraphOrientation) => void
  setGraphConnectionStyle: (style: GraphConnectionStyle) => void
  setReferenceAmountsVisible: (visible: boolean) => void
  setGraphMaxProcesses: (maximum: number) => void
  dispatchWorkspace: (action: ModelWorkspaceAction) => void
  applySource: (yaml: string) => number
  startCalculation: () => void
  clearCalculationError: () => void
  completeCalculation: (result: LcaResult, revision: number) => void
  failCalculation: (message: string) => void
  finishCalculation: () => void
  mergeContributionGraphs: (resultId: string, graphs: LcaResult["contribution_graphs"]) => void
  setScenarioOverride: (linkId: string, amount: number) => void
  resetScenario: () => void
  reset: () => void
}

export type ProductGraphState = ModelWorkspaceState & {
  activeView: ProductGraphView
  selectedNode: SelectedGraphNode | null
  graphMode: GraphMode
  graphOrientation: GraphOrientation
  graphConnectionStyle: GraphConnectionStyle
  showReferenceAmounts: boolean
  graphMaxProcesses: number
  appliedYaml: string
  appliedRevision: number
  calculationStatus: "idle" | "calculating" | "error" | "complete"
  calculationError: string
  lcaResult: LcaResult | null
  calculatedRevision: number | null
  scenarioOverrides: ScenarioOverrides
  actions: ProductGraphActions
}

const initialProductGraphState = {
  ...initialModelWorkspace,
  activeView: "graph" as const,
  selectedNode: null,
  graphMode: "structure" as const,
  graphOrientation: "horizontal" as const,
  graphConnectionStyle: "curved" as const,
  showReferenceAmounts: false,
  graphMaxProcesses: 1,
  appliedYaml: "",
  appliedRevision: 0,
  calculationStatus: "idle" as const,
  calculationError: "",
  lcaResult: null,
  calculatedRevision: null,
  scenarioOverrides: {},
}

export const useProductGraphStore = create<ProductGraphState>()((set, get) => ({
  ...initialProductGraphState,
  actions: {
    requestViewChange: (activeView) => set({ activeView }),
    selectNode: (selectedNode) => set({ selectedNode }),
    clearNodeSelection: () => set({ selectedNode: null }),
    setGraphMode: (graphMode) => set({ graphMode, showReferenceAmounts: false }),
    setGraphOrientation: (graphOrientation) => set({ graphOrientation }),
    setGraphConnectionStyle: (graphConnectionStyle) => set({ graphConnectionStyle }),
    setReferenceAmountsVisible: (showReferenceAmounts) => set({ showReferenceAmounts }),
    setGraphMaxProcesses: (graphMaxProcesses) => set({ graphMaxProcesses: Math.max(1, graphMaxProcesses) }),
    dispatchWorkspace: (action) => set((state) => modelWorkspaceReducer(state, action)),
    applySource: (appliedYaml) => {
      const appliedRevision = get().appliedRevision + 1
      set({
        appliedYaml,
        appliedRevision,
        graphMode: "structure",
        showReferenceAmounts: false,
        selectedNode: null,
        calculationStatus: "idle",
        calculationError: "",
        lcaResult: null,
        calculatedRevision: null,
        scenarioOverrides: {},
      })
      return appliedRevision
    },
    startCalculation: () => set({ calculationStatus: "calculating", calculationError: "" }),
    clearCalculationError: () => set({ calculationError: "" }),
    completeCalculation: (lcaResult, calculatedRevision) => set({
      lcaResult,
      calculatedRevision,
      calculationStatus: "complete",
      calculationError: "",
      // A fresh baseline must never inherit deltas measured against the old one.
      scenarioOverrides: {},
    }),
    failCalculation: (calculationError) => set({ calculationStatus: "error", calculationError }),
    finishCalculation: () => set((state) => ({
      calculationStatus: state.calculationStatus === "calculating" ? "idle" : state.calculationStatus,
    })),
    mergeContributionGraphs: (resultId, graphs) => set((state) => {
      if (!state.lcaResult || state.lcaResult.result_id !== resultId) return state
      const merged = new Map(state.lcaResult.contribution_graphs.map((graph) => [graph.label, graph]))
      graphs.forEach((graph) => merged.set(graph.label, graph))
      return { lcaResult: { ...state.lcaResult, contribution_graphs: [...merged.values()] } }
    }),
    setScenarioOverride: (linkId, amount) => set((state) => ({
      scenarioOverrides: { ...state.scenarioOverrides, [linkId]: amount },
    })),
    resetScenario: () => set({ scenarioOverrides: {} }),
    reset: () => set(initialProductGraphState),
  },
}))

export const selectHasCurrentResults = (state: ProductGraphState) => (
  state.lcaResult !== null && state.calculatedRevision === state.appliedRevision
)

export const selectHasUncommittedWorkspace = (state: ProductGraphState) => (
  state.yamlDraft !== (state.activeDocument?.committedYaml ?? "") ||
  state.activeDocument?.kind === "new" ||
  state.activeDocument?.kind === "invalid-upload"
)
