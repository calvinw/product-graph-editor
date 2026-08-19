import { useEffect, useRef, useState } from "react"
import { parse } from "yaml"
import type { SwitchViewOutcome } from "@/ai/viewTools"
import { getProductGraphTemplates, type ProductGraphTemplate } from "@/lib/lcaApi"
import {
  safeYamlFilename, templateToDocument, uniqueSessionTitle, yamlFilenameStem,
  type SessionDocument,
} from "@/lib/modelWorkspace"
import { productGraphLabel } from "@/lib/resultFormatting"
import { useProductGraphStore, type ProductGraphView as View } from "@/state/productGraphStore"

const WEBAPP_DEFAULT_PRODUCT_GRAPH_ID = import.meta.env.VITE_DEFAULT_PRODUCT_GRAPH_ID ?? "cotton_fiber"

type AnalysisView = Extract<View, "inventory" | "impact" | "process" | "contribution" | "sankey" | "realtime">
const analysisViews: AnalysisView[] = ["inventory", "impact", "process", "contribution", "sankey", "realtime"]
const isAnalysisView = (view: View): view is AnalysisView => analysisViews.includes(view as AnalysisView)

export type PendingAction =
  | { kind: "view"; view: View }
  | { kind: "template"; id: string }
  | { kind: "session"; id: string }
  | { kind: "new" }
  | { kind: "upload" }

/**
 * Model documents and the navigation that depends on them.
 *
 * These are one hook rather than two because save-before-navigate spans both:
 * `saveAsSessionModelWithName` reads `pendingAction` and calls `performAction`.
 * Splitting them would push pendingAction, setPendingAction, and performAction
 * through a parameter list that is already wide enough.
 */
export function useModelWorkspace({
  setYamlError,
  applyYaml,
  applyAndCalculateYaml,
  calculateSource,
  loadContributionGraphs,
  setContributionError,
  cumulativeCategories,
}: {
  setYamlError: (message: string) => void
  applyYaml: (source: string) => number | null
  applyAndCalculateYaml: (source: string, openGraphWhenReady?: boolean) => void
  calculateSource: (source: string, revision: number, openGraphWhenReady?: boolean) => void | Promise<void>
  loadContributionGraphs: (categories: string[]) => Promise<unknown>
  setContributionError: (message: string) => void
  cumulativeCategories: string[]
}) {
  const view = useProductGraphStore((state) => state.activeView)
  const activeDocument = useProductGraphStore((state) => state.activeDocument)
  const sessionDocuments = useProductGraphStore((state) => state.sessionDocuments)
  const yamlDraft = useProductGraphStore((state) => state.yamlDraft)
  const {
    requestViewChange: setView,
    dispatchWorkspace: dispatchModelWorkspace,
    failCalculation,
  } = useProductGraphStore((state) => state.actions)

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [pendingConfirmationOpen, setPendingConfirmationOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState("")
  const [saveAsError, setSaveAsError] = useState("")
  const [templates, setTemplates] = useState<ProductGraphTemplate[]>([])
  const [templateState, setTemplateState] = useState<"loading" | "ready" | "unavailable">("loading")
  const initialCalculationStartedRef = useRef(false)
  const navbarUploadRef = useRef<HTMLInputElement>(null)
  const saveAsReturnFocusRef = useRef<HTMLElement | null>(null)

  const primaryView = view === "graph" || view === "yaml" || view === "results" ? view : ""
  const analysisView = isAnalysisView(view) ? view : ""

  const loadYamlFile = (file?: File) => {
    if (!file) return
    if (!/\.ya?ml$/i.test(file.name)) { setYamlError("Choose a .yaml or .yml file."); return }
    const reader = new FileReader()
    reader.onload = () => {
      const source = String(reader.result ?? "")
      const proposedTitle = yamlFilenameStem(file.name).trim() || "Untitled model"
      const revision = applyYaml(source)
      if (revision === null) {
        dispatchModelWorkspace({
          type: "start-invalid-upload",
          title: proposedTitle,
          filename: file.name,
          yaml: source,
        })
        setView("yaml")
        return
      }
      const title = uniqueSessionTitle(proposedTitle, sessionDocuments)
      const document: SessionDocument = {
        kind: "session",
        id: crypto.randomUUID(),
        title,
        filename: safeYamlFilename(title),
        committedYaml: source,
        source: "upload",
      }
      dispatchModelWorkspace({ type: "commit-new-session", document })
      setView("graph")
      void calculateSource(source, revision)
    }
    reader.onerror = () => setYamlError("Could not read the selected file.")
    reader.readAsText(file)
  }

  const loadTemplate = (id: string) => {
    const entry = templates.find((item) => item.id === id)
    if (!entry) return
    const document = { ...templateToDocument(entry), title: productGraphLabel(entry.name) }
    dispatchModelWorkspace({ type: "load-document", document })
    setYamlError("")
    setView("graph")
    applyAndCalculateYaml(document.committedYaml, false)
  }

  const loadSessionModel = (id: string) => {
    const document = sessionDocuments.find((item) => item.id === id)
    if (!document) return
    dispatchModelWorkspace({ type: "load-document", document })
    setYamlError("")
    setView("graph")
    applyAndCalculateYaml(document.committedYaml, false)
  }

  const downloadTextFile = (contents: string, filename: string, type: string) => {
    const url = URL.createObjectURL(new Blob([contents], { type }))
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    link.click()
    URL.revokeObjectURL(url)
  }

  const isDirty = yamlDraft !== (activeDocument?.committedYaml ?? "")
  const isTransient = activeDocument?.kind === "new" || activeDocument?.kind === "invalid-upload"
  const hasUncommittedWorkspace = isDirty || isTransient
  const canSave = activeDocument?.kind === "session" && isDirty
  const canSaveAs = yamlDraft.trim().length > 0
  const canDownload = yamlDraft.trim().length > 0

  const suggestedSaveAsName = () => {
    let suggestion = "Untitled model"
    if (activeDocument?.kind === "template" || activeDocument?.kind === "session" || activeDocument?.kind === "invalid-upload") {
      suggestion = activeDocument.title
    } else {
      try {
        const source = parse(yamlDraft) as { name?: unknown }
        if (typeof source?.name === "string" && source.name.trim()) suggestion = productGraphLabel(source.name.trim())
      } catch {
        // Keep the transient model suggestion when the draft is incomplete.
      }
    }
    return uniqueSessionTitle(suggestion, sessionDocuments)
  }

  const openSaveAsDialog = () => {
    saveAsReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSaveAsName(suggestedSaveAsName())
    setSaveAsError("")
    setSaveAsOpen(true)
  }

  const openBlankYamlEditor = () => {
    dispatchModelWorkspace({ type: "start-new" })
    setYamlError("")
    setView("yaml")
  }

  const saveSessionModel = () => {
    if (activeDocument?.kind !== "session" || !isDirty) return false
    const revision = applyYaml(yamlDraft)
    if (revision === null) return false
    dispatchModelWorkspace({ type: "commit-active-session", yaml: yamlDraft })
    void calculateSource(yamlDraft, revision)
    return true
  }

  const saveAsSessionModelWithName = (proposedName: string) => {
    const title = proposedName.trim()
    if (!title) { setSaveAsError("Enter a model name."); return false }
    if (title.length > 120) { setSaveAsError("Use 120 characters or fewer."); return false }
    if (sessionDocuments.some((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase())) {
      setSaveAsError("A model with this name already exists in this session.")
      return false
    }
    const revision = applyYaml(yamlDraft)
    if (revision === null) {
      setSaveAsOpen(false)
      setPendingAction(null)
      setView("yaml")
      return false
    }
    const source: SessionDocument["source"] = activeDocument?.kind === "template"
      ? "template-copy"
      : activeDocument?.kind === "session"
        ? "session-copy"
        : activeDocument?.kind === "invalid-upload"
          ? "upload"
          : "new"
    const document: SessionDocument = {
      kind: "session",
      id: crypto.randomUUID(),
      title,
      filename: safeYamlFilename(title),
      committedYaml: yamlDraft,
      source,
    }
    const destination = pendingAction
    dispatchModelWorkspace({ type: "commit-new-session", document })
    setSaveAsOpen(false)
    setSaveAsError("")
    setPendingAction(null)
    void calculateSource(yamlDraft, revision)
    if (destination) performAction(destination)
    return true
  }

  const saveAsSessionModel = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    saveAsSessionModelWithName(saveAsName)
  }

  const discardYamlChanges = () => {
    dispatchModelWorkspace({ type: "discard" })
    setYamlError("")
  }

  const downloadCurrentYaml = () => {
    downloadTextFile(yamlDraft, activeDocument?.filename || "untitled-model.yaml", "text/yaml")
  }

  useEffect(() => {
    const confirmDiscard = (event: BeforeUnloadEvent) => {
      if (!isDirty) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", confirmDiscard)
    return () => window.removeEventListener("beforeunload", confirmDiscard)
  }, [isDirty])

  useEffect(() => {
    if (initialCalculationStartedRef.current) return
    initialCalculationStartedRef.current = true
    void (async () => {
      try {
        const templateCollection = await getProductGraphTemplates()
        const initial = templateCollection.product_graphs.find((item) => item.id === WEBAPP_DEFAULT_PRODUCT_GRAPH_ID)
          ?? templateCollection.product_graphs.find((item) => item.id === templateCollection.default_id)
        if (!initial) throw new Error("The product-graph templates have no default selection.")
        setTemplates(templateCollection.product_graphs)
        setTemplateState("ready")
        dispatchModelWorkspace({
          type: "load-document",
          document: { ...templateToDocument(initial), title: productGraphLabel(initial.name) },
        })
        const revision = applyYaml(initial.product_graph)
        if (revision !== null) void calculateSource(initial.product_graph, revision)
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not load product graphs from the LCA server."
        setTemplateState("unavailable")
        setYamlError(message)
        failCalculation(message)
      }
    })()
    // The initial template load and calculation must run exactly once per app mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openAnalysisView = (next: AnalysisView) => {
    setView(next)
    if (["impact", "process", "contribution", "sankey"].includes(next) && cumulativeCategories.length) {
      void loadContributionGraphs(cumulativeCategories).catch((caught) => {
        setContributionError(caught instanceof Error ? caught.message : "Could not calculate cumulative contributions.")
      })
    }
  }

  const continueToView = (next: View) => {
    if (isAnalysisView(next)) openAnalysisView(next)
    else setView(next)
  }

  function performAction(action: PendingAction) {
    if (action.kind === "view") continueToView(action.view)
    else if (action.kind === "template") loadTemplate(action.id)
    else if (action.kind === "session") loadSessionModel(action.id)
    else if (action.kind === "new") openBlankYamlEditor()
    else navbarUploadRef.current?.click()
  }

  const requestAction = (action: PendingAction) => {
    if (hasUncommittedWorkspace && !(action.kind === "view" && action.view === "yaml")) {
      setPendingAction(action)
      setPendingConfirmationOpen(true)
      return
    }
    performAction(action)
  }

  const requestView = (next: View) => {
    requestAction({ kind: "view", view: next })
  }

  const requestAssistantView = (next: View): SwitchViewOutcome => {
    const label = next === "yaml" ? "Edit" : next === "results" ? "LCA results" : next[0].toUpperCase() + next.slice(1)
    if (hasUncommittedWorkspace && next !== "yaml") {
      requestView(next)
      return { status: "confirmation_required", view: next, label, reason: "Confirm how to handle unsaved YAML changes in the application dialog." }
    }
    requestView(next)
    return { status: "completed", view: next, label }
  }

  const cancelPendingAction = () => {
    setPendingConfirmationOpen(false)
    setPendingAction(null)
  }

  const discardAndContinue = () => {
    if (!pendingAction) return
    const destination = pendingAction
    setPendingConfirmationOpen(false)
    setPendingAction(null)
    discardYamlChanges()
    performAction(destination)
  }

  const saveAndContinue = () => {
    if (!pendingAction) return
    const destination = pendingAction
    setPendingConfirmationOpen(false)
    if (!saveSessionModel()) {
      setPendingAction(null)
      setView("yaml")
      return
    }
    setPendingAction(null)
    performAction(destination)
  }

  const saveAsAndContinue = () => {
    setPendingConfirmationOpen(false)
    openSaveAsDialog()
  }

  return {
    view, primaryView, analysisView, isAnalysisView,
    templates, templateState,
    pendingAction, pendingConfirmationOpen, setPendingConfirmationOpen,
    saveAsOpen, setSaveAsOpen, saveAsName, setSaveAsName, saveAsError, setSaveAsError,
    saveAsReturnFocusRef, navbarUploadRef,
    isDirty, isTransient, hasUncommittedWorkspace, canSave, canSaveAs, canDownload,
    loadYamlFile, loadTemplate, loadSessionModel,
    openSaveAsDialog, openBlankYamlEditor, saveSessionModel, saveAsSessionModel,
    discardYamlChanges, downloadCurrentYaml, downloadTextFile,
    saveAsSessionModelWithName,
    openAnalysisView, continueToView, requestAction, requestView, requestAssistantView,
    cancelPendingAction, discardAndContinue, saveAndContinue, saveAsAndContinue,
    setPendingAction,
  }
}
