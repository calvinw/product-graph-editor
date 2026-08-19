import { useCallback, type RefObject } from "react"
import { Position, type Edge, type Node } from "@xyflow/react"
import type { ProcessNodeData } from "@/components/ProcessNode"
import { chemicalFlowLabel } from "@/lib/flowLabels"
import { getBackgroundActivityDetails } from "@/lib/lcaApi"
import { nodeScopeColors } from "@/lib/yamlGraph"

/**
 * Loading and expansion of background supply-chain nodes.
 *
 * `hydrateBackgroundNode` fetches one activity's unit-process detail;
 * `toggleBackgroundBranch` expands or collapses its upstream branch. Both read
 * current graph state through refs so they stay referentially stable, which
 * matters because they are attached to node data.
 */
export function useBackgroundHydration({
  nodesRef,
  edgesRef,
  setNodes,
  setEdges,
  formatNumber,
  graphOrientation,
  graphConnectionStyle,
}: {
  nodesRef: RefObject<Node<ProcessNodeData>[]>
  edgesRef: RefObject<Edge[]>
  setNodes: React.Dispatch<React.SetStateAction<Node<ProcessNodeData>[]>>
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>
  formatNumber: (value: number) => string
  graphOrientation: "vertical" | "horizontal"
  graphConnectionStyle: "curved" | "straight" | "step"
}) {
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
      const nextNodes = [...currentNodes, updatedParent, ...childNodes]
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


  return { hydrateBackgroundNode, toggleBackgroundBranch }
}
