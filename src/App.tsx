import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ReactFlowProvider,
  type Node,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import prismLogoRound from "./assets/prism-logo-round.png"
import {
  BarChart3, Check, ChevronLeft, GripHorizontal, Scan, LayoutGrid, ChevronDown,
  ChevronsDownUp, ChevronsUpDown, Minus, Moon, MousePointer2, Plus, Settings2, Sun, X,
} from "lucide-react"
import { parse } from "yaml"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { NumberStepper } from "@/components/NumberStepper"
import { AiChatPanel } from "@/components/AiChatPanel"
import { RealtimeView } from "@/components/RealtimeView"
import type { AppToolRuntime } from "@/ai/viewTools"
import type { ProcessNodeData } from "./components/ProcessNode"
import {
  lcaResultToMarkdown,
} from "./lib/lcaApi"
import { ImpactAnalysisView } from "@/components/views/ImpactAnalysisView"
import { AppSelect, CurrentModelTitle, ToolButton } from "@/components/common/AppControls"
import { ContributionView } from "@/components/views/ContributionView"
import { InventoryView } from "@/components/views/InventoryView"
import { ProcessResultsView } from "@/components/views/ProcessResultsView"
import { SankeyView } from "@/components/views/SankeyView"
import { FileMenu } from "@/components/workspace/FileMenu"
import { HistoryPanel } from "@/components/workspace/HistoryPanel"
import { YamlEditor } from "@/components/workspace/YamlEditor"
import { SaveAsDialog } from "@/components/workspace/SaveAsDialog"
import { UnsavedChangesDialog } from "@/components/workspace/UnsavedChangesDialog"
import { useCalculation } from "@/hooks/useCalculation"
import { GraphCanvas } from "@/components/graph/GraphCanvas"
import { Inspector } from "@/components/graph/Inspector"
import { ScenarioPanel } from "@/components/graph/ScenarioPanel"
import { useGraphModel } from "@/hooks/useGraphModel"
import { useDraggablePosition } from "@/hooks/useDraggablePosition"
import { useModelWorkspace } from "@/hooks/useModelWorkspace"
import { safeYamlFilename } from "./lib/modelWorkspace"
import { WelcomePage } from "@/components/welcome/WelcomePage"
import { DisplaySettingsProvider, useDisplaySettings } from "./lib/displaySettings"
import {
  selectHasCurrentResults,
  useProductGraphStore,
  type ProductGraphView as View,
} from "./state/productGraphStore"
type NodeMeta = { label: string; kind: string; detail: string; color: string; scope?: "foreground" | "background" }
type AnalysisView = Extract<View, "inventory" | "impact" | "process" | "contribution" | "sankey" | "realtime">




function GraphEditor({ onTitleChange, navbarTarget, chatPortalTarget, active, chatOpen, onChatOpenChange }: { onTitleChange: (title: string) => void; navbarTarget: HTMLDivElement | null; chatPortalTarget: HTMLDivElement | null; active: boolean; chatOpen: boolean; onChatOpenChange: (open: boolean) => void }) {
  const { decimalPlaces, showAllDecimalPlaces, theme } = useDisplaySettings()
  const selected = useProductGraphStore((state) => state.selectedNode)
  const view = useProductGraphStore((state) => state.activeView)
  const activeDocument = useProductGraphStore((state) => state.workspace.activeDocument)
  const sessionDocuments = useProductGraphStore((state) => state.workspace.sessionDocuments)
  const yamlDraft = useProductGraphStore((state) => state.workspace.yamlDraft)
  const versions = useProductGraphStore((state) => state.versions)
  const draftAuthor = useProductGraphStore((state) => state.draftAuthor)
  const appliedYaml = useProductGraphStore((state) => state.appliedYaml)
  const appliedRevision = useProductGraphStore((state) => state.appliedRevision)
  const [resultsMarkdown, setResultsMarkdown] = useState("")
  const resultsError = useProductGraphStore((state) => state.calculationError)
  const lcaResult = useProductGraphStore((state) => state.lcaResult)
  const calculatedRevision = useProductGraphStore((state) => state.calculatedRevision)
  const scenarioOverrides = useProductGraphStore((state) => state.scenarioOverrides)
  const graphMode = useProductGraphStore((state) => state.graphMode)
  const showReferenceAmounts = useProductGraphStore((state) => state.showReferenceAmounts)
  const [graphSettingsOpen, setGraphSettingsOpen] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const { position: graphToolbarPosition, startDrag: startGraphToolbarDrag, panelRef: graphToolbarRef } = useDraggablePosition("product-graph-editor:graph-toolbar-position")
  const graphMaxProcesses = useProductGraphStore((state) => state.graphMaxProcesses)
  const graphOrientation = useProductGraphStore((state) => state.graphOrientation)
  const graphConnectionStyle = useProductGraphStore((state) => state.graphConnectionStyle)
  const storeActions = useProductGraphStore((state) => state.actions)
  const {
    requestViewChange: setView,
    selectNode: setSelected,
    clearNodeSelection,
    setReferenceAmountsVisible,
    setGraphMaxProcesses,
    setGraphOrientation,
    setGraphConnectionStyle,
    dispatchWorkspace: dispatchModelWorkspace,
    setScenarioOverride,
    resetScenario,
  } = storeActions
  const inspectorOpen = selected !== null
  const lastSelectedRef = useRef<(NodeMeta & { id: string }) | null>(null)

  const {
    calculateSource, loadContributionGraphs, resetCalculationState,
    setContributionError, contributionError, loadingContributionKeys,
    isCalculating, calculationInProgress, calculationStatus, markRevision,
  } = useCalculation({
    onResultsMarkdown: setResultsMarkdown,
    onOpenGraph: () => setView("graph"),
  })

  const {
    nodes, edges, onNodesChange, onEdgesChange,
    yamlError, setYamlError,
    availableGraphProcessCount,
    fitView, zoomIn, zoomOut, fit, relayout,
    toggleExpanded, setAllExpanded,
    applyGraphSettings, showGraphMode, applyYaml, applyAndCalculateYaml,
    hydrateBackgroundNode, commitScenario, scenarioEditCount, restoreVersion,
    undo, redo, captureDraftVersion,
    categoryTotals, visibleImpactCategories, toggleImpactCategory, categoryOrder,
  } = useGraphModel({
    resetCalculationState, markRevision, calculateSource,
    onResultsMarkdown: setResultsMarkdown, loadContributionGraphs,
  })

  // Re-render the markdown report when display precision changes.
  useEffect(() => {
    if (lcaResult) setResultsMarkdown(lcaResultToMarkdown(lcaResult, decimalPlaces, showAllDecimalPlaces))
  }, [decimalPlaces, showAllDecimalPlaces, lcaResult])

  useEffect(() => {
    if (view !== "graph" || !active) return
    let fitFrame = 0
    const resizeFrame = requestAnimationFrame(() => {
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.4, maxZoom: 0.85, duration: 250 }))
    })
    return () => {
      cancelAnimationFrame(resizeFrame)
      cancelAnimationFrame(fitFrame)
    }
  }, [active, fitView, view])
  useEffect(() => {
    if (!chatPortalTarget || view !== "graph" || !active) return
    let fitFrame = 0
    let previousWidth = chatPortalTarget.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width
      if (Math.abs(nextWidth - previousWidth) < 1) return
      previousWidth = nextWidth
      cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.4, maxZoom: 0.85 }))
    })
    observer.observe(chatPortalTarget)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(fitFrame)
    }
  }, [active, chatPortalTarget, fitView, view])
  useEffect(() => {
    if (view !== "graph" || !active) return
    let fitFrame = 0
    const onResize = () => {
      cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.4, maxZoom: 0.85, duration: 200 }))
    }
    window.addEventListener("resize", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      cancelAnimationFrame(fitFrame)
    }
  }, [active, fitView, view])
  useEffect(() => {
    if (view !== "graph" || !active || !inspectorOpen || !selected) return
    const frame = requestAnimationFrame(() => {
      // Only re-fit when the selected node is actually too close to (or
      // under) the inspector -- otherwise leave the viewport exactly as the
      // user left it (a manual zoom/pan should survive opening the panel).
      const nodeEl = document.querySelector(`.react-flow__node[data-id="${CSS.escape(selected.id)}"]`)
      const inspectorEl = document.querySelector(".inspector")
      if (nodeEl && inspectorEl) {
        const gap = inspectorEl.getBoundingClientRect().left - nodeEl.getBoundingClientRect().right
        if (gap >= 16) return
      }
      fitView({
        nodes: [{ id: selected.id }],
        padding: { top: 0.25, bottom: 0.25, left: 0.25, right: "360px" },
        maxZoom: 1,
        duration: 250,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [active, fitView, inspectorOpen, selected, view])
  // Two undo scopes exist and must not fight. The browser gives text inputs
  // per-keystroke undo for free; model undo steps between recorded versions.
  // Focus decides which one Cmd+Z drives, which also leaves the chat
  // composer's native undo alone -- what anyone would expect.
  useEffect(() => {
    if (!active) return
    const onKeyDown = (event: KeyboardEvent) => {
      const isUndoChord = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z"
      if (!isUndoChord) return
      const target = event.target
      const isTextField = target instanceof HTMLElement
        && (target.tagName === "TEXTAREA" || target.tagName === "INPUT" || target.isContentEditable)
      if (isTextField) return
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  })

  const cumulativeCategories = (() => {
    try {
      const source = parse(appliedYaml) as {
        lcia?: { contribution_graph?: { categories?: unknown } }
      }
      const configured = source.lcia?.contribution_graph?.categories
      if (Array.isArray(configured) && configured.every((item) => typeof item === "string")) {
        return configured
      }
    } catch {
      // Applied YAML was already validated; use the returned category labels.
    }
    return lcaResult
      ? Object.entries(lcaResult.lcia).filter(([, value]) => value.score !== 0).map(([label]) => label)
      : []
  })()

  const {
    primaryView, analysisView,
    templates, templateState,
    pendingConfirmationOpen,
    saveAsOpen, setSaveAsOpen, saveAsName, setSaveAsName, saveAsError, setSaveAsError,
    saveAsReturnFocusRef, navbarUploadRef,
    isDirty, canSave, canSaveAs, canDownload,
    loadYamlFile,
    openSaveAsDialog, saveSessionModel, saveAsSessionModel,
    downloadCurrentYaml, downloadTextFile,
    saveAsSessionModelWithName, isTransient, renameActiveDocument,
    requestAction, requestView, requestAssistantView,
    cancelPendingAction, discardAndContinue, saveAndContinue, saveAsAndContinue,
    setPendingAction,
  } = useModelWorkspace({
    setYamlError,
    applyYaml,
    applyAndCalculateYaml,
    calculateSource,
    loadContributionGraphs,
    setContributionError,
    cumulativeCategories,
  })

  const currentModelTitle = activeDocument?.title
    ?? (templateState === "unavailable" ? "Templates unavailable" : "Loading templates…")
  useEffect(() => onTitleChange(currentModelTitle), [currentModelTitle, onTitleChange])


  // Built from already-selected fields rather than a store selector: zustand
  // v5 runs selectors through useSyncExternalStore, so one returning a fresh
  // object on every call risks an infinite re-render.
  const documentSnapshot = useMemo(
    () => ({ activeDocument, sessionDocuments, yamlDraft, appliedYaml }),
    [activeDocument, sessionDocuments, yamlDraft, appliedYaml],
  )

  const connectionCount = edges.length
  // Multi-select is otherwise invisible unless you happen to notice the node
  // outlines, and the property editor deliberately stays closed for it.
  const selectedNodeCount = nodes.filter((node) => node.selected).length
  const hasCurrentResults = useProductGraphStore(selectHasCurrentResults)
  if (selected) lastSelectedRef.current = selected
  const inspectorSelection = selected ?? lastSelectedRef.current
  const selectedNode = inspectorSelection ? nodes.find((node) => node.id === inspectorSelection.id) : undefined
  const inputNodes = selectedNode ? edges
    .filter((edge) => edge.target === selectedNode.id)
    .map((edge) => nodes.find((node) => node.id === edge.source))
    .filter((node): node is Node<ProcessNodeData> => Boolean(node)) : []
  const outputNodes = selectedNode ? edges
    .filter((edge) => edge.source === selectedNode.id)
    .map((edge) => nodes.find((node) => node.id === edge.target))
    .filter((node): node is Node<ProcessNodeData> => Boolean(node)) : []

  const backgroundProcessing = nodes.some((node) => node.data.backgroundExploring || node.data.backgroundLoading)

  const assistantRuntime: AppToolRuntime = {
    activeView: view,
    hasCurrentResults,
    workspace: {
      activeDocument,
      sessionDocuments,
      yamlDirty: isDirty,
      yamlValid: (() => { try { parse(yamlDraft); return Boolean(yamlDraft.trim()) } catch { return false } })(),
      appliedRevision,
      calculatedRevision,
      calculationStatus,
      calculationError: resultsError,
      contributionLoading: loadingContributionKeys.size > 0,
      yamlDraft,
    },
    templates,
    result: lcaResult,
    graph: {
      nodes: nodes.filter((node) => !node.hidden).map((node) => ({
        id: node.id,
        label: node.data.label,
        kind: node.data.kind,
        detail: node.data.detail,
        color: node.data.color,
        scope: node.data.scope,
        inputCount: edges.filter((edge) => edge.target === node.id && !edge.hidden).length,
        outputCount: edges.filter((edge) => edge.source === node.id && !edge.hidden).length,
        emissionCount: node.data.emissions?.length ?? node.data.referenceEmissions?.length ?? 0,
        extractionCount: node.data.extractions?.length ?? node.data.referenceExtractions?.length ?? 0,
        biosphereCount: node.data.biosphere?.length ?? node.data.referenceBiosphere?.length ?? 0,
      })),
      connectionCount,
      mode: graphMode,
      orientation: graphOrientation,
      connectionStyle: graphConnectionStyle,
      showReferenceAmounts,
      maximumProcesses: graphMaxProcesses,
      selectedNodeId: selected?.id ?? null,
    },
    actions: {
      switchView: requestAssistantView,
      selectNode: (nodeId) => {
        const node = nodes.find((candidate) => candidate.id === nodeId && !candidate.hidden)
        if (!node) return
        setSelected({ id: node.id, label: node.data.label, kind: node.data.kind, detail: node.data.detail, color: node.data.color, scope: node.data.scope })
        requestView("graph")
        if (node.data.scope === "background") void hydrateBackgroundNode(node.id)
      },
      clearNodeSelection,
      setGraphDisplay: (settings) => {
        if (settings.mode) showGraphMode(settings.mode)
        if (settings.orientation) setGraphOrientation(settings.orientation)
        if (settings.connections) setGraphConnectionStyle(settings.connections)
        if (settings.showReferenceAmounts !== undefined) setReferenceAmountsVisible(settings.showReferenceAmounts)
        if (settings.maximumProcesses !== undefined) setGraphMaxProcesses(settings.maximumProcesses)
        if (settings.orientation || settings.connections || settings.maximumProcesses !== undefined) {
          applyGraphSettings({
            orientation: settings.orientation,
            connectionStyle: settings.connections,
            maximum: settings.maximumProcesses,
          })
        }
      },
      fitGraph: fit,
      calculateCurrentModel: () => { void calculateSource(appliedYaml, appliedRevision) },
      saveCurrentModel: saveSessionModel,
      saveModelAs: saveAsSessionModelWithName,
      openModel: (kind, id) => requestAction(kind === "template" ? { kind: "template", id } : { kind: "session", id }),
      newModel: () => requestAction({ kind: "new" }),
      downloadYaml: downloadCurrentYaml,
      exportResults: (format) => {
        if (!lcaResult) return
        const base = safeYamlFilename(currentModelTitle).replace(/\.ya?ml$/i, "")
        if (format === "json") downloadTextFile(JSON.stringify(lcaResult, null, 2), `${base}-lca-results.json`, "application/json")
        else downloadTextFile(resultsMarkdown, `${base}-lca-results.md`, "text/markdown")
      },
      deleteSessionModel: (id) => dispatchModelWorkspace({ type: "delete-session", id }),
      proposeYamlEdit: (yaml) => {
        // Record what is in the editor before the proposal overwrites it, so
        // there is always a restore point immediately in front of an opaque
        // change. Dedupe means this adds nothing when the draft was already
        // saved -- the automatic entry appears only when there is genuinely
        // uncommitted work to protect.
        captureDraftVersion()
        dispatchModelWorkspace({ type: "edit-draft", yaml, author: "assistant" })
        setYamlError("")
        setView("yaml")
      },
    },
  }

  return (
    <>
      {navbarTarget ? createPortal(<div className="desktop-navbar" aria-label="Application navigation">
        <CurrentModelTitle title={currentModelTitle} className="navbar-model-title" onRename={activeDocument?.kind === "session" ? renameActiveDocument : undefined} />
        <FileMenu
          activeDocument={activeDocument}
          templates={templates}
          sessionDocuments={sessionDocuments}
          canSave={canSave}
          canSaveAs={canSaveAs}
          canDownload={canDownload}
          onNew={() => requestAction({ kind: "new" })}
          onSelectTemplate={(id) => requestAction({ kind: "template", id })}
          onSelectSession={(id) => requestAction({ kind: "session", id })}
          onSave={saveSessionModel}
          onSaveAs={openSaveAsDialog}
          onUpload={() => requestAction({ kind: "upload" })}
          onDownload={downloadCurrentYaml}
        />
        <HistoryPanel versions={versions} current={documentSnapshot} onRestore={restoreVersion} />
        <input ref={navbarUploadRef} className="navbar-file-input" type="file" accept=".yaml,.yml,text/yaml" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; loadYamlFile(file) }} />
        <ToggleGroup type="single" value={primaryView} onValueChange={(next) => next && requestView(next as "graph" | "yaml")} className="desktop-primary-nav" aria-label="Primary views">
          <ToggleGroupItem value="yaml">Edit</ToggleGroupItem>
          <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
        </ToggleGroup>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className={`navbar-menu-trigger${analysisView || primaryView === "results" ? " is-active" : ""}`} variant="ghost" size="sm" aria-label="Results">Results<ChevronDown data-icon="inline-end" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="navbar-dropdown">
            <DropdownMenuLabel>Analysis views</DropdownMenuLabel>
            <DropdownMenuGroup>
              {([
                ["results", "LCA results"],
                ["inventory", "Inventory"],
                ["impact", "Impact analysis"],
                ["process", "Process results"],
                ["contribution", "Contributions"],
                ["sankey", "Sankey"],
                ["realtime", "Realtime"],
              ] as const).map(([resultView, label]) => {
                const selected = view === resultView
                return <DropdownMenuItem key={resultView} aria-current={selected ? "true" : undefined} onSelect={() => requestView(resultView)} disabled={resultView !== "results" && !hasCurrentResults}>
                  <span className="model-menu-item-title">{label}</span>{selected ? <Check className="model-menu-check" /> : null}
                </DropdownMenuItem>
              })}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {calculationInProgress ? <span className="calculation-message navbar-status" role="status" aria-label="LCA calculation in progress">Calculating…</span>
          : backgroundProcessing ? <span className="calculation-message navbar-status" role="status" aria-label="Background graph processing">Processing…</span> : null}
      </div>, navbarTarget) : null}
      <div className="canvas-wrap">
        <div className="canvas-head">
          <div className="canvas-actions">
            <div className="view-tabs">
              <div className="navigation-model-group">
                <CurrentModelTitle title={currentModelTitle} className="navigation-model-title" onRename={activeDocument?.kind === "session" ? renameActiveDocument : undefined} />
                <FileMenu
                  activeDocument={activeDocument}
                  templates={templates}
                  sessionDocuments={sessionDocuments}
                  canSave={canSave}
                  canSaveAs={canSaveAs}
                  canDownload={canDownload}
                  onNew={() => requestAction({ kind: "new" })}
                  onSelectTemplate={(id) => requestAction({ kind: "template", id })}
                  onSelectSession={(id) => requestAction({ kind: "session", id })}
                  onSave={saveSessionModel}
                  onSaveAs={openSaveAsDialog}
                  onUpload={() => requestAction({ kind: "upload" })}
                  onDownload={downloadCurrentYaml}
                />
              </div>
              {calculationInProgress ? <span className="calculation-message" role="status" aria-label="LCA calculation in progress">Calculating…</span>
                : backgroundProcessing ? <span className="calculation-message" role="status" aria-label="Background graph processing">Processing…</span> : null}
              <div className="view-tab-groups">
                <ToggleGroup type="single" value={primaryView} onValueChange={(next) => next && requestView(next as "graph" | "yaml" | "results")} className="inline-flex items-center" aria-label="Primary views">
                  <ToggleGroupItem value="yaml">Edit</ToggleGroupItem>
                  <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
                  <ToggleGroupItem value="results" aria-label="Results">Results</ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup type="single" value={analysisView} onValueChange={(next) => next && requestView(next as AnalysisView)} className="inline-flex items-center" aria-label="Result analysis views">
                  <ToggleGroupItem value="inventory" disabled={!hasCurrentResults}>Inventory</ToggleGroupItem>
                  <ToggleGroupItem value="impact" disabled={!hasCurrentResults}>Impact Analysis</ToggleGroupItem>
                  <ToggleGroupItem value="process" disabled={!hasCurrentResults}>Process Results</ToggleGroupItem>
                  <ToggleGroupItem value="contribution" disabled={!hasCurrentResults}>Contribution</ToggleGroupItem>
                  <ToggleGroupItem value="sankey" disabled={!hasCurrentResults}>Sankey Graph</ToggleGroupItem>
                  <ToggleGroupItem value="realtime" disabled={!hasCurrentResults}>Realtime</ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>
          </div>
        </div>
        {view === "graph" ? <><GraphCanvas
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          // Either right-rail panel shrinks the canvas, so neither covers the graph.
          inspectorOpen={inspectorOpen || (graphMode === "scaled" && scenarioEditCount > 0)} theme={theme}
          setSelected={setSelected} clearNodeSelection={clearNodeSelection}
          hydrateBackgroundNode={hydrateBackgroundNode} toggleExpanded={toggleExpanded}
          selectMode={selectMode}
        />
        <div ref={graphToolbarRef} className="graph-toolbar" data-draggable-panel aria-label="Graph tools" style={graphToolbarPosition ? { position: "fixed", left: graphToolbarPosition.left, top: graphToolbarPosition.top } : undefined}>
          <button type="button" className="toolbar-grip" aria-label="Move graph toolbar" onPointerDown={startGraphToolbarDrag}><GripHorizontal size={14} /></button>
          <div className="toolbar-group">
            <Popover modal open={graphSettingsOpen} onOpenChange={setGraphSettingsOpen}>
              <Tooltip>
                <PopoverTrigger asChild>
                  <TooltipTrigger asChild>
                    <Button aria-label="Graph settings" variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground"><Settings2 size={18} /></Button>
                  </TooltipTrigger>
                </PopoverTrigger>
                <TooltipContent side="right" sideOffset={8} className="tooltip">Graph settings</TooltipContent>
              </Tooltip>
              <PopoverContent
                className="graph-settings-picker"
                side="right"
                align="start"
                sideOffset={11}
                alignOffset={-7}
                onInteractOutside={(event) => {
                  const target = event.target
                  if (target instanceof Element && target.closest('[data-slot="select-content"]')) event.preventDefault()
                }}
              >
                <div className="graph-settings-title"><div><Settings2 size={15} /><span>Graph settings</span></div><Button variant="ghost" size="icon" type="button" onClick={() => setGraphSettingsOpen(false)} aria-label="Close graph settings"><X size={15} /></Button></div>
                <div className="graph-settings-grid">
                  <label><span>Max. number of processes</span><NumberStepper value={graphMaxProcesses} min={1} max={availableGraphProcessCount} step={1} integer inputLabel="Graph maximum processes" decrementLabel="Decrease graph maximum processes" incrementLabel="Increase graph maximum processes" onValueChange={(value) => { setGraphMaxProcesses(value); applyGraphSettings({ maximum: value }) }} /></label>
                  <label><span>Orientation</span><AppSelect value={graphOrientation} onValueChange={(value) => { const orientation = value as "vertical" | "horizontal"; setGraphOrientation(orientation); applyGraphSettings({ orientation }) }} label="Graph orientation" options={[{ value: "vertical", label: "Vertical" }, { value: "horizontal", label: "Horizontal" }]} /></label>
                  <label><span>Connections</span><AppSelect value={graphConnectionStyle} onValueChange={(value) => { const connectionStyle = value as "curved" | "straight" | "step"; setGraphConnectionStyle(connectionStyle); applyGraphSettings({ connectionStyle }) }} label="Graph connections" options={[{ value: "curved", label: "Curved" }, { value: "straight", label: "Straight" }, { value: "step", label: "Step" }]} /></label>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Select nodes (hold Alt and drag to zoom to an area)" pressed={selectMode} onClick={() => setSelectMode((current) => !current)}><MousePointer2 size={18} /></ToolButton>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Expand all activities" onClick={() => setAllExpanded(true)}><ChevronsUpDown size={18} /></ToolButton>
            <ToolButton label="Collapse all activities" onClick={() => setAllExpanded(false)}><ChevronsDownUp size={18} /></ToolButton>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Auto layout" onClick={relayout}><LayoutGrid size={18} /></ToolButton>
            <ToolButton label="Fit graph" onClick={fit}><Scan size={18} /></ToolButton>
          </div>
          <div className="toolbar-group">
            <ToolButton label="Zoom in" onClick={() => zoomIn({ duration: 200 })}><Plus size={18} /></ToolButton>
            <ToolButton label="Zoom out" onClick={() => zoomOut({ duration: 200 })}><Minus size={18} /></ToolButton>
          </div>
        </div>
        <div className="graph-mode-toolbar" aria-label="Graph display mode">
          <Button title={!hasCurrentResults ? "Scaled amounts will appear when the LCA calculation finishes" : undefined} variant="ghost" className={`graph-action ${graphMode === "scaled" ? "is-active" : ""}`} aria-pressed={graphMode === "scaled"} disabled={!hasCurrentResults} onClick={() => showGraphMode("scaled")}><Scan size={16} />Scaled Graph</Button>
          <Button variant="ghost" className={`graph-action ${graphMode === "structure" ? "is-active" : ""}`} aria-pressed={graphMode === "structure"} onClick={() => showGraphMode("structure")}><LayoutGrid size={16} />Structure Graph</Button>
        </div></> : view === "yaml" ? <YamlEditor
          yamlDraft={yamlDraft}
          yamlError={yamlError}
          isDirty={isDirty}
          isTransient={isTransient}
          isCalculating={isCalculating}
          activeDocument={activeDocument}
          canSaveAs={canSaveAs}
          draftAuthor={draftAuthor}
          remountKey={appliedRevision}
          onChange={(yaml) => { dispatchModelWorkspace({ type: "edit-draft", yaml }); setYamlError("") }}
          onSave={saveSessionModel}
          onSaveAs={openSaveAsDialog}
        /> : view === "inventory" ? <InventoryView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "impact" ? <ImpactAnalysisView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "process" && hasCurrentResults && lcaResult ? <ProcessResultsView result={lcaResult} yaml={appliedYaml} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "sankey" && hasCurrentResults && lcaResult ? <SankeyView result={lcaResult} loadContributionGraphs={loadContributionGraphs} /> : view === "realtime" ? <RealtimeView result={lcaResult} isCurrent={hasCurrentResults} error={resultsError} overrides={scenarioOverrides} onOverride={setScenarioOverride} onReset={resetScenario} onCommit={commitScenario} committing={calculationInProgress} /> : <div className="results-panel">
          <div className="results-panel-head">
            <div><strong>LCA Results</strong>{isCalculating ? <span className="calculation-message">Calculating…</span> : null}</div>
          </div>
          <div className="results-panel-body">
            {resultsError ? <div className="results-error"><strong>Calculation failed</strong><p>{resultsError}</p></div>
              : resultsMarkdown ? <article className="markdown-report"><ReactMarkdown remarkPlugins={[remarkGfm]}>{resultsMarkdown}</ReactMarkdown></article>
              : <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No LCA results yet</strong><p>Save a valid model to analyze its product graph.</p></div>}
          </div>
        </div>}
        {/* Scenario scores describe the scaled graph; in structure mode there
            are no amounts for them to relate to, so the panel is hidden. The
            edits themselves are kept, and reappear on returning to Scaled. */}
        {view === "graph" && graphMode === "scaled" && scenarioEditCount > 0 ? <ScenarioPanel
          editCount={scenarioEditCount}
          stacked={inspectorOpen}
          categoryTotals={categoryTotals}
          calculating={calculationInProgress}
          onReset={resetScenario}
          onCommit={commitScenario}
          categoryOrder={categoryOrder}
          visibleCategories={visibleImpactCategories}
          onToggleCategory={toggleImpactCategory}
        /> : null}
        {view === "graph" ? <div className="graph-meta">{nodes.length} nodes&nbsp;&nbsp;·&nbsp;&nbsp;{connectionCount} connections{selectedNodeCount > 1 ? <>&nbsp;&nbsp;·&nbsp;&nbsp;<strong>{selectedNodeCount} selected</strong></> : null}</div> : null}
      </div>

      {view === "graph" && inspectorSelection ? <Inspector
        selected={selected}
        inspectorSelection={inspectorSelection}
        selectedNode={selectedNode}
        inputNodes={inputNodes}
        outputNodes={outputNodes}
        graphMode={graphMode}
        showReferenceAmounts={showReferenceAmounts}
        setReferenceAmountsVisible={setReferenceAmountsVisible}
        clearNodeSelection={clearNodeSelection}
      /> : null}
      <AiChatPanel open={chatOpen} onOpenChange={onChatOpenChange} runtime={assistantRuntime} portalTarget={chatPortalTarget} />
      <UnsavedChangesDialog
        pendingConfirmationOpen={pendingConfirmationOpen}
        activeDocument={activeDocument} canSaveAs={canSaveAs}
        cancelPendingAction={cancelPendingAction}
        discardAndContinue={discardAndContinue}
        saveAndContinue={saveAndContinue}
        saveAsAndContinue={saveAsAndContinue}
      />
      <SaveAsDialog
        saveAsOpen={saveAsOpen} setSaveAsOpen={setSaveAsOpen}
        saveAsName={saveAsName} setSaveAsName={setSaveAsName}
        saveAsError={saveAsError} setSaveAsError={setSaveAsError}
        saveAsReturnFocusRef={saveAsReturnFocusRef}
        saveAsSessionModel={saveAsSessionModel}
        setPendingAction={setPendingAction}
      />
    </>
  )
}

function AppContent() {
  const [welcomeOpen, setWelcomeOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [workspaceTitle, setWorkspaceTitle] = useState("Loading product graphs…")
  const [navbarTarget, setNavbarTarget] = useState<HTMLDivElement | null>(null)
  const [chatPortalTarget, setChatPortalTarget] = useState<HTMLDivElement | null>(null)
  const { decimalPlaces, setDecimalPlaces, showAllDecimalPlaces, setShowAllDecimalPlaces, theme, setTheme } = useDisplaySettings()

  return (
    <TooltipProvider delayDuration={250}>
      <main className={`app-shell theme-${theme}${chatOpen ? " has-chat" : ""}`}>
        {welcomeOpen ? <WelcomePage onExplore={() => setWelcomeOpen(false)} /> : null}
        <div className="app-main-pane">
          <header className="topbar" hidden={welcomeOpen}>
          <div className="brand"><button className="brand-home" type="button" onClick={() => setWelcomeOpen(true)} aria-label="Open PRISM welcome page"><span className="brand-mark"><img src={prismLogoRound} alt="" aria-hidden="true" /></span></button><span className="brand-product-name"><span>PRISM</span><span className="brand-product-descriptor"> Life Cycle Assessment</span></span><span className="brand-separator">·</span><h1 className="brand-study-title">{workspaceTitle}</h1></div>
          <div ref={setNavbarTarget} className="navbar-portal-target" />
          <div className="top-actions">
            <Popover modal open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" className={`global-settings-trigger ${settingsOpen ? "is-active" : ""}`} type="button" aria-label="Global settings"><Settings2 size={16} /><span>Settings</span></Button>
              </PopoverTrigger>
              <PopoverContent className="global-settings-panel" side="bottom" align="end" sideOffset={3}>
                <div className="global-settings-title"><div><Settings2 size={15} /><span>Global settings</span></div><Button variant="ghost" size="icon" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close global settings"><X size={15} /></Button></div>
                <div className="global-setting-field">
                  <span>Decimal places</span>
                  <p>Applied to numerical results across the workspace.</p>
                  <label className="all-decimals-toggle"><Checkbox checked={showAllDecimalPlaces} onCheckedChange={(checked) => setShowAllDecimalPlaces(checked === true)} aria-label="Show all decimal places" /><span>Show all decimal places</span></label>
                  <NumberStepper value={decimalPlaces} min={0} max={8} step={1} integer disabled={showAllDecimalPlaces} inputLabel="Decimal places" decrementLabel="Decrease decimal places" incrementLabel="Increase decimal places" onValueChange={setDecimalPlaces} />
                </div>
                <div className="global-setting-field">
                  <span>Appearance</span>
                  <p>Choose the workspace color theme.</p>
                  <ToggleGroup type="single" value={theme} onValueChange={(value) => value && setTheme(value as "dark" | "light")} className="theme-options" aria-label="Appearance">
                    <ToggleGroupItem value="dark"><Moon size={14} />Dark</ToggleGroupItem>
                    <ToggleGroupItem value="light"><Sun size={14} />Light</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </PopoverContent>
            </Popover>
          </div>
          </header>
          {!welcomeOpen && !chatOpen ? (
            <button type="button" className="ai-chat-edge-tab" aria-label="Open AI assistant" aria-expanded={chatOpen} onClick={() => setChatOpen(true)}>
              <ChevronLeft size={14} aria-hidden="true" />
            </button>
          ) : null}

          <section className="workspace" hidden={welcomeOpen}>
            <ReactFlowProvider>
              <GraphEditor onTitleChange={setWorkspaceTitle} navbarTarget={navbarTarget} chatPortalTarget={chatPortalTarget} active={!welcomeOpen} chatOpen={chatOpen} onChatOpenChange={setChatOpen} />
            </ReactFlowProvider>
          </section>
        </div>
        <div ref={setChatPortalTarget} className="ai-chat-pane" aria-hidden={!chatOpen} />
      </main>
    </TooltipProvider>
  )
}

export default function App() {
  return <DisplaySettingsProvider><AppContent /></DisplaySettingsProvider>
}
