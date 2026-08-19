import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant,
  type Node,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import prismLogoRound from "./assets/prism-logo-round.png"
import {
  BarChart3, Bot, Box, Check, CopyPlus, Scan, LayoutGrid, ChevronDown, Globe2,
  ChevronsDownUp, ChevronsUpDown, Minus, Moon, MousePointer2, Plus, Save as SaveIcon, Search, Settings2, Sun, X,
} from "lucide-react"
import { parse } from "yaml"
import { Button } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { NumberStepper } from "@/components/NumberStepper"
import { AiChatPanel } from "@/components/AiChatPanel"
import { RealtimeView } from "@/components/RealtimeView"
import type { AppToolRuntime } from "@/ai/viewTools"
import { ProcessNode, type ProcessNodeData } from "./components/ProcessNode"
import {
  lcaResultToMarkdown,
} from "./lib/lcaApi"
import { applyScenarioToYaml, backgroundLinks } from "./lib/realtimeScore"
import { ImpactAnalysisView } from "@/components/views/ImpactAnalysisView"
import { AppSelect, CurrentModelTitle, ToolButton } from "@/components/common/AppControls"
import { ContributionView } from "@/components/views/ContributionView"
import { InventoryView } from "@/components/views/InventoryView"
import { ProcessResultsView } from "@/components/views/ProcessResultsView"
import { SankeyView } from "@/components/views/SankeyView"
import { FileMenu } from "@/components/workspace/FileMenu"
import { useCalculation } from "@/hooks/useCalculation"
import { useGraphModel } from "@/hooks/useGraphModel"
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


const nodeTypes = { process: ProcessNode }


function GraphEditor({ onTitleChange, navbarTarget, chatPortalTarget, active, chatOpen, onChatOpenChange }: { onTitleChange: (title: string) => void; navbarTarget: HTMLDivElement | null; chatPortalTarget: HTMLDivElement | null; active: boolean; chatOpen: boolean; onChatOpenChange: (open: boolean) => void }) {
  const { decimalPlaces, showAllDecimalPlaces, formatNumber, theme } = useDisplaySettings()
  const selected = useProductGraphStore((state) => state.selectedNode)
  const view = useProductGraphStore((state) => state.activeView)
  const activeDocument = useProductGraphStore((state) => state.activeDocument)
  const sessionDocuments = useProductGraphStore((state) => state.sessionDocuments)
  const yamlDraft = useProductGraphStore((state) => state.yamlDraft)
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
    query, setQuery, yamlError, setYamlError,
    availableGraphProcessCount,
    fitView, zoomIn, zoomOut, fit, relayout,
    toggleExpanded, setAllExpanded,
    applyGraphSettings, showGraphMode, applyYaml, applyAndCalculateYaml,
    hydrateBackgroundNode,
  } = useGraphModel({ resetCalculationState, markRevision, calculateSource, onResultsMarkdown: setResultsMarkdown })

  // Re-render the markdown report when display precision changes.
  useEffect(() => {
    if (lcaResult) setResultsMarkdown(lcaResultToMarkdown(lcaResult, decimalPlaces, showAllDecimalPlaces))
  }, [decimalPlaces, showAllDecimalPlaces, lcaResult])

  useEffect(() => {
    if (view !== "graph" || !active) return
    let fitFrame = 0
    const resizeFrame = requestAnimationFrame(() => {
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75, duration: 250 }))
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
      fitFrame = requestAnimationFrame(() => fitView({ padding: 0.35, maxZoom: 0.75 }))
    })
    observer.observe(chatPortalTarget)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(fitFrame)
    }
  }, [active, chatPortalTarget, fitView, view])
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

  const commitScenario = () => {
    if (!lcaResult) return
    const source = applyScenarioToYaml(appliedYaml, backgroundLinks(lcaResult), scenarioOverrides)
    if (source === appliedYaml) return
    dispatchModelWorkspace({ type: "edit-draft", yaml: source })
    const revision = applyYaml(source)
    if (revision === null) return
    void calculateSource(source, revision)
  }

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
    saveAsSessionModelWithName, isTransient,
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


  const connectionCount = edges.length
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
    },
  }

  return (
    <>
      {navbarTarget ? createPortal(<div className="desktop-navbar" aria-label="Application navigation">
        <CurrentModelTitle title={currentModelTitle} className="navbar-model-title" />
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
                <CurrentModelTitle title={currentModelTitle} className="navigation-model-title" />
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
        {view === "graph" ? <div className="search graph-search"><Search size={16} /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a node…" aria-label="Find a node" /><kbd>⌘ K</kbd></div> : null}
        {view === "graph" ? <><div className={`graph-viewport${inspectorOpen ? " has-inspector" : ""}`}><ReactFlow
          className="reactflow-canvas"
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => {
            setSelected({ id: node.id, label: node.data.label, kind: node.data.kind, detail: node.data.detail, color: node.data.color, scope: node.data.scope })
            if (node.data.scope === "background") void hydrateBackgroundNode(node.id)
          }}
          onNodeDoubleClick={(_, node) => toggleExpanded(node.id)}
          onPaneClick={clearNodeSelection}
          minZoom={0.05}
          maxZoom={2.4}
          zoomOnScroll={false}
          panOnScroll
          onInit={(instance) => requestAnimationFrame(() => requestAnimationFrame(() => instance.fitView({ padding: 0.35, maxZoom: 0.75 })))}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color={theme === "dark" ? "#242831" : "#cbd5e1"} />
        </ReactFlow></div>
        <div className="graph-toolbar" aria-label="Graph tools">
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
            <ToolButton label="Select"><MousePointer2 size={18} /></ToolButton>
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
        </div></> : view === "yaml" ? <div className="yaml-editor">
          <div className="yaml-editor-head">
            <div><strong>Product graph YAML</strong><span>{isTransient ? "Start writing YAML, or upload an existing file from the File menu." : activeDocument?.kind === "template" ? "Edit this template, then save a session copy." : "Edit the current session model."}</span></div>
          </div>
          <textarea value={yamlDraft} onChange={(event) => { dispatchModelWorkspace({ type: "edit-draft", yaml: event.target.value }); setYamlError("") }} spellCheck={false} aria-label="Product graph YAML" />
          <div className="yaml-editor-foot">
            <span className={yamlError ? "yaml-error" : isDirty ? "yaml-dirty" : ""}>{yamlError || (!yamlDraft.trim() ? "Start writing YAML, or upload a file from the File menu." : isDirty ? activeDocument?.kind === "session" ? "Unsaved changes. Save to update this session model." : "Unsaved draft. Save As to create a session model." : isCalculating ? "Calculating the saved YAML…" : activeDocument?.kind === "template" ? "Template loaded as an immutable example." : "Saved in this browser session.")}</span>
            {activeDocument?.kind === "session" && isDirty ? <Button size="sm" onClick={saveSessionModel}><SaveIcon data-icon="inline-start" />Save</Button>
              : activeDocument?.kind === "template" || isTransient ? <Button size="sm" disabled={!canSaveAs} onClick={openSaveAsDialog}><CopyPlus data-icon="inline-start" />Save As...</Button>
                : null}
          </div>
        </div> : view === "inventory" ? <InventoryView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError} /> : view === "impact" ? <ImpactAnalysisView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "process" && hasCurrentResults && lcaResult ? <ProcessResultsView result={lcaResult} yaml={appliedYaml} /> : view === "contribution" ? <ContributionView result={lcaResult} yaml={appliedYaml} isCurrent={hasCurrentResults} error={resultsError || contributionError} loadContributionGraphs={loadContributionGraphs} /> : view === "sankey" && hasCurrentResults && lcaResult ? <SankeyView result={lcaResult} loadContributionGraphs={loadContributionGraphs} /> : view === "realtime" ? <RealtimeView result={lcaResult} isCurrent={hasCurrentResults} error={resultsError} overrides={scenarioOverrides} onOverride={setScenarioOverride} onReset={resetScenario} onCommit={commitScenario} committing={calculationInProgress} /> : <div className="results-panel">
          <div className="results-panel-head">
            <div><strong>LCA Results</strong>{isCalculating ? <span className="calculation-message">Calculating…</span> : null}</div>
          </div>
          <div className="results-panel-body">
            {resultsError ? <div className="results-error"><strong>Calculation failed</strong><p>{resultsError}</p></div>
              : resultsMarkdown ? <article className="markdown-report"><ReactMarkdown remarkPlugins={[remarkGfm]}>{resultsMarkdown}</ReactMarkdown></article>
              : <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No LCA results yet</strong><p>Save a valid model to analyze its product graph.</p></div>}
          </div>
        </div>}
        {view === "graph" ? <div className="graph-meta">{nodes.length} nodes&nbsp;&nbsp;·&nbsp;&nbsp;{connectionCount} connections</div> : null}
      </div>

      {view === "graph" && inspectorSelection ? <aside className={`inspector${selected ? " is-open" : ""}`} aria-hidden={!selected} inert={!selected}>
        <>
          <div className="inspector-head"><span>NODE DETAILS</span><Button variant="ghost" size="icon" onClick={clearNodeSelection} aria-label="Close property editor" title="Close property editor"><X size={16} /></Button></div>
          <div className="node-icon" style={{ background: selectedNode?.data.color ?? inspectorSelection.color }}><Box size={22} /></div>
          <h2>{selectedNode?.data.label ?? inspectorSelection.label}</h2><p>{selectedNode?.data.detail ?? inspectorSelection.detail}</p>
          {graphMode === "structure" ? <Button variant="outline" size="sm" className="reference-amounts-toggle" aria-pressed={showReferenceAmounts} onClick={() => setReferenceAmountsVisible(!showReferenceAmounts)}>{showReferenceAmounts ? "Hide reference amounts" : "Reference amounts"}</Button> : null}
          {graphMode === "structure" && showReferenceAmounts && selectedNode ? <>
            <div className="property-section">
              <h3>Technosphere inputs</h3>
              {selectedNode.data.referenceInputs?.length ? selectedNode.data.referenceInputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)}{item.unit ? ` ${item.unit}` : ""}</strong></div>) : <p>No technosphere inputs</p>}
            </div>
            <div className="property-section">
              <h3>Reference output</h3>
              {selectedNode.data.referenceOutputs?.length ? selectedNode.data.referenceOutputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)}{item.unit ? ` ${item.unit}` : ""}</strong></div>) : <p>No production exchange</p>}
            </div>
            {selectedNode.data.referenceExtractions?.length ? <div className="property-section is-extraction">
              <h3>Resource extractions</h3>
              {selectedNode.data.referenceExtractions.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong></div>)}
            </div> : null}
            {selectedNode.data.referenceEmissions?.length ? <div className="property-section is-emission">
              <h3>Emissions to air</h3>
              {selectedNode.data.referenceEmissions.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong></div>)}
            </div> : null}
            {selectedNode.data.referenceBiosphere?.length ? <div className="property-section is-emission">
              <h3>Biosphere exchanges</h3>
              {selectedNode.data.referenceBiosphere.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span><strong>{formatNumber(item.amount ?? 0)}{item.unit ? ` ${item.unit}` : ""}</strong></div>)}
            </div> : null}
          </> : selectedNode?.data.scope === "background" ? <>
            {selectedNode.data.backgroundLoading ? <div className="property-section"><p>Loading unit process…</p></div> : null}
            {selectedNode.data.backgroundError ? <div className="property-section"><p className="property-error">{selectedNode.data.backgroundError}</p></div> : null}
            <div className="property-section">
              <h3>Direct inputs</h3>
              {selectedNode.data.inputs?.length ? selectedNode.data.inputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{formatNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>) : <p>No technosphere inputs</p>}
            </div>
            <div className="property-section">
              <h3>Reference output</h3>
              {selectedNode.data.outputs?.length ? selectedNode.data.outputs.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{formatNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>) : <p>No production exchange</p>}
            </div>
            {selectedNode.data.biosphere?.length ? <div className="property-section is-emission">
              <h3>Biosphere exchanges</h3>
              {selectedNode.data.biosphere.map((item, index) => <div className="property-row" key={`${item.label}-${index}`}><span>{item.label}</span>{item.amount === undefined ? null : <strong>{formatNumber(item.amount)}{item.unit ? ` ${item.unit}` : ""}</strong>}</div>)}
            </div> : null}
          </> : <>
            <div className="property-section">
              <h3>Input flows</h3>
              {inputNodes.length ? inputNodes.map((node) => <div className="property-row" key={node.id}><span>{node.data.label}</span><small>{node.data.scope ?? node.data.kind}</small></div>) : <p>No input flows</p>}
            </div>
            <div className="property-section">
              <h3>Output flows</h3>
              {outputNodes.length ? outputNodes.map((node) => <div className="property-row" key={node.id}><span>{node.data.label}</span><small>{node.data.scope ?? node.data.kind}</small></div>) : <p>No output flows</p>}
            </div>
            {selectedNode?.data.extractions?.length ? <div className="property-section is-extraction">
              <h3>Resource extractions</h3>
              {selectedNode.data.extractions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong> : null}</div>)}
            </div> : null}
            {selectedNode?.data.emissions?.length ? <div className="property-section is-emission">
              <h3>Emissions to air</h3>
              {selectedNode.data.emissions.map((item) => <div className="property-row" key={item.label}><span>{item.label}</span>{selectedNode.data.showAmounts !== false ? <strong>{formatNumber(item.amount ?? 0)} {item.unit}</strong> : null}</div>)}
            </div> : null}
          </>}
        </>
      </aside> : null}
      <AiChatPanel open={chatOpen} onOpenChange={onChatOpenChange} runtime={assistantRuntime} portalTarget={chatPortalTarget} />
      <AlertDialog open={pendingConfirmationOpen} onOpenChange={(open) => { if (!open) cancelPendingAction() }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved YAML changes</AlertDialogTitle>
            <AlertDialogDescription>
              {activeDocument?.kind === "session"
                ? `Save changes to "${activeDocument.title}" before continuing?`
                : "Save a copy before continuing?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelPendingAction}>Keep editing</AlertDialogCancel>
            <Button variant="destructive" onClick={discardAndContinue}>Discard changes</Button>
            {activeDocument?.kind === "session"
              ? <Button onClick={saveAndContinue}>Save</Button>
              : <Button disabled={!canSaveAs} onClick={saveAsAndContinue}>Save As...</Button>}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={saveAsOpen} onOpenChange={(open) => { setSaveAsOpen(open); if (!open) { setSaveAsError(""); setPendingAction(null) } }}>
        <DialogContent onCloseAutoFocus={(event) => {
          event.preventDefault()
          const fallback = [...document.querySelectorAll<HTMLElement>("[data-file-menu-trigger]")].find((element) => element.offsetParent !== null)
          const target = saveAsReturnFocusRef.current?.isConnected ? saveAsReturnFocusRef.current : fallback
          target?.focus()
        }}>
          <form className="save-as-form" onSubmit={saveAsSessionModel}>
            <DialogHeader>
              <DialogTitle>Save model as</DialogTitle>
              <DialogDescription>Create a writable model for this browser session. It will not survive a page refresh.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field data-invalid={Boolean(saveAsError)}>
                <FieldLabel htmlFor="save-as-model-name">Model name</FieldLabel>
                <Input id="save-as-model-name" value={saveAsName} maxLength={120} aria-invalid={Boolean(saveAsError)} autoFocus onChange={(event) => { setSaveAsName(event.target.value); setSaveAsError("") }} />
                <FieldError>{saveAsError}</FieldError>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setSaveAsOpen(false); setPendingAction(null) }}>Cancel</Button>
              <Button type="submit">Save As</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
            <Button variant="ghost" className={`ai-chat-trigger ${chatOpen ? "is-active" : ""}`} type="button" aria-label="AI assistant" aria-expanded={chatOpen} onClick={() => setChatOpen(true)}><Bot /><span>Assistant</span></Button>
            <Popover modal open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" className={`global-settings-trigger ${settingsOpen ? "is-active" : ""}`} type="button" aria-label="Global settings"><Globe2 size={16} /><span>Settings</span></Button>
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
