import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Position, useEdgesState, useNodesInitialized, useNodesState, useReactFlow, type Edge, type Node } from "@xyflow/react"
import type { ProcessNodeData } from "@/components/ProcessNode"
import { useDisplaySettings } from "@/lib/displaySettings"
import { chemicalFlowLabel } from "@/lib/flowLabels"
import { getBackgroundActivityDetails } from "@/lib/lcaApi"
import { layoutNodes, resolveNodeOverlaps } from "@/lib/layout"
import { buildGraphFromYaml, buildGraphStructure, decorateAmounts, nodeScopeColors } from "@/lib/yamlGraph"
import {
  applyScenarioToYaml, backgroundLinks, scenarioAmount, scenarioKey, scoreScenario,
  impactColor, solveForegroundCumulative, type ForegroundProcess,
} from "@/lib/realtimeScore"
import {
  incomingEdgesFor, inputHandleIdFor, populateExpandedConnections, targetExpandedInputRows,
} from "@/lib/graphNodes"
import { useProductGraphStore } from "@/state/productGraphStore"

const initialEdges: Edge[] = []
const initialNodes: Node<ProcessNodeData>[] = []

/**
 * The product graph's data model: nodes and edges, the operations that mutate
 * them, and applyYaml, which rebuilds the whole model from source.
 *
 * Background hydration lives here rather than in its own hook because
 * toggleExpanded, setAllExpanded, and showGraphMode all call
 * hydrateBackgroundNode while it needs this hook's setters and refs. Expanding
 * a background node is a graph-model mutation, so the two are one concern.
 *
 * yamlError is owned here because applyYaml is what decides whether the source
 * parses. useModelWorkspace receives the setter.
 */
export function useGraphModel({
  resetCalculationState,
  markRevision,
  calculateSource,
  onResultsMarkdown,
  loadContributionGraphs,
}: {
  resetCalculationState: () => void
  markRevision: (revision: number) => void
  calculateSource: (source: string, revision: number, openGraphWhenReady?: boolean) => void | Promise<void>
  onResultsMarkdown: (markdown: string) => void
  loadContributionGraphs: (categories: string[]) => Promise<unknown>
}) {
  const { decimalPlaces, showAllDecimalPlaces, formatNumber } = useDisplaySettings()
  const graphDecimalPlaces = showAllDecimalPlaces ? 20 : decimalPlaces
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<ProcessNodeData>>(layoutNodes(initialNodes, initialEdges))
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)
  const [query, setQuery] = useState("")
  const [yamlError, setYamlError] = useState("")
  // Which categories are drawn on the graph. Empty until a result arrives,
  // then all of them, which is what a first-time viewer wants to see.
  const [visibleImpactCategories, setVisibleImpactCategories] = useState<string[]>([])
  const appliedYaml = useProductGraphStore((state) => state.appliedYaml)
  const appliedRevision = useProductGraphStore((state) => state.appliedRevision)
  const calculatedRevision = useProductGraphStore((state) => state.calculatedRevision)
  const lcaResult = useProductGraphStore((state) => state.lcaResult)
  const graphMode = useProductGraphStore((state) => state.graphMode)
  const graphMaxProcesses = useProductGraphStore((state) => state.graphMaxProcesses)
  const graphOrientation = useProductGraphStore((state) => state.graphOrientation)
  const graphConnectionStyle = useProductGraphStore((state) => state.graphConnectionStyle)
  const selected = useProductGraphStore((state) => state.selectedNode)
  const scenarioOverrides = useProductGraphStore((state) => state.scenarioOverrides)
  const scenarioCommitRevision = useProductGraphStore((state) => state.scenarioCommitRevision)
  const {
    applySource, applyScenarioSource, setGraphMode, setGraphMaxProcesses, setReferenceAmountsVisible,
    requestViewChange: setView, setScenarioOverride, dispatchWorkspace,
    commitVersion, restoreVersion: restoreVersionInStore,
  } = useProductGraphStore((state) => state.actions)

  const foldDirectionRef = useRef<"upstream" | "downstream">("upstream")
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  nodesRef.current = nodes
  edgesRef.current = edges
  const { fitView, zoomIn, zoomOut } = useReactFlow()

  // Fresh nodes are laid out before they have ever been rendered, so dagre
  // spaces them using the NODE_WIDTH/NODE_HEIGHT guess rather than each
  // label's real size -- long labels can then overlap their neighbors.
  // useNodesInitialized flips false -> true whenever nodes are newly added
  // and then measured (initial load, or a background branch expanding);
  // relaying out only on that transition corrects the guessed positions
  // without re-running on every render or fighting a manual drag in between.
  const nodesInitialized = useNodesInitialized()
  const wasNodesInitializedRef = useRef(false)
  useEffect(() => {
    if (nodesInitialized && !wasNodesInitializedRef.current) {
      setNodes((current) => layoutNodes(current, edgesRef.current, { orientation: graphOrientation }))
    }
    wasNodesInitializedRef.current = nodesInitialized
  }, [graphOrientation, nodesInitialized, setNodes])

  const hydrateBackgroundNode = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
    if (!node || node.data.scope !== "background" || !node.data.database || node.data.backgroundLoaded || node.data.backgroundLoading) return
    setNodes((current) => current.map((candidate) => candidate.id === nodeId
      ? { ...candidate, data: { ...candidate.data, backgroundLoading: true, backgroundError: undefined } }
      : candidate))
    try {
      const details = await getBackgroundActivityDetails({
        database: node.data.database,
        code: node.data.code,
        name: node.data.label,
        location: node.data.location,
      })
      const production = details.exchanges.find((exchange) => exchange.exchange_type === "production")
      const productionAmount = production?.amount ?? 1
      if (productionAmount === 0) throw new Error("The background activity has a zero production amount and cannot be scaled.")
      const activityScale = node.data.showAmounts ? (node.data.backgroundDemand ?? 0) / productionAmount : null
      const displayAmount = (amount: number) => activityScale === null ? undefined : Number((amount * activityScale).toPrecision(8))
      const inputs = details.exchanges.filter((exchange) => exchange.exchange_type === "technosphere").map((exchange) => ({
        label: exchange.input_name,
        kind: "background input",
        color: nodeScopeColors.background,
        amount: displayAmount(exchange.amount),
        unit: exchange.unit ?? undefined,
      }))
      const outputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name,
        kind: "reference output",
        color: nodeScopeColors.background,
        amount: displayAmount(exchange.amount),
        unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const biosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name),
        amount: displayAmount(exchange.amount),
        unit: exchange.unit ?? "",
      }))
      const referenceInputs = details.exchanges.filter((exchange) => exchange.exchange_type === "technosphere").map((exchange) => ({
        label: exchange.input_name, kind: "background input", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? undefined,
      }))
      const referenceOutputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name, kind: "reference output", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const referenceBiosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name), amount: exchange.amount, unit: exchange.unit ?? "",
      }))
      setNodes((current) => current.map((candidate) => candidate.id === nodeId && candidate.data.showAmounts === node.data.showAmounts
        ? { ...candidate, data: {
            ...candidate.data,
            label: details.name,
            detail: `Background activity · ${details.database}${details.location ? ` · ${details.location}` : ""}`,
            code: details.code,
            location: details.location ?? undefined,
            inputs,
            outputs,
            biosphere,
            referenceInputs,
            referenceOutputs,
            referenceBiosphere,
            backgroundLoading: false,
            backgroundLoaded: true,
          } }
        : candidate))
    } catch (error) {
      setNodes((current) => current.map((candidate) => candidate.id === nodeId && candidate.data.showAmounts === node.data.showAmounts
        ? { ...candidate, data: {
            ...candidate.data,
            backgroundLoading: false,
            backgroundError: error instanceof Error ? error.message : "Could not load this background activity.",
          } }
        : candidate))
    }
  }, [nodesRef, setNodes])

  const toggleBackgroundBranch = useCallback(async (nodeId: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === nodeId)
    if (!node || node.data.scope !== "background" || !node.data.database || node.data.backgroundExploring) return

    if (node.data.backgroundExplored) {
      const descendants = new Set<string>()
      let changed = true
      while (changed) {
        changed = false
        nodesRef.current.forEach((candidate) => {
          if (candidate.data.backgroundParentId === nodeId || (candidate.data.backgroundParentId && descendants.has(candidate.data.backgroundParentId))) {
            if (!descendants.has(candidate.id)) { descendants.add(candidate.id); changed = true }
          }
        })
      }
      const nextNodes = nodesRef.current
        .filter((candidate) => !descendants.has(candidate.id))
        .map((candidate) => candidate.id === nodeId ? { ...candidate, data: { ...candidate.data, backgroundExplored: false } } : candidate)
      const nextEdges = edgesRef.current.filter((edge) => !descendants.has(edge.source) && !descendants.has(edge.target))
      setNodes(nextNodes)
      setEdges(nextEdges)
      return
    }

    setNodes((current) => current.map((candidate) => candidate.id === nodeId
      ? { ...candidate, data: { ...candidate.data, backgroundLoading: true, backgroundExploring: true, backgroundError: undefined } }
      : candidate))
    try {
      const details = await getBackgroundActivityDetails({
        database: node.data.database,
        code: node.data.code,
        name: node.data.label,
        location: node.data.location,
      })
      const production = details.exchanges.find((exchange) => exchange.exchange_type === "production")
      const productionAmount = production?.amount ?? 1
      if (productionAmount === 0) throw new Error("The background activity has a zero production amount and cannot be scaled.")
      const activityScale = (node.data.backgroundDemand ?? 1) / productionAmount
      const scaled = (amount: number) => Number((amount * activityScale).toPrecision(8))
      const technosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "technosphere")
      const childNodes: Node<ProcessNodeData>[] = technosphere.map((exchange, index) => {
        const crossAxisOffset = (index - (technosphere.length - 1) / 2) * 420
        return {
          id: `${nodeId}::background::${exchange.input_database}::${exchange.input_code}`,
          type: "process",
          position: graphOrientation === "vertical"
            ? { x: node.position.x + crossAxisOffset, y: node.position.y + 650 }
            : { x: node.position.x - 650, y: node.position.y + crossAxisOffset },
          sourcePosition: graphOrientation === "vertical" ? Position.Top : Position.Right,
          targetPosition: graphOrientation === "vertical" ? Position.Bottom : Position.Left,
          data: {
          label: exchange.input_name,
          kind: "process",
          detail: `Background activity · ${exchange.input_database}${exchange.input_location ? ` · ${exchange.input_location}` : ""}`,
          color: nodeScopeColors.background,
          scope: "background",
          database: exchange.input_database,
          code: exchange.input_code,
          location: exchange.input_location ?? undefined,
          backgroundDemand: scaled(exchange.amount),
          backgroundDemandUnit: exchange.unit ?? undefined,
          backgroundParentId: nodeId,
          },
        }
      })
      const childEdges: Edge[] = technosphere.map((exchange, index) => {
        const amount = scaled(exchange.amount)
        return {
          id: `${nodeId}::background-edge::${index}::${exchange.input_code}`,
          source: `${nodeId}::background::${exchange.input_database}::${exchange.input_code}`,
          target: nodeId,
          label: `${exchange.input_product ?? exchange.input_name} · ${formatNumber(amount)}${exchange.unit ? ` ${exchange.unit}` : ""}`,
          type: graphConnectionStyle === "curved" ? "default" : graphConnectionStyle === "straight" ? "straight" : "smoothstep",
          style: { stroke: "#2563eb", strokeWidth: 1.5 },
          labelStyle: { fill: "#9aa2ae", fontSize: 12, fontWeight: 650 },
          labelBgStyle: { fill: "#111318", fillOpacity: .92 },
          labelBgPadding: [5, 3],
          labelBgBorderRadius: 4,
        }
      })
      const inputs = technosphere.map((exchange) => ({
        label: exchange.input_name, kind: "background input", color: nodeScopeColors.background,
        amount: scaled(exchange.amount), unit: exchange.unit ?? undefined,
      }))
      const outputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name, kind: "reference output", color: nodeScopeColors.background,
        amount: scaled(exchange.amount), unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const biosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name), amount: scaled(exchange.amount), unit: exchange.unit ?? "",
      }))
      const referenceInputs = technosphere.map((exchange) => ({
        label: exchange.input_name, kind: "background input", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? undefined,
      }))
      const referenceOutputs = details.exchanges.filter((exchange) => exchange.exchange_type === "production").map((exchange) => ({
        label: exchange.input_product ?? exchange.input_name, kind: "reference output", color: nodeScopeColors.background,
        amount: exchange.amount, unit: exchange.unit ?? details.unit ?? node.data.backgroundDemandUnit,
      }))
      const referenceBiosphere = details.exchanges.filter((exchange) => exchange.exchange_type === "biosphere").map((exchange) => ({
        label: chemicalFlowLabel(exchange.input_name), amount: exchange.amount, unit: exchange.unit ?? "",
      }))
      const currentNodes = nodesRef.current.filter((candidate) => candidate.id !== nodeId && candidate.data.backgroundParentId !== nodeId)
      const updatedParent: Node<ProcessNodeData> = {
        ...node,
        data: {
          ...node.data,
          label: details.name,
          detail: `Background activity · ${details.database}${details.location ? ` · ${details.location}` : ""}`,
          code: details.code,
          location: details.location ?? undefined,
          inputs,
          outputs,
          biosphere,
          referenceInputs,
          referenceOutputs,
          referenceBiosphere,
          backgroundLoading: false,
          backgroundExploring: false,
          backgroundLoaded: true,
          backgroundExplored: true,
        },
      }
      const nextNodes = resolveNodeOverlaps([...currentNodes, updatedParent, ...childNodes])
      const nextEdges = [...edgesRef.current.filter((edge) => !edge.id.startsWith(`${nodeId}::background-edge::`)), ...childEdges]
      setNodes(nextNodes)
      setEdges(nextEdges)
    } catch (error) {
      setNodes((current) => current.map((candidate) => candidate.id === nodeId
        ? { ...candidate, data: {
            ...candidate.data,
            backgroundLoading: false,
            backgroundExploring: false,
            backgroundError: error instanceof Error ? error.message : "Could not load this background activity.",
          } }
        : candidate))
    }
  }, [edgesRef, formatNumber, graphConnectionStyle, graphOrientation, nodesRef, setEdges, setNodes])
  const availableGraphProcessCount = (() => {
    try {
      return buildGraphFromYaml(appliedYaml, "structure").nodes.filter((node) => node.data.scope !== "background").length
    } catch {
      return Math.max(1, graphMaxProcesses)
    }
  })()

  useEffect(() => setGraphMaxProcesses(availableGraphProcessCount), [availableGraphProcessCount, setGraphMaxProcesses])
  useEffect(() => setReferenceAmountsVisible(false), [graphMode, selected?.id, setReferenceAmountsVisible])
  // Parsing the YAML is the expensive half, and a drag never changes it.
  const structure = useMemo(() => {
    try { return buildGraphStructure(appliedYaml) } catch { return null }
  }, [appliedYaml])

  // Everything the commit needs is read through a ref rather than captured in
  // the dependency list. calculateSource and loadContributionGraphs are new
  // functions on every render, so depending on them would make commitScenario
  // unstable, which would make the scenario memo unstable, which would make
  // the decoration effect setEdges on every render -- an infinite loop.
  const commitInputsRef = useRef({
    appliedYaml, lcaResult, scenarioOverrides,
    calculateSource, loadContributionGraphs, dispatchWorkspace,
    applyScenarioSource, markRevision,
  })
  commitInputsRef.current = {
    appliedYaml, lcaResult, scenarioOverrides,
    calculateSource, loadContributionGraphs, dispatchWorkspace,
    applyScenarioSource, markRevision,
  }

  // Dragging an edge or moving a slider only writes a scenario override. This
  // is the one path that turns those overrides into YAML, and it runs on an
  // explicit Save to File press -- never on drag release -- so there is no
  // burst to debounce.
  //
  // Save to File saves: the draft, the applied source, and the session
  // document all move together, so the editor does not report unsaved changes
  // for an edit the user just committed.
  const commitScenario = useCallback(() => {
    const current = commitInputsRef.current
    if (!current.lcaResult) return
    const source = applyScenarioToYaml(
      current.appliedYaml, backgroundLinks(current.lcaResult), current.scenarioOverrides,
    )
    if (source === current.appliedYaml) return
    // The new result_id correctly invalidates these, so remember what was
    // loaded and ask for it again; otherwise an open Contribution view goes
    // blank after every commit.
    const loadedCategories = current.lcaResult.contribution_graphs.map((graph) => graph.label)
    current.dispatchWorkspace({ type: "edit-draft", yaml: source })
    // A no-op unless the active document is a writable session model, which it
    // is for every template copy, upload, and Save As.
    current.dispatchWorkspace({ type: "commit-active-session", yaml: source })
    const revision = current.applyScenarioSource(source)
    current.markRevision(revision)
    void Promise.resolve(current.calculateSource(source, revision)).then(() => {
      if (loadedCategories.length) void current.loadContributionGraphs(loadedCategories).catch(() => {})
    })
  }, [])

  // Only links the engine published intensities for can be scored locally, so
  // only those become draggable.
  const scenarioEditCount = useMemo(() => {
    const rows = lcaResult?.background_link_intensities ?? []
    return rows.filter((row) => {
      const override = scenarioOverrides[scenarioKey(row)]
      return Number.isFinite(override) && override !== row.amount
    }).length
  }, [lcaResult, scenarioOverrides])

  // Every foreground node's cumulative impact, re-solved locally. A background
  // amount edit only moves the right hand side, so this stays exact mid-drag.
  const foregroundImpacts = useMemo(() => {
    if (!structure || !lcaResult) return {}
    try {
      return solveForegroundCumulative(
        structure.graph.processes as unknown as ForegroundProcess[], lcaResult, scenarioOverrides,
      )
    } catch { return {} }
  }, [lcaResult, scenarioOverrides, structure])

  // A boundary provider's own contribution: amount x consumer scale x intensity.
  const backgroundImpacts = useMemo(() => {
    const out: Record<string, Array<{ label: string; unit: string; cumulative: number; percentage: number | null }>> = {}
    if (!lcaResult) return out
    // A provider consumed by several processes gets the SUM of those links.
    // Grid electricity in the cotton tote feeds three stages; assigning rather
    // than accumulating would show only the last of them.
    for (const link of backgroundLinks(lcaResult)) {
      const scale = lcaResult.scaling_vector[link.process_name] ?? 0
      const amount = scenarioAmount(link, scenarioOverrides)
      const rows = out[link.flow] ?? Object.entries(lcaResult.lcia).map(([label, impact]) => (
        { label, unit: impact.unit, cumulative: 0, percentage: null as number | null }
      ))
      for (const row of rows) {
        row.cumulative += scale * amount * (link.intensities[row.label] ?? 0)
        const total = lcaResult.lcia[row.label]?.score ?? 0
        row.percentage = total ? (row.cumulative / total) * 100 : null
      }
      out[link.flow] = rows
    }
    return out
  }, [lcaResult, scenarioOverrides])

  const categoryTotals = useMemo(
    () => (lcaResult ? scoreScenario(lcaResult, scenarioOverrides) : []),
    [lcaResult, scenarioOverrides],
  )

  const categoryOrder = useMemo(() => Object.keys(lcaResult?.lcia ?? {}), [lcaResult])
  useEffect(() => { setVisibleImpactCategories(categoryOrder) }, [categoryOrder])
  const toggleImpactCategory = useCallback((label: string) => {
    setVisibleImpactCategories((current) => current.includes(label)
      ? current.filter((item) => item !== label)
      : categoryOrder.filter((item) => current.includes(item) || item === label))
  }, [categoryOrder])

  // Paint each activity's own contribution onto its node. Impacts are merged
  // into existing node data rather than rebuilding nodes, so positions and
  // expansion state survive.
  useEffect(() => {
    const editing = graphMode === "scaled" && scenarioEditCount > 0
    const active = editing ? visibleImpactCategories : []
    setNodes((current) => {
      let changed = false
      const next = current.map((node) => {
        const rows = node.data.scope === "background"
          ? backgroundImpacts[node.data.label] ?? []
          : foregroundImpacts[node.data.label] ?? []
        const impacts = active.length
          ? rows.filter((row) => active.includes(row.label)).map((row) => ({
              label: row.label,
              value: row.cumulative.toFixed(graphDecimalPlaces > 6 ? 6 : graphDecimalPlaces),
              color: impactColor(categoryOrder.indexOf(row.label)),
            }))
          : undefined
        const before = JSON.stringify(node.data.impacts ?? null)
        const after = JSON.stringify(impacts ?? null)
        if (before === after) return node
        changed = true
        return { ...node, data: { ...node.data, impacts } }
      })
      return changed ? next : current
    })
  }, [backgroundImpacts, categoryOrder, foregroundImpacts, graphDecimalPlaces, graphMode, nodes, scenarioEditCount, setNodes, visibleImpactCategories])

  const scenario = useMemo(() => {
    const rows = lcaResult?.background_link_intensities ?? []
    return {
      overrides: scenarioOverrides,
      draggableKeys: new Set(rows.map(scenarioKey)),
      baselineAmounts: Object.fromEntries(rows.map((row) => [scenarioKey(row), row.amount])),
      onChange: setScenarioOverride,
    }
  }, [lcaResult, scenarioOverrides, setScenarioOverride])

  useEffect(() => {
    if (!structure) return
    try {
      // Hold the previous result while a scenario commit is in flight; its
      // scaling vector is unchanged by a background-amount edit.
      const resultIsUsable = calculatedRevision === appliedRevision || scenarioCommitRevision === appliedRevision
      const currentResult = resultIsUsable ? lcaResult : null
      const mode = graphMode === "scaled" && currentResult ? "scaled" : "structure"
      const refreshed = decorateAmounts(structure, {
        mode,
        scalingVector: currentResult?.scaling_vector,
        decimalPlaces: graphDecimalPlaces,
        scenario,
      })
      // Carry decoration onto the positioned edges; never replace them, so
      // React Flow keeps its layout and the graph does not jump mid-drag.
      const byId = new Map(refreshed.edges.map((edge) => [edge.id, edge]))
      setEdges((current) => current.map((edge) => {
        const next = byId.get(edge.id)
        return next ? { ...edge, label: next.label, type: next.type, data: next.data } : edge
      }))
    } catch {
      // Keep the currently displayed graph intact if the applied source cannot be rebuilt.
    }
  }, [appliedRevision, calculatedRevision, graphDecimalPlaces, graphMode, lcaResult, scenario, scenarioCommitRevision, setEdges, structure])




  const removeNode = useCallback((id: string) => {
    const folded = new Set<string>()
    const visit = (nodeId: string) => {
      edgesRef.current.filter((edge) => foldDirectionRef.current === "upstream" ? edge.target === nodeId : edge.source === nodeId).forEach((edge) => {
        const nextId = foldDirectionRef.current === "upstream" ? edge.source : edge.target
        if (!folded.has(nextId)) { folded.add(nextId); visit(nextId) }
      })
    }
    visit(id)
    if (!folded.size) return
    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, canRestore: true } }
      : folded.has(node.id) ? { ...node, hidden: true } : node))
    setEdges((current) => current.map((edge) => folded.has(edge.source) || folded.has(edge.target) ? { ...edge, hidden: true } : edge))
  }, [setNodes, setEdges])

  const restoreNode = useCallback((id: string) => {
    const depths = new Map<string, number>()
    const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }]
    while (queue.length) {
      const current = queue.shift()!
      edgesRef.current.filter((edge) => foldDirectionRef.current === "upstream" ? edge.target === current.id : edge.source === current.id).forEach((edge) => {
        const nextId = foldDirectionRef.current === "upstream" ? edge.source : edge.target
        const nextDepth = current.depth + 1
        const knownDepth = depths.get(nextId)
        if (knownDepth === undefined || nextDepth < knownDepth) {
          depths.set(nextId, nextDepth)
          queue.push({ id: nextId, depth: nextDepth })
        }
      })
    }
    const hiddenDownstream = nodesRef.current.filter((node) => node.hidden && depths.has(node.id))
    if (!hiddenDownstream.length) return
    const nextDepth = Math.min(...hiddenDownstream.map((node) => depths.get(node.id)!))
    const revealIds = new Set(hiddenDownstream.filter((node) => depths.get(node.id) === nextDepth).map((node) => node.id))
    const remainingAfterReveal = hiddenDownstream.some((node) => !revealIds.has(node.id))
    const hiddenAfterReveal = new Set(nodesRef.current.filter((node) => node.hidden && !revealIds.has(node.id)).map((node) => node.id))

    setNodes((current) => current.map((node) => node.id === id
      ? { ...node, data: { ...node.data, canRestore: remainingAfterReveal } }
      : revealIds.has(node.id) ? {
          ...node,
          hidden: false,
          data: {
            ...node.data,
            canRestore: edgesRef.current.some((edge) => foldDirectionRef.current === "upstream"
              ? edge.target === node.id && hiddenAfterReveal.has(edge.source)
              : edge.source === node.id && hiddenAfterReveal.has(edge.target)),
          },
        } : node))
    setEdges((current) => current.map((edge) => depths.has(edge.source) || depths.has(edge.target) || (foldDirectionRef.current === "upstream" ? edge.target === id : edge.source === id)
      ? { ...edge, hidden: hiddenAfterReveal.has(edge.source) || hiddenAfterReveal.has(edge.target) }
      : edge))
  }, [setEdges, setNodes])

  useEffect(() => {
    setNodes((current) => current.map((node) => (
      node.data.onRemove === removeNode && node.data.onRestore === restoreNode && node.data.canFold === edges.some((edge) => (
        foldDirectionRef.current === "upstream" ? edge.target === node.id : edge.source === node.id
      ))
        ? node
        : { ...node, data: {
            ...node.data,
            onRemove: removeNode,
            onRestore: restoreNode,
            canFold: edges.some((edge) => foldDirectionRef.current === "upstream" ? edge.target === node.id : edge.source === node.id),
          } }
    )))
  }, [edges, removeNode, restoreNode, setNodes])

  useEffect(() => {
    const term = query.trim().toLowerCase()
    if (!term) {
      setNodes((current) => current.map((node) => (node.data.faded ? { ...node, data: { ...node.data, faded: false } } : node)))
      setEdges((current) => current.map((edge) => (edge.style?.opacity ? { ...edge, style: { ...edge.style, opacity: 1 } } : edge)))
      return
    }
    const matchedIds = new Set(nodes.filter((node) => node.data.label.toLowerCase().includes(term)).map((node) => node.id))
    const connectedIds = new Set(matchedIds)
    edges.forEach((edge) => {
      if (matchedIds.has(edge.source) || matchedIds.has(edge.target)) { connectedIds.add(edge.source); connectedIds.add(edge.target) }
    })
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, faded: !connectedIds.has(node.id) } })))
    setEdges((current) => current.map((edge) => ({ ...edge, style: { ...edge.style, opacity: connectedIds.has(edge.source) && connectedIds.has(edge.target) ? 1 : 0.12 } })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  useEffect(() => {
    setNodes((current) => {
      let changed = false
      const next = current.map((node) => {
        if (node.data.scope !== "background" || node.data.onToggleBackground === toggleBackgroundBranch) return node
        changed = true
        return { ...node, data: { ...node.data, onToggleBackground: toggleBackgroundBranch } }
      })
      return changed ? next : current
    })
  }, [nodes, setNodes, toggleBackgroundBranch])

  const toggleExpanded = useCallback((nodeId: string) => {
    const target = nodesRef.current.find((node) => node.id === nodeId)
    const expanding = !target?.data.expanded
    setNodes((current) => {
      const byId = new Map(current.map((node) => [node.id, node]))
      return current.map((node) => {
        if (node.id !== nodeId) return node
        if (node.data.scope === "background") return { ...node, data: { ...node.data, expanded: !node.data.expanded } }
        const flowItem = (id: string) => {
          const connected = byId.get(id)
          return connected ? { label: connected.data.label, kind: connected.data.scope ?? connected.data.kind, color: connected.data.color } : null
        }
        const inputs = incomingEdgesFor(nodeId, edges, byId).map((edge) => {
          const item = flowItem(edge.source)
          return item ? { ...item, handleId: inputHandleIdFor(edge.id) } : null
        }).filter((item): item is NonNullable<typeof item> => item !== null)
        const outputs = edges.filter((edge) => edge.source === nodeId).map((edge) => flowItem(edge.target)).filter((item): item is NonNullable<typeof item> => item !== null)
        return { ...node, data: { ...node.data, expanded: !node.data.expanded, inputs, outputs } }
      })
    })
    if (target?.data.scope !== "background") {
      setEdges((current) => current.map((edge) => edge.target === nodeId
        ? { ...edge, targetHandle: expanding ? inputHandleIdFor(edge.id) : undefined }
        : edge))
    }
    if (target?.data.scope === "background" && !target.data.expanded) void hydrateBackgroundNode(nodeId)
    // The toggled node's rendered size just changed (collapsed <-> expanded),
    // so its dagre-computed slot no longer matches; relay out once the new
    // size has been measured, or it can overlap its neighbors.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setNodes((current) => layoutNodes(current, edgesRef.current, { orientation: graphOrientation }))
    }))
  }, [edges, graphOrientation, hydrateBackgroundNode, setEdges, setNodes])

  const setAllExpanded = useCallback((expanded: boolean) => {
    const currentEdges = edgesRef.current
    const nodesById = new Map(nodesRef.current.map((node) => [node.id, node]))
    setNodes((current) => {
      const updated = current.map((node) => node.data.expanded === expanded
        ? node
        : { ...node, data: { ...node.data, expanded } })
      return expanded ? populateExpandedConnections(updated, currentEdges) : updated
    })
    setEdges((current) => current.map((edge) => ({
      ...edge,
      targetHandle: expanded && nodesById.get(edge.target)?.data.scope !== "background"
        ? inputHandleIdFor(edge.id)
        : undefined,
    })))
    if (expanded) {
      nodesRef.current
        .filter((node) => node.data.scope === "background")
        .forEach((node) => void hydrateBackgroundNode(node.id))
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setNodes((current) => layoutNodes(current, edgesRef.current, { orientation: graphOrientation }))
    }))
  }, [graphOrientation, hydrateBackgroundNode, setEdges, setNodes])

  const fit = () => fitView({ padding: 0.4, maxZoom: 0.85, duration: 350 })
  const relayout = () => {
    setNodes((current) => layoutNodes(current, edges, { orientation: graphOrientation }))
    requestAnimationFrame(fit)
  }
  const applyGraphSettings = ({
    maximum = graphMaxProcesses,
    orientation = graphOrientation,
    connectionStyle = graphConnectionStyle,
  }: {
    maximum?: number
    orientation?: "vertical" | "horizontal"
    connectionStyle?: "curved" | "straight" | "step"
  }) => {
    try {
      const currentResult = calculatedRevision === appliedRevision ? lcaResult : null
      const mode = graphMode === "scaled" && currentResult ? "scaled" : "structure"
      const parsed = buildGraphFromYaml(appliedYaml, mode, currentResult?.scaling_vector, graphDecimalPlaces)
      const foreground = parsed.nodes.filter((node) => node.data.scope !== "background")
      const cappedMaximum = Math.min(foreground.length, Math.max(1, maximum))
      const visibleForeground = new Set(foreground.slice(Math.max(0, foreground.length - cappedMaximum)).map((node) => node.id))
      const backgroundIds = new Set(parsed.nodes.filter((node) => node.data.scope === "background").map((node) => node.id))
      const visibleBackground = new Set(parsed.edges.filter((edge) => visibleForeground.has(edge.target) && backgroundIds.has(edge.source)).map((edge) => edge.source))
      const nextNodes = parsed.nodes.filter((node) => visibleForeground.has(node.id) || visibleBackground.has(node.id))
      const visibleIds = new Set(nextNodes.map((node) => node.id))
      const nextEdges = parsed.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => ({
        ...edge,
        type: connectionStyle === "curved" ? "default" : connectionStyle === "straight" ? "straight" : "smoothstep",
      }))
      setNodes(layoutNodes(nextNodes, nextEdges, { orientation }))
      setEdges(nextEdges)
      requestAnimationFrame(fit)
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not apply graph settings.")
    }
  }

  const showGraphMode = (mode: "scaled" | "structure") => {
    try {
      const currentResult = calculatedRevision === appliedRevision ? lcaResult : null
      if (mode === "scaled" && !currentResult) {
        setGraphMode("scaled")
        setYamlError("")
        return
      }
      // Decorate with the scenario here rather than patching edges afterwards,
      // so the edges React Flow first sees already carry their type.
      const parsed = structure
        ? decorateAmounts(structure, {
            mode,
            scalingVector: currentResult?.scaling_vector,
            decimalPlaces: graphDecimalPlaces,
            scenario,
          })
        : buildGraphFromYaml(appliedYaml, mode, currentResult?.scaling_vector, graphDecimalPlaces)
      const previousById = new Map(nodesRef.current.map((node) => [node.id, node]))
      const laidOutNodes = layoutNodes(parsed.nodes, parsed.edges, { orientation: graphOrientation })
      let nextNodes: Node<ProcessNodeData>[] = laidOutNodes.map((node) => {
        const previous = previousById.get(node.id)
        return {
          ...node,
          position: previous?.position ?? node.position,
          hidden: previous?.hidden ?? false,
          selected: previous?.selected ?? false,
          data: {
            ...node.data,
            expanded: previous?.data.expanded ?? false,
            canRestore: previous?.data.canRestore ?? false,
            canFold: parsed.edges.some((edge) => edge.target === node.id),
          },
        }
      })
      const hiddenIds = new Set(nextNodes.filter((node) => node.hidden).map((node) => node.id))
      let nextEdges: Edge[] = parsed.edges.map((edge) => ({
        ...edge,
        hidden: hiddenIds.has(edge.source) || hiddenIds.has(edge.target),
      }))
      nextEdges = targetExpandedInputRows(nextNodes, nextEdges)
      nextNodes = populateExpandedConnections(nextNodes, nextEdges)
      foldDirectionRef.current = "upstream"
      setEdges(nextEdges)
      setNodes(nextNodes)
      setGraphMode(mode)
      setYamlError("")
      requestAnimationFrame(() => nextNodes.filter((node) => node.data.scope === "background" && node.data.expanded).forEach((node) => void hydrateBackgroundNode(node.id)))
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not parse this YAML file.")
      setView("yaml")
    }
  }

  useEffect(() => {
    if (graphMode !== "scaled" || !lcaResult || calculatedRevision !== appliedRevision) return
    showGraphMode("scaled")
    // Apply an early Scaled Graph selection as soon as its scaling vector arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRevision, calculatedRevision, graphMode, lcaResult])

  const applyYaml = (source: string) => {
    try {
      const parsed = buildGraphFromYaml(source, "structure", undefined, graphDecimalPlaces)
      resetCalculationState()
      const nextRevision = applySource(source)
      markRevision(nextRevision)
      foldDirectionRef.current = "upstream"
      setEdges(parsed.edges)
      setNodes(layoutNodes(parsed.nodes.map((node) => ({
        ...node,
        data: { ...node.data, canFold: parsed.edges.some((edge) => edge.target === node.id) },
      })), parsed.edges, { orientation: graphOrientation }))
      setYamlError("")
      onResultsMarkdown("")
      requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.4, maxZoom: 0.85, duration: 350 })))
      return nextRevision
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : "Could not parse this YAML file.")
      return null
    }
  }


  const applyAndCalculateYaml = (source: string, openGraphWhenReady = true) => {
    const revision = applyYaml(source)
    if (revision === null) return
    void calculateSource(source, revision, openGraphWhenReady)
  }

  /**
   * Put a recorded version back on screen.
   *
   * The store action restores the document tier without disturbing graph mode
   * or the selection; this rebuilds the graph from the restored YAML and
   * recalculates, which the store cannot do on its own.
   *
   * Node positions are re-laid-out rather than preserved: a restored document
   * may have different processes entirely, so carrying over the current
   * positions would leave new nodes stacked at the origin.
   */
  const restoreVersion = (versionId: string) => {
    const revision = restoreVersionInStore(versionId)
    if (revision === null) return null
    const source = useProductGraphStore.getState().appliedYaml
    markRevision(revision)
    try {
      const parsed = buildGraphFromYaml(source, "structure", undefined, graphDecimalPlaces)
      foldDirectionRef.current = "upstream"
      setEdges(parsed.edges)
      setNodes(layoutNodes(parsed.nodes.map((node) => ({
        ...node,
        data: { ...node.data, canFold: parsed.edges.some((edge) => edge.target === node.id) },
      })), parsed.edges, { orientation: graphOrientation }))
      setYamlError("")
      requestAnimationFrame(() => requestAnimationFrame(() => fitView({ padding: 0.4, maxZoom: 0.85, duration: 350 })))
    } catch (error) {
      // A recorded version parsed when it was written, so this should not
      // happen; surface it rather than leaving a half-restored graph.
      setYamlError(error instanceof Error ? error.message : "Could not rebuild the restored version.")
      return revision
    }
    if (source.trim()) void calculateSource(source, revision)
    return revision
  }

  return {
    nodes, edges, setNodes, setEdges, onNodesChange, onEdgesChange,
    nodesRef, edgesRef, foldDirectionRef,
    query, setQuery, yamlError, setYamlError,
    graphDecimalPlaces, availableGraphProcessCount,
    fitView, zoomIn, zoomOut, fit, relayout,
    removeNode, restoreNode, toggleExpanded, setAllExpanded,
    applyGraphSettings, showGraphMode, applyYaml, applyAndCalculateYaml,
    commitVersion, restoreVersion,
    commitScenario, scenarioEditCount,
    foregroundImpacts, backgroundImpacts, categoryTotals,
    visibleImpactCategories, toggleImpactCategory, categoryOrder,
    hydrateBackgroundNode, toggleBackgroundBranch,
  }
}
