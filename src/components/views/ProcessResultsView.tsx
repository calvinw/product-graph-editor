import { useState } from "react"
import { parse } from "yaml"
import { AppSelect } from "@/components/common/AppControls"
import { ResizableTableHeader } from "@/components/common/ResizableTable"
import { Input } from "@/components/ui/input"
import { useDisplaySettings } from "@/lib/displaySettings"
import { impactCategoryDisplayName, type LcaResult } from "@/lib/lcaApi"
import {
  cleanImpactProcessName, inventoryFlowName, isInventoryInput, normalizedFlow,
  type ImpactYaml,
} from "@/lib/resultFormatting"

export function ProcessResultsView({ result, yaml }: { result: LcaResult; yaml: string }) {
  const { formatNumber, formatPercent } = useDisplaySettings()
  const processNodes = result.sankey.nodes.filter((node) => node.kind === "process")
  const [flowProcessId, setFlowProcessId] = useState("")
  const [impactProcessId, setImpactProcessId] = useState("")
  const [threshold, setThreshold] = useState(0.01)
  const [flowColumnWidths, setFlowColumnWidths] = useState([140, 220, 230, 180, 140, 90])
  const [impactColumnWidths, setImpactColumnWidths] = useState([170, 300, 190, 150, 120])
  const referenceProcessId = result.sankey.links.find((link) => link.kind === "final_product")?.source
  const defaultProcessId = processNodes.some((node) => node.id === referenceProcessId) ? referenceProcessId! : (processNodes.at(-1)?.id ?? "")
  const selectedFlowProcessId = processNodes.some((node) => node.id === flowProcessId) ? flowProcessId : defaultProcessId
  const selectedImpactProcessId = processNodes.some((node) => node.id === impactProcessId) ? impactProcessId : defaultProcessId
  const selectedImpactNode = processNodes.find((node) => node.id === selectedImpactProcessId)
  const processIds = new Set(processNodes.map((node) => node.id))
  const incoming = new Map<string, string[]>()
  result.sankey.links.forEach((link) => {
    if (processIds.has(link.source) && processIds.has(link.target)) incoming.set(link.target, [...(incoming.get(link.target) ?? []), link.source])
  })
  const upstreamIds = (id: string, found = new Set<string>()): Set<string> => {
    if (found.has(id)) return found
    found.add(id)
    ;(incoming.get(id) ?? []).forEach((source) => upstreamIds(source, found))
    return found
  }
  const flowIncludedIds = upstreamIds(selectedFlowProcessId)
  const impactIncludedIds = upstreamIds(selectedImpactProcessId)
  let source: ImpactYaml = {}
  try { source = parse(yaml) as ImpactYaml } catch { source = {} }
  const yamlProcesses = source.processes ?? []
  const yamlByName = new Map(yamlProcesses.flatMap((process) => [
    [process.name.toLowerCase(), process],
    [cleanImpactProcessName(process.name).toLowerCase(), process],
  ]))
  const nodeProcess = (node: (typeof processNodes)[number]) => yamlByName.get((node.process_name ?? node.label).toLowerCase())
    ?? yamlByName.get(cleanImpactProcessName(node.process_name ?? node.label).toLowerCase())
  const exactLciFlowKeys = new Set<string>()
  const lciFlowAliases = new Map<string, Set<string>>()
  Object.entries(result.lci).forEach(([name, value]) => {
    const input = isInventoryInput(value.type)
    const exactKey = `${input}:${normalizedFlow(name)}`
    const aliasKey = `${input}:${normalizedFlow(name.split(/[|,]/)[0])}`
    exactLciFlowKeys.add(exactKey)
    lciFlowAliases.set(aliasKey, new Set(lciFlowAliases.get(aliasKey) ?? []).add(exactKey))
  })
  const canonicalFlowKey = (input: boolean, name: string) => {
    const key = `${input}:${normalizedFlow(name)}`
    if (exactLciFlowKeys.has(key)) return key
    const aliases = lciFlowAliases.get(key)
    return aliases?.size === 1 ? [...aliases][0] : key
  }
  const flowRows = new Map<string, { name: string; category: string; unit: string; upstream: number; direct: number; input: boolean }>()
  processNodes.filter((node) => flowIncludedIds.has(node.id)).forEach((node) => {
    const process = nodeProcess(node)
    const scale = result.scaling_vector[node.id] ?? result.scaling_vector[node.process_name ?? ""] ?? result.scaling_vector[process?.name ?? ""] ?? 1
    const exchanges = [
      ...(process?.emissions ?? []).map((flow) => ({ ...flow, input: false })),
      ...(process?.extractions ?? process?.resources ?? process?.resource_inputs ?? []).map((flow) => ({ ...flow, input: true })),
    ]
    exchanges.forEach((flow) => {
      const key = canonicalFlowKey(flow.input, flow.flow)
      const existing = flowRows.get(key) ?? { name: flow.flow, category: flow.input ? "elementary flows/resource" : "elementary flows/air", unit: flow.unit ?? "kg", upstream: 0, direct: 0, input: flow.input }
      const amount = flow.amount * scale
      existing.upstream += amount
      if (node.id === selectedFlowProcessId) existing.direct += amount
      flowRows.set(key, existing)
    })
  })

  // Linked background processes are absent from the foreground YAML. Their
  // per-process inventory is carried by the contribution graph occurrences.
  // The same physical exchange can appear in several impact-category graphs,
  // so retain the largest matching amount instead of counting it repeatedly.
  type CalculatedFlow = { name: string; category: string; unit: string; upstream: number; direct: number; input: boolean }
  const calculatedFlows = new Map<string, CalculatedFlow>()
  result.contribution_graphs.forEach((graph) => {
    const selectedOccurrences = new Set(graph.nodes
      .filter((node) => node.kind === "process" && node.activity_id === selectedFlowProcessId)
      .map((node) => node.id))
    if (!selectedOccurrences.size) return

    const children = new Map<string, string[]>()
    graph.edges.forEach((edge) => children.set(edge.consumer_id, [...(children.get(edge.consumer_id) ?? []), edge.producer_id]))
    const upstreamOccurrences = new Set<string>()
    const includeUpstream = (id: string) => {
      if (upstreamOccurrences.has(id)) return
      upstreamOccurrences.add(id)
      ;(children.get(id) ?? []).forEach(includeUpstream)
    }
    selectedOccurrences.forEach(includeUpstream)

    const graphFlows = new Map<string, CalculatedFlow>()
    graph.flows.forEach((flow) => {
      if (!upstreamOccurrences.has(flow.process_occurrence_id)) return
      const input = flow.kind === "extraction"
      const category = `elementary flows/${flow.categories.join("/") || (input ? "resource" : "air")}`
      const key = canonicalFlowKey(input, flow.flow_name)
      const existing = graphFlows.get(key) ?? {
        name: flow.flow_name,
        category,
        unit: flow.unit,
        upstream: 0,
        direct: 0,
        input,
      }
      existing.upstream += flow.amount
      if (selectedOccurrences.has(flow.process_occurrence_id)) existing.direct += flow.amount
      graphFlows.set(key, existing)
    })
    graphFlows.forEach((flow, key) => {
      const existing = calculatedFlows.get(key)
      if (!existing) {
        calculatedFlows.set(key, flow)
        return
      }
      if (Math.abs(flow.upstream) > Math.abs(existing.upstream)) existing.upstream = flow.upstream
      if (Math.abs(flow.direct) > Math.abs(existing.direct)) existing.direct = flow.direct
    })
  })
  calculatedFlows.forEach((flow) => {
    const yamlKey = canonicalFlowKey(flow.input, flow.name)
    const existing = flowRows.get(yamlKey)
    if (existing) {
      existing.name = flow.name
      existing.category = flow.category
      existing.unit = flow.unit
      existing.upstream = flow.upstream
      existing.direct = flow.direct
    } else {
      flowRows.set(yamlKey, flow)
    }
  })

  // For the reference process, the complete calculated LCI is authoritative;
  // contribution graphs intentionally omit flows below their cutoffs.
  if (flowIncludedIds.size === processIds.size) {
    Object.entries(result.lci).forEach(([name, value]) => {
      const input = isInventoryInput(value.type)
      const key = canonicalFlowKey(input, name)
      const existing = flowRows.get(key)
      flowRows.set(key, {
        name,
        category: existing?.category ?? (input ? "elementary flows/resource" : "elementary flows/air"),
        unit: value.unit,
        upstream: value.amount,
        direct: existing?.direct ?? 0,
        input,
      })
    })
  }
  const flowTotals = [...flowRows.values()].reduce((totals, flow) => {
    totals.set(flow.input, (totals.get(flow.input) ?? 0) + Math.abs(flow.upstream))
    return totals
  }, new Map<boolean, number>())
  const flowContribution = (flow: { input: boolean; upstream: number }) => {
    const total = flowTotals.get(flow.input) ?? 0
    return total ? Math.abs(flow.upstream) / total * 100 : 0
  }
  const visibleFlows = [...flowRows.values()].filter((flow) => flowContribution(flow) >= threshold)
  const renderFlowResultsTable = (input: boolean) => {
    const rows = visibleFlows.filter((flow) => flow.input === input)
    return <table className="process-flow-table" style={{ width: Math.max(1000, flowColumnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={["Contribution", "Flow", "Category", "Upstream incl. direct", "Direct", "Unit"]} widths={flowColumnWidths} onWidthsChange={setFlowColumnWidths} />
      <tbody>{rows.length ? rows.map((flow) => <tr key={`${input}:${flow.name}`}>
        <td><span className="process-result-bar"><i style={{ width: `${Math.min(100, flowContribution(flow))}%` }} /></span></td>
        <td>{inventoryFlowName(flow.name)}</td><td>{flow.category}</td><td>{formatNumber(flow.upstream)}</td><td>{formatNumber(flow.direct)}</td><td>{flow.unit}</td>
      </tr>) : <tr className="empty-row"><td colSpan={6}>No {input ? "input" : "output"} flows for this process.</td></tr>}</tbody>
    </table>
  }
  const impactRows = result.process_contributions.categories.map((category) => {
    const byId = new Map(category.processes.flatMap((process) => [
      [process.process_id, process] as const,
      [cleanImpactProcessName(process.process_name).toLowerCase(), process] as const,
    ]))
    const scoreFor = (node: (typeof processNodes)[number]) => byId.get(node.id) ?? byId.get(cleanImpactProcessName(node.process_name ?? node.label).toLowerCase())
    const graph = result.contribution_graphs.find((candidate) => candidate.label === category.label)
    const exactOccurrences = graph?.nodes.filter((node) => (
      node.kind === "process" && node.activity_id === selectedImpactProcessId
    )) ?? []
    const upstream = exactOccurrences.length
      ? exactOccurrences.reduce((sum, node) => sum + node.cumulative_score, 0)
      : processNodes.filter((node) => impactIncludedIds.has(node.id)).reduce((sum, node) => sum + (scoreFor(node)?.direct_score ?? 0), 0)
    const direct = selectedImpactNode ? scoreFor(selectedImpactNode)?.direct_score ?? 0 : 0
    return { category, upstream, direct, contribution: category.total_score ? upstream / category.total_score * 100 : 0 }
  }).filter((row) => Math.abs(row.contribution) >= threshold && row.upstream !== 0)

  return <div className="process-results-view">
    <div className="process-results-title"><div><strong>Process results</strong><span>{result.name} · {result.functional_unit}</span></div></div>
    <details open><summary>Flow contributions to process results</summary>
      <div className="process-results-controls"><label>Process <AppSelect value={selectedFlowProcessId} onValueChange={setFlowProcessId} label="Flow contribution process" options={processNodes.map((node) => ({ value: node.id, label: cleanImpactProcessName(node.process_name ?? node.label) }))} /></label><label>Don’t show &lt; <Input type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label></div>
      <div className="process-flow-grids"><section><h3>Inputs</h3>{renderFlowResultsTable(true)}</section><section><h3>Outputs</h3>{renderFlowResultsTable(false)}</section></div>
    </details>
    <details open><summary>Impact assessment results</summary>
      <div className="process-results-controls"><label>Process <AppSelect value={selectedImpactProcessId} onValueChange={setImpactProcessId} label="Impact assessment process" options={processNodes.map((node) => ({ value: node.id, label: cleanImpactProcessName(node.process_name ?? node.label) }))} /></label><label>Don’t show &lt; <Input type="number" min="0" max="100" step="0.01" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label></div>
      <div className="process-impact-table-wrap"><table className="process-impact-table" style={{ width: Math.max(930, impactColumnWidths.reduce((sum, width) => sum + width, 0)) }}><ResizableTableHeader labels={["Contribution", "Impact category", "Upstream incl. direct", "Direct", "Unit"]} widths={impactColumnWidths} onWidthsChange={setImpactColumnWidths} /><tbody>{impactRows.map((row) => <tr key={row.category.id || row.category.label}><td><span className="process-result-bar"><i style={{ width: `${Math.min(100, Math.abs(row.contribution))}%` }} /></span>{formatPercent(row.contribution)}</td><td>{impactCategoryDisplayName(row.category.label)}</td><td>{formatNumber(row.upstream)}</td><td>{formatNumber(row.direct)}</td><td>{row.category.unit}</td></tr>)}</tbody></table></div>
    </details>
  </div>
}
