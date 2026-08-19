import { useState } from "react"
import { BarChart3, ChevronDown, Leaf } from "lucide-react"
import { AppSelect } from "@/components/common/AppControls"
import { ResizableTableHeader } from "@/components/common/ResizableTable"
import { useDisplaySettings } from "@/lib/displaySettings"
import { chemicalFlowLabel } from "@/lib/flowLabels"
import { buildGraphFromYaml, buildInventoryRequirements } from "@/lib/yamlGraph"
import {
  impactCategoryAbbreviation, impactCategoryDisplayName,
  type ContributionGraph, type ContributionGraphNode, type LcaResult,
} from "@/lib/lcaApi"

export function ContributionView({ result, yaml, isCurrent, error, loadContributionGraphs }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
  loadContributionGraphs: (categories: string[]) => Promise<ContributionGraph[]>
}) {
  const { formatNumber, formatPercent } = useDisplaySettings()
  const [contributionMode, setContributionMode] = useState<"flow" | "impact">("impact")
  const [impact, setImpact] = useState("")
  const [flow, setFlow] = useState("")
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())
  const [columnWidths, setColumnWidths] = useState([190, 170, 320, 190, 250, 140])

  const impactNames = result ? Object.keys(result.lcia) : []
  const defaultImpact = impactNames.find((name) => impactCategoryAbbreviation(name).replaceAll(/\s+/g, "").toUpperCase() === "GWP100")
    ?? impactNames.find((name) => /global warming|climate change/i.test(name))
    ?? impactNames[0]
    ?? ""
  const selectedImpact = impactNames.includes(impact) ? impact : defaultImpact
  if (!result || !isCurrent) return <div className="results-panel contribution-panel">
    <div className="results-panel-head"><div><strong>Contribution analysis</strong><span>Compare direct and accumulated process impacts.</span></div></div>
    <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No current contribution results</strong><p>Calculate the LCA to populate this view.</p>{error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}</div>
  </div>

  const category = result.process_contributions.categories.find((item) => item.label === selectedImpact || item.id === selectedImpact)
  const selectedContributionGraph = result.contribution_graphs.find((item) => item.label === selectedImpact)
  const availableFlows = [...new Map(result.contribution_graphs.flatMap((graph) => graph.flows).map((item) => [
    `${item.flow_name}\u0000${item.unit}`,
    { value: `${item.flow_name}\u0000${item.unit}`, label: `${chemicalFlowLabel(item.flow_name)} (${item.unit})` },
  ])).values()].sort((left, right) => left.label.localeCompare(right.label))
  const selectedFlow = availableFlows.some((item) => item.value === flow) ? flow : (availableFlows[0]?.value ?? "")
  const [selectedFlowName, selectedFlowUnit = ""] = selectedFlow.split("\u0000")
  let requirements: ReturnType<typeof buildInventoryRequirements> = []
  try { requirements = buildInventoryRequirements(yaml, result.scaling_vector) } catch { requirements = [] }
  const impactTotal = result.lcia[selectedImpact]
  const cleanProcessName = (name: string) => name
    .replace(/^(?:p?\d+)\s*[:.\-–—]\s*/i, "")
    .trim()
  const processName = (name: string, index: number) => {
    const visible = cleanProcessName(name)
    if (visible && !/^(?:p?\d+)$/i.test(visible)) return visible
    return cleanProcessName(requirements[index]?.process ?? "")
  }
  const requiredAmount = (id: string, name: string, index: number) => {
    const displayName = processName(name, index).toLowerCase()
    const matchingRequirement = requirements.find((item) => cleanProcessName(item.process).toLowerCase() === displayName)
    return result.scaling_vector[id]
      ?? result.scaling_vector[name]
      ?? matchingRequirement?.amount
      ?? requirements[index]?.amount
  }
  const rows = (category?.processes ?? []).map((item, index) => ({ name: processName(item.process_name, index), required: requiredAmount(item.process_id, item.process_name, index), total: item.direct_score, percentage: item.percentage }))
    .filter((row) => row.name && !/^(?:p?\d+)$/i.test(row.name))
    .sort((left, right) => Math.abs(right.total) - Math.abs(left.total))
  const total = category?.total_score ?? impactTotal?.score ?? 0
  const unit = category?.unit ?? impactTotal?.unit ?? ""
  const maxMagnitude = Math.max(Math.abs(total), ...rows.map((row) => Math.abs(row.total)), 1e-30)
  const number = (value: number | undefined) => value === undefined ? "—" : formatNumber(value)
  let legacyGraph: ReturnType<typeof buildGraphFromYaml> | null = null
  try { legacyGraph = buildGraphFromYaml(yaml, "structure") } catch { legacyGraph = null }
  const graphNameById = new Map(legacyGraph?.nodes.map((node) => [node.id, cleanProcessName(node.data.label)]) ?? [])
  const upstreamByName = new Map<string, string[]>()
  legacyGraph?.edges.forEach((edge) => {
    const consumer = graphNameById.get(edge.target)
    const supplier = graphNameById.get(edge.source)
    if (!consumer || !supplier) return
    upstreamByName.set(consumer, [...(upstreamByName.get(consumer) ?? []), supplier])
  })
  const rowByName = new Map(rows.map((row) => [row.name.toLowerCase(), row]))
  const suppliedNames = new Set([...upstreamByName.values()].flat().map((name) => name.toLowerCase()))
  const rootRows = rows.filter((row) => !suppliedNames.has(row.name.toLowerCase()))
  const toggleProcess = (key: string) => setExpandedProcesses((current) => {
    const next = new Set(current)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })
  const ownValue = (row: (typeof rows)[number]) => row.total
  const rolledUpValue = (row: (typeof rows)[number], visited = new Set<string>()): number => {
    const key = row.name.toLowerCase()
    if (visited.has(key)) return 0
    const nextVisited = new Set(visited).add(key)
    const upstream = (upstreamByName.get(row.name) ?? [])
      .map((name) => rowByName.get(name.toLowerCase()))
      .filter((item): item is (typeof rows)[number] => Boolean(item))
    return ownValue(row) + upstream.reduce((sum, child) => sum + rolledUpValue(child, nextVisited), 0)
  }
  const renderContributionRows = (items: typeof rows, depth = 0): React.ReactNode[] => items.flatMap((row, index) => {
    const upstream = (upstreamByName.get(row.name) ?? [])
      .map((name) => rowByName.get(name.toLowerCase()))
      .filter((item): item is (typeof rows)[number] => Boolean(item))
      .sort((left, right) => Math.abs(rolledUpValue(right)) - Math.abs(rolledUpValue(left)))
    const canExpand = upstream.length > 0
    const isOpen = expandedProcesses.has(row.name)
    const displayedValue = rolledUpValue(row)
    const contributionRate = total ? displayedValue / total * 100 : 0
    const directPercent = total ? row.total / total * 100 : 0
    const processRow = <tr key={`${row.name}-${depth}-${index}`} className={canExpand ? "clickable-process" : ""} onClick={canExpand ? () => toggleProcess(row.name) : undefined}>
      <td><span className="result-bar contribution-rate-bar"><i className={contributionRate < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(contributionRate))}%` }} /></span><span className="rate-value">{formatPercent(contributionRate)}</span></td>
      <td><span className="rate-value">{formatPercent(directPercent)}</span></td>
      <td style={{ paddingLeft: `${7 + depth * 20}px` }}>{canExpand ? <button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} inputs for ${row.name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{row.name}</td>
      <td>{number(row.total)}</td><td><span className="result-bar"><i className={displayedValue < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(displayedValue) / maxMagnitude * 100)}%` }} /></span>{number(displayedValue)}</td><td>{unit}</td>
    </tr>
    return isOpen ? [processRow, ...renderContributionRows(upstream, depth + 1)] : [processRow]
  })

  const graphNodesById = new Map(selectedContributionGraph?.nodes.map((node) => [node.id, node]) ?? [])
  const graphChildren = new Map<string, ContributionGraphNode[]>()
  selectedContributionGraph?.edges.forEach((edge) => {
    const producer = graphNodesById.get(edge.producer_id)
    if (producer?.kind !== "process") return
    graphChildren.set(edge.consumer_id, [...(graphChildren.get(edge.consumer_id) ?? []), producer])
  })
  graphChildren.forEach((children) => children.sort((left, right) => Math.abs(right.cumulative_score) - Math.abs(left.cumulative_score)))
  const flowDirectScore = (nodeId: string) => selectedContributionGraph?.flows
    .filter((item) => item.process_occurrence_id === nodeId && item.flow_name === selectedFlowName && item.unit === selectedFlowUnit)
    .reduce((sum, item) => sum + item.amount, 0) ?? 0
  const flowCumulativeScore = (nodeId: string, visited = new Set<string>()): number => {
    if (visited.has(nodeId)) return 0
    const nextVisited = new Set(visited).add(nodeId)
    return flowDirectScore(nodeId) + (graphChildren.get(nodeId) ?? []).reduce((sum, child) => sum + flowCumulativeScore(child.id, nextVisited), 0)
  }
  const graphRootId = selectedContributionGraph?.nodes.find((node) => node.kind === "functional_unit")?.id ?? ""
  const graphRootProcesses = graphChildren.get(graphRootId) ?? []
  const flowTotal = graphRootProcesses.reduce((sum, node) => sum + flowCumulativeScore(node.id), 0)
  const displayedTotal = contributionMode === "flow" ? flowTotal : (selectedContributionGraph?.total_score ?? total)
  const displayedUnit = contributionMode === "flow" ? selectedFlowUnit : (selectedContributionGraph?.unit ?? unit)
  const graphNodeCumulativeScore = (node: ContributionGraphNode) => contributionMode === "flow" ? flowCumulativeScore(node.id) : node.cumulative_score
  const renderGraphProcesses = (items: ContributionGraphNode[], depth = 0): React.ReactNode[] => items.flatMap((node) => {
    const children = graphChildren.get(node.id) ?? []
    const isOpen = expandedProcesses.has(node.id)
    const directScore = contributionMode === "flow" ? flowDirectScore(node.id) : node.direct_score
    const cumulativeScore = graphNodeCumulativeScore(node)
    const contributionRate = displayedTotal ? cumulativeScore / displayedTotal * 100 : null
    const percent = displayedTotal ? cumulativeScore / displayedTotal * 100 : null
    const directPercent = displayedTotal ? directScore / displayedTotal * 100 : null
    const row = <tr key={node.id} className={children.length ? "clickable-process contribution-process-row" : "contribution-process-row"} onClick={children.length ? () => toggleProcess(node.id) : undefined}>
      <td>{contributionRate === null ? "—" : <><span className="result-bar contribution-rate-bar"><i className={contributionRate < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(contributionRate))}%` }} /></span><span className="rate-value">{formatPercent(contributionRate)}</span></>}</td>
      <td><span className="rate-value">{directPercent === null ? "—" : formatPercent(directPercent)}</span></td>
      <td style={{ paddingLeft: `${7 + depth * 20}px` }}>{children.length ? <button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} aria-expanded={isOpen} aria-label={`${isOpen ? "Hide" : "Show"} upstream processes for ${node.process_name}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="process-mark">⌘</span>{cleanProcessName(node.process_name)}{node.location ? <small>{node.location}</small> : null}</td>
      <td>{number(directScore)}</td>
      <td><span className="result-bar"><i className={cumulativeScore < 0 ? "negative" : ""} style={{ width: `${Math.min(100, Math.abs(percent ?? 0))}%` }} /></span>{number(cumulativeScore)}</td>
      <td>{displayedUnit}</td>
    </tr>
    return isOpen ? [row, ...renderGraphProcesses(children, depth + 1)] : [row]
  })

  return <div className="contribution-view">
    <div className="contribution-title"><div><strong>Contribution analysis</strong><span>{result.name} · {result.method} · {result.functional_unit}</span></div>
      {selectedContributionGraph ? <aside className={`contribution-graph-summary is-${selectedContributionGraph.status}`}>
        <strong>{selectedContributionGraph.status.replace("_", " ")}</strong>
        <span>Total {formatNumber(selectedContributionGraph.total_score)} {selectedContributionGraph.unit} · Coverage {selectedContributionGraph.coverage === null ? "—" : formatPercent(selectedContributionGraph.coverage * 100)} · Unexpanded {formatNumber(selectedContributionGraph.unexpanded_score)} {selectedContributionGraph.unit}</span>
      </aside> : null}
    </div>
    <div className="contribution-controls">
      <div className="contribution-mode-group"><label className={contributionMode === "flow" ? "active" : ""}><input className="app-radio" type="radio" name="contribution-mode" checked={contributionMode === "flow"} onChange={() => setContributionMode("flow")} />Flows</label><label className={contributionMode === "impact" ? "active" : ""}><input className="app-radio" type="radio" name="contribution-mode" checked={contributionMode === "impact"} onChange={() => setContributionMode("impact")} />Impact category</label></div>
      <div className="contribution-control-slot">{contributionMode === "flow"
        ? <div className="contribution-select is-flow"><Leaf size={16} /><AppSelect value={selectedFlow} onValueChange={setFlow} label="Flow" options={availableFlows} /></div>
        : <div className="contribution-select is-impact"><BarChart3 size={16} /><AppSelect value={selectedImpact} onValueChange={(value) => { setImpact(value); void loadContributionGraphs([value]) }} label="Impact category" options={impactNames.map((value) => ({ value, label: impactCategoryDisplayName(value) }))} /></div>}</div>
      {!selectedContributionGraph ? <p className="contribution-fallback-note">Recursive contributions were not requested for this category. Showing the available process-contribution results.</p> : null}
    </div>
    <div className="contribution-table-wrap"><table className="contribution-table" style={{ width: Math.max(1180, columnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={[
      "Contribution",
      "Direct Contribution %",
      "Process",
      "Direct contribution",
      "Accumulated contribution",
      "Unit",
    ]} widths={columnWidths} onWidthsChange={setColumnWidths} /><tbody>
      {selectedContributionGraph ? <>
        {renderGraphProcesses(graphRootProcesses)}
        {!selectedContributionGraph.nodes.some((node) => node.kind === "process") ? <tr className="empty-row"><td colSpan={6}>{selectedContributionGraph.status === "zero_total" ? "This selection has a zero total, so contribution percentages are unavailable." : "No process contributions were returned for this selection."}</td></tr> : null}
      </> : <>
        {renderContributionRows(rootRows.length ? rootRows : rows)}
        {!rows.length ? <tr className="empty-row"><td colSpan={6}>No process contribution rows were returned for this category.</td></tr> : null}
      </>}
    </tbody></table></div>
  </div>
}
