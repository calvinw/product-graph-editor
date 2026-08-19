import { useState } from "react"
import { BarChart3, ChevronDown } from "lucide-react"
import { ResizableTableHeader } from "@/components/common/ResizableTable"
import { useDisplaySettings } from "@/lib/displaySettings"
import type { LcaResult } from "@/lib/lcaApi"
import { buildInventoryRequirements } from "@/lib/yamlGraph"
import { inventoryFlowName, isInventoryInput, normalizedFlow } from "@/lib/resultFormatting"

export function InventoryView({ result, yaml, isCurrent, error }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
}) {
  const { formatNumber } = useDisplaySettings()
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(() => new Set())
  const [collapsedRequirements, setCollapsedRequirements] = useState<Set<string>>(() => new Set())
  const [flowColumnWidths, setFlowColumnWidths] = useState([360, 280, 140, 100])
  const [requirementColumnWidths, setRequirementColumnWidths] = useState([360, 280, 140, 100])
  if (!result || !isCurrent) return <div className="results-panel inventory-panel">
    <div className="results-panel-head"><div><strong>Inventory results</strong><span>Calculated quantities for the current product graph.</span></div></div>
    <div className="results-placeholder">
      <div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No current inventory results</strong>
      <p>Calculate the LCA to populate this view with values returned by the calculation engine.</p>
      {error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}
    </div>
  </div>

  const flows = Object.entries(result.lci).map(([name, value]) => ({ name, ...value }))
  const inputs = flows.filter((flow) => isInventoryInput(flow.type))
  const outputs = flows.filter((flow) => !isInventoryInput(flow.type))
  const toggleFlow = (key: string) => setExpandedFlows((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const toggleRequirement = (id: string) => setCollapsedRequirements((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const normalizedInventoryName = (name: string) => normalizedFlow(name.split("|")[0])
  const flowChildren = (flowName: string) => {
    const candidates = result.contribution_graphs.map((graph) => {
      const nodes = new Map(graph.nodes.map((node) => [node.id, node]))
      const rows = graph.flows.filter((flow) => normalizedInventoryName(flow.flow_name) === normalizedInventoryName(flowName))
        .map((flow) => ({ flow, process: nodes.get(flow.process_occurrence_id) }))
        .filter((row): row is { flow: (typeof graph.flows)[number]; process: NonNullable<typeof row.process> } => Boolean(row.process))
      return rows
    })
    return candidates.sort((left, right) => right.length - left.length)[0] ?? []
  }
  const renderFlowTable = (rows: typeof flows, empty: string) => <div className="inventory-table-wrap"><table className="inventory-table" style={{ width: Math.max(880, flowColumnWidths.reduce((sum, width) => sum + width, 0)) }}>
    <ResizableTableHeader labels={["Name", "Category", "Amount", "Unit"]} widths={flowColumnWidths} onWidthsChange={setFlowColumnWidths} />
    <tbody>{rows.length ? rows.flatMap((flow) => {
      const key = `${flow.type}-${flow.name}`
      const children = flowChildren(flow.name)
      const open = expandedFlows.has(key)
      const parent = <tr className={children.length ? "inventory-tree-parent" : ""} key={key} onClick={children.length ? () => toggleFlow(key) : undefined}>
        <td>{children.length ? <button className={`tree-toggle ${open ? "is-expanded" : ""}`} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} processes for ${flow.name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className={isInventoryInput(flow.type) ? "flow-dot input" : "flow-dot output"} />{inventoryFlowName(flow.name)}</td>
        <td>{flow.type}</td><td className="number">{formatNumber(flow.amount)}</td><td>{flow.unit}</td>
      </tr>
      const childRows = open ? children.map(({ flow: childFlow, process }) => <tr className="inventory-flow-child" key={`${key}:${childFlow.id}`}>
        <td><span className="inventory-tree-indent" /><span className="process-mark">⌘</span>{process.process_name}</td>
        <td>{childFlow.categories.join("/") || `${process.scope ?? "process"}`}</td><td className="number">{formatNumber(childFlow.amount)}</td><td>{childFlow.unit}</td>
      </tr>) : []
      return [parent, ...childRows]
    }) : <tr className="empty-row"><td colSpan={4}>{empty}</td></tr>}</tbody>
  </table></div>

  const requirementGraph = [...result.contribution_graphs].sort((left, right) => right.nodes.length - left.nodes.length)[0]
  const requirementNodes = new Map(requirementGraph?.nodes.map((node) => [node.id, node]) ?? [])
  const requirementChildren = new Map<string, string[]>()
  const requirementEdgeByProducer = new Map<string, NonNullable<typeof requirementGraph>["edges"][number]>()
  requirementGraph?.edges.forEach((edge) => {
    requirementChildren.set(edge.consumer_id, [...(requirementChildren.get(edge.consumer_id) ?? []), edge.producer_id])
    requirementEdgeByProducer.set(edge.producer_id, edge)
  })
  const requirementRoot = requirementGraph?.nodes.find((node) => node.kind === "functional_unit")
  let fallbackRequirements: ReturnType<typeof buildInventoryRequirements> = []
  try { fallbackRequirements = buildInventoryRequirements(yaml, result.scaling_vector) } catch { fallbackRequirements = [] }
  const renderRequirementRows = (ids: string[], depth: number): React.ReactNode[] => ids.flatMap((id) => {
    const node = requirementNodes.get(id)
    if (!node) return []
    const children = requirementChildren.get(id) ?? []
    const open = !collapsedRequirements.has(id)
    const edge = requirementEdgeByProducer.get(id)
    const row = <tr key={id} className={children.length ? "inventory-tree-parent" : ""} onClick={children.length ? () => toggleRequirement(id) : undefined}>
      <td style={{ paddingLeft: `${6 + depth * 20}px` }}>{children.length ? <button className={`tree-toggle ${open ? "is-expanded" : ""}`} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} children of ${node.process_name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{node.process_name}<small className={`inventory-scope is-${node.scope ?? "functional"}`}>{node.scope ?? "functional unit"}</small></td>
      <td><span className="product-mark">⚙</span>{edge?.flow_name ?? result.name}</td><td className="number">{formatNumber(node.supply_amount)}</td><td>{node.unit}</td>
    </tr>
    return open ? [row, ...renderRequirementRows(children, depth + 1)] : [row]
  })

  return <div className="inventory-view">
    <div className="inventory-title"><div><strong>Inventory results</strong><span>{result.name} · {result.functional_unit}</span></div></div>
    <details open><summary>Inputs <span>{inputs.length}</span></summary>{renderFlowTable(inputs, "No environmental input flows were returned.")}</details>
    <details open><summary>Outputs <span>{outputs.length}</span></summary>{renderFlowTable(outputs, "No environmental output flows were returned.")}</details>
    <details open className="requirements"><summary>Total requirements <span>{requirementGraph?.nodes.filter((node) => node.kind === "process").length ?? fallbackRequirements.length}</span></summary>
      <div className="inventory-table-wrap"><table className="inventory-table" style={{ width: Math.max(880, requirementColumnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={["Process", "Product", "Amount", "Unit"]} widths={requirementColumnWidths} onWidthsChange={setRequirementColumnWidths} /><tbody>
        {requirementRoot ? renderRequirementRows([requirementRoot.id], 0) : fallbackRequirements.map((row) => <tr key={row.process}><td><span className="process-mark">⌘</span>{row.process}</td><td><span className="product-mark">⚙</span>{row.product}</td><td className="number">{formatNumber(row.amount)}</td><td>{row.unit}</td></tr>)}
      </tbody></table></div>
    </details>
  </div>
}

