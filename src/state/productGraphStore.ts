import { create } from "zustand"
import type { LcaResult } from "@/lib/lcaApi"
import type { ScenarioOverrides } from "@/lib/realtimeScore"
import {
  initialModelWorkspace,
  modelWorkspaceReducer,
  type ModelWorkspaceAction,
  type ModelWorkspaceState,
} from "@/lib/modelWorkspace"
import {
  createMemoryVersionStore,
  createVersion,
  historyKeyFor,
  shouldAppend,
  type DocumentSnapshot,
  type Version,
  type VersionSource,
} from "@/lib/versionHistory"

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
  applyScenarioSource: (yaml: string) => number
  /**
   * Record the document as it stands right now, if it has moved since the
   * last version. Returns the version written, or null when deduped.
   */
  commitVersion: (options: { label: string; source?: VersionSource }) => Version | null
  /**
   * Put a recorded snapshot back. Appends rather than truncating, so nothing
   * ahead of the restore point is lost. Returns the new applied revision, or
   * null if the version is unknown.
   */
  restoreVersion: (versionId: string) => number | null
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

export type ProductGraphState = {
  /**
   * The document tier, nested rather than spread so there is a single object
   * to snapshot for undo. `modelWorkspaceReducer` owns everything in here.
   *
   * `appliedYaml` is deliberately NOT in this slice: it is written by
   * applySource/applyScenarioSource alongside the revision and calculation
   * fields, not by the reducer. A version snapshot is therefore this slice
   * plus `appliedYaml` -- see `selectDocumentSnapshot`.
   */
  workspace: ModelWorkspaceState
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
  /** Revision of an in-flight scenario commit, whose scaling vector is still valid. */
  scenarioCommitRevision: number | null
  scenarioOverrides: ScenarioOverrides
  /**
   * The active model's version list, newest last. Mirrored into state so the
   * history panel re-renders; `versionStore` remains the persistence boundary.
   */
  versions: Version[]
  actions: ProductGraphActions
}

const initialProductGraphState = {
  workspace: initialModelWorkspace,
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
  scenarioCommitRevision: null,
  scenarioOverrides: {},
  versions: [],
}

/**
 * Session-scoped for now. Swapping this for a localStorage or database
 * implementation is the only change needed to make history durable, because
 * every caller goes through the three-method `VersionStore` interface.
 */
const versionStore = createMemoryVersionStore()

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
    dispatchWorkspace: (action) => set((state) => {
      const workspace = modelWorkspaceReducer(state.workspace, action)
      // History is per model, so switching documents must swap the visible
      // list. Recomputed from the store rather than tracked separately, so
      // there is only ever one source of truth.
      const key = historyKeyFor(workspace.activeDocument)
      const versions = versionStore.list(key)
      return versions === state.versions ? { workspace } : { workspace, versions }
    }),
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
        scenarioCommitRevision: null,
        scenarioOverrides: {},
      })
      return appliedRevision
    },
    /**
     * Apply YAML derived from a scenario drag.
     *
     * Unlike applySource this keeps the graph mode, the selection, and the
     * previous result, so committing a drag does not eject the user from
     * scaled mode or blank the scores while the exact calculation runs. The
     * revision still advances, so a stale response is discarded.
     */
    applyScenarioSource: (appliedYaml) => {
      const appliedRevision = get().appliedRevision + 1
      // A background-amount change leaves the foreground scaling vector
      // untouched, so the previous result stays usable while the exact
      // calculation runs. Without this the graph drops to structure mode and
      // the labels flip to flow names until the response arrives.
      set({ appliedYaml, appliedRevision, scenarioCommitRevision: appliedRevision, calculationError: "" })
      return appliedRevision
    },
    commitVersion: ({ label, source = "you" }) => {
      const state = get()
      const key = historyKeyFor(state.workspace.activeDocument)
      const history = versionStore.list(key)
      const snapshot: DocumentSnapshot = { ...state.workspace, appliedYaml: state.appliedYaml }
      if (!shouldAppend(history, snapshot)) return null
      const version = createVersion(snapshot, { label, source })
      versionStore.append(key, version)
      set({ versions: versionStore.list(key) })
      return version
    },
    restoreVersion: (versionId) => {
      const version = versionStore.get(versionId)
      if (!version) return null
      const { snapshot } = version
      const appliedRevision = get().appliedRevision + 1
      // Deliberately not applySource: that resets graphMode, clears the
      // selection, and nulls lcaResult, so undoing through it would eject you
      // from scaled mode and blank your scores. Mode and selection are simply
      // left untouched here.
      //
      // scenarioCommitRevision is also deliberately NOT set, unlike
      // applyScenarioSource. That flag means "the previous result is still
      // valid for this revision", which is true for a background-amount drag
      // but false when restoring an arbitrary document. The result is
      // recalculated instead; caching it by content hash for instant undo is
      // a later, optional phase.
      set({
        workspace: {
          activeDocument: snapshot.activeDocument,
          sessionDocuments: snapshot.sessionDocuments,
          yamlDraft: snapshot.yamlDraft,
        },
        appliedYaml: snapshot.appliedYaml,
        appliedRevision,
        calculationError: "",
        scenarioOverrides: {},
      })
      // Restoring appends rather than truncating, so whatever was ahead of
      // this point stays reachable. Dedupe still applies: restoring the state
      // you are already in records nothing.
      const key = historyKeyFor(snapshot.activeDocument)
      if (shouldAppend(versionStore.list(key), snapshot)) {
        versionStore.append(key, createVersion(snapshot, { label: `Restored ${version.label}`, source: "you" }))
      }
      set({ versions: versionStore.list(key) })
      return appliedRevision
    },
    startCalculation: () => set({ calculationStatus: "calculating", calculationError: "" }),
    clearCalculationError: () => set({ calculationError: "" }),
    completeCalculation: (lcaResult, calculatedRevision) => set({
      lcaResult,
      calculatedRevision,
      calculationStatus: "complete",
      calculationError: "",
      scenarioCommitRevision: null,
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
    reset: () => {
      // The version store lives outside zustand state, so resetting the state
      // alone would leave recorded history behind -- and document ids can
      // repeat after a reset, which would let a new document inherit the
      // previous one's versions.
      versionStore.clear()
      set(initialProductGraphState)
    },
  },
}))

export const selectHasCurrentResults = (state: ProductGraphState) => (
  state.lcaResult !== null && state.calculatedRevision === state.appliedRevision
)

export const selectHasUncommittedWorkspace = (state: ProductGraphState) => (
  state.workspace.yamlDraft !== (state.workspace.activeDocument?.committedYaml ?? "") ||
  state.workspace.activeDocument?.kind === "new" ||
  state.workspace.activeDocument?.kind === "invalid-upload"
)

/**
 * Everything a version snapshot must capture: the reducer-owned document tier
 * plus `appliedYaml`, which lives outside it. Undo restores exactly this and
 * nothing else -- view, selection, zoom, and calculated results are excluded
 * deliberately, because results are derived and the rest is not document state.
 */
export type { DocumentSnapshot }

export const selectDocumentSnapshot = (state: ProductGraphState): DocumentSnapshot => ({
  ...state.workspace,
  appliedYaml: state.appliedYaml,
})
