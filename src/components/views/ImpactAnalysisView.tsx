import { Fragment, useEffect, useState } from "react"
import { BarChart3, ChevronDown, Factory, Leaf } from "lucide-react"
import { parse } from "yaml"
import { Input } from "@/components/ui/input"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ResizableTableHeader } from "@/components/common/ResizableTable"
import { useDisplaySettings } from "@/lib/displaySettings"
import { impactCategoryDisplayName, type ContributionGraph, type LcaResult } from "@/lib/lcaApi"
import {
  cleanImpactProcessName, impactFactor, inventoryFlowName, normalizedFlow, type ImpactYaml,
} from "@/lib/resultFormatting"

export function ImpactAnalysisView({ result, yaml, isCurrent, error, loadContributionGraphs }: {
  result: LcaResult | null
  yaml: string
  isCurrent: boolean
  error: string
  loadContributionGraphs: (categories: string[]) => Promise<ContributionGraph[]>
}) {
  const { formatNumber } = useDisplaySettings()
  const [subgroup, setSubgroup] = useState<"processes" | "flows">("processes")
  const [threshold, setThreshold] = useState(1)
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set())
  const [expandedProcesses, setExpandedProcesses] = useState<Set<string>>(() => new Set())
  const [collapsedFlows, setCollapsedFlows] = useState<Set<string>>(() => new Set())
  const [loadingCategories, setLoadingCategories] = useState<Set<string>>(() => new Set())
  const [categoryErrors, setCategoryErrors] = useState<Map<string, string>>(() => new Map())
  const [columnWidths, setColumnWidths] = useState([300, 240, 160, 180, 220])
  useEffect(() => {
    setLoadingCategories(new Set())
    setCategoryErrors(new Map())
    setExpandedCategories(new Set())
    setExpandedProcesses(new Set())
  }, [result?.result_id])

  if (!result || !isCurrent) return <div className="results-panel impact-panel">
    <div className="results-panel-head"><div><strong>Impact analysis</strong><span>Inspect characterized impacts by category, process, and elementary flow.</span></div></div>
    <div className="results-placeholder"><div className="results-empty-icon"><BarChart3 size={22} /></div><strong>No current impact results</strong><p>Calculate the LCA to populate this view.</p>{error ? <div className="results-error"><strong>Calculation failed</strong><p>{error}</p></div> : null}</div>
  </div>

  let source: ImpactYaml = {}
  try { source = parse(yaml) as ImpactYaml } catch { source = {} }
  const yamlProcesses = source.processes ?? []
  const yamlProcessByName = new Map(yamlProcesses.flatMap((process) => [
    [process.name.toLowerCase(), process],
    [cleanImpactProcessName(process.name).toLowerCase(), process],
  ]))
  const categories = [...result.process_contributions.categories]
    .filter((category) => category.total_score !== 0)
    .reduce((unique, category) => {
      const key = category.id || category.label
      if (!unique.has(key)) unique.set(key, category)
      return unique
    }, new Map<string, LcaResult["process_contributions"]["categories"][number]>())
  const contributionGraphFor = (label: string) => result.contribution_graphs.find((graph) => graph.label === label)
  const toggleCategory = (id: string) => setExpandedCategories((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const loadCategory = async (id: string, label: string) => {
    if (contributionGraphFor(label) || loadingCategories.has(id)) return
    setLoadingCategories((current) => new Set(current).add(id))
    setCategoryErrors((current) => { const next = new Map(current); next.delete(id); return next })
    try {
      const graphs = await loadContributionGraphs([label])
      const graph = graphs.find((candidate) => candidate.label === label)
      if (!graph) throw new Error("The calculation engine returned no child contribution graph for this category.")
    } catch (caught) {
      setCategoryErrors((current) => new Map(current).set(id, caught instanceof Error ? caught.message : "Could not calculate this category breakdown."))
    } finally {
      setLoadingCategories((current) => { const next = new Set(current); next.delete(id); return next })
    }
  }
  const openCategory = async (id: string, label: string) => {
    if (expandedCategories.has(id)) { toggleCategory(id); return }
    toggleCategory(id)
    await loadCategory(id, label)
  }
  const toggleProcess = (id: string) => setExpandedProcesses((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const toggleFlow = (id: string) => setCollapsedFlows((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const processFlows = (processName: string, processId: string, categoryLabel: string) => {
    const contributionGraph = contributionGraphFor(categoryLabel)
    if (contributionGraph) {
      const occurrenceIds = new Set(contributionGraph.nodes
        .filter((node) => node.kind === "process" && (
          node.activity_id === processId
          || cleanImpactProcessName(node.process_name).toLowerCase() === cleanImpactProcessName(processName).toLowerCase()
        ))
        .map((node) => node.id))
      const grouped = contributionGraph.flows
        .filter((flow) => occurrenceIds.has(flow.process_occurrence_id))
        .reduce((rows, flow) => {
          const key = `${flow.kind}:${normalizedFlow(flow.flow_name)}:${flow.unit}`
          const existing = rows.get(key) ?? {
            name: flow.flow_name,
            category: `elementary flows/${flow.categories.join("/") || (flow.kind === "emission" ? "air" : "resource")}`,
            amount: 0,
            impact: 0,
            unit: flow.unit,
          }
          existing.amount += flow.amount
          existing.impact += flow.score
          rows.set(key, existing)
          return rows
        }, new Map<string, { name: string; category: string; amount: number; impact: number; unit: string }>())
      return [...grouped.values()].map((flow) => ({
        ...flow,
        factor: flow.amount ? flow.impact / flow.amount : 0,
      })).sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
    }
    const process = yamlProcessByName.get(processName.toLowerCase())
      ?? yamlProcessByName.get(cleanImpactProcessName(processName).toLowerCase())
    const scale = result.scaling_vector[processId]
      ?? result.scaling_vector[processName]
      ?? result.scaling_vector[process?.name ?? ""]
      ?? 1
    const flows = [...(process?.emissions ?? []), ...(process?.extractions ?? process?.resources ?? process?.resource_inputs ?? [])]
    const relevant = flows.map((flow) => ({ ...flow, factor: impactFactor(categoryLabel, flow.flow) })).filter((flow) => flow.factor !== null)
    return relevant.map((flow) => ({
      name: flow.flow,
      category: "elementary flows/air",
      amount: flow.amount * scale,
      factor: flow.factor!,
      impact: flow.amount * scale * flow.factor!,
      unit: flow.unit ?? "kg",
    }))
  }

  return <div className="impact-view">
    <div className="impact-title"><div><strong>Impact analysis</strong><span>{result.name} · {result.method}</span></div></div>
    <div className="impact-controls">
      <span>Sub-group by</span>
      <RadioGroup className="impact-subgroup" value={subgroup} onValueChange={(value) => setSubgroup(value as "processes" | "flows")} aria-label="Sub-group impact results">
        <label><RadioGroupItem className="app-radio" value="processes" /> Processes</label>
        <label><RadioGroupItem className="app-radio" value="flows" /> Flows</label>
      </RadioGroup>
      <i />
      <label className="impact-threshold">Don’t show &lt; <Input type="number" min="0" max="100" step="0.1" value={threshold} onChange={(event) => setThreshold(Math.max(0, Number(event.target.value)))} /> %</label>
    </div>
    <div className="impact-table-wrap"><table className="impact-table" style={{ width: Math.max(1100, columnWidths.reduce((sum, width) => sum + width, 0)) }}>
      <ResizableTableHeader labels={["Name", "Category", "Inventory result", "Characterization factor", "Impact assessment result"]} widths={columnWidths} onWidthsChange={setColumnWidths} />
      <tbody>{[...categories.values()].map((category) => {
        const categoryId = category.id || category.label
        const isOpen = expandedCategories.has(categoryId)
        const processes = category.processes
          .filter((process) => Math.abs(process.percentage ?? (category.total_score ? process.direct_score / category.total_score * 100 : 0)) >= threshold)
          .sort((left, right) => Math.abs(right.direct_score) - Math.abs(left.direct_score))
        return <Fragment key={categoryId}>
          <tr className="impact-category-row" onClick={() => void openCategory(categoryId, category.label)}>
            <td><div className="impact-category-name"><button className={`tree-toggle ${isOpen ? "is-expanded" : ""}`} onClick={(event) => { event.stopPropagation(); void openCategory(categoryId, category.label) }} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${category.label}`}><ChevronDown size={14} /></button><BarChart3 className="impact-category-icon" size={17} /><strong>{impactCategoryDisplayName(category.label)}</strong></div></td>
            <td /><td /><td /><td><span className="impact-result">{formatNumber(category.total_score)} <small>{category.unit}</small></span></td>
          </tr>
          {isOpen && loadingCategories.has(categoryId) ? <tr className="impact-breakdown-status"><td colSpan={5}>Calculating process and elementary-flow children…</td></tr> : null}
          {isOpen && categoryErrors.has(categoryId) ? <tr className="impact-breakdown-status is-error"><td colSpan={5}>{categoryErrors.get(categoryId)}</td></tr> : null}
          {isOpen && subgroup === "processes" ? processes.flatMap((process) => {
            const processKey = `${categoryId}:${process.process_id}`
            const flows = processFlows(process.process_name, process.process_id, category.label)
            const processOpen = expandedProcesses.has(processKey)
            const displayName = cleanImpactProcessName(process.process_name)
            const processRow = <tr className="impact-process-row" key={processKey} onClick={() => flows.length && toggleProcess(processKey)}>
              <td><span className="impact-indent" />{flows.length ? <button className={`tree-toggle ${processOpen ? "is-expanded" : ""}`} onClick={(event) => { event.stopPropagation(); toggleProcess(processKey) }} aria-expanded={processOpen} aria-label={`${processOpen ? "Collapse" : "Expand"} ${displayName}`}><ChevronDown size={14} /></button> : <span className="tree-toggle-spacer" />}<span className="impact-process-icon"><Factory size={14} /></span>{displayName}</td>
              <td /><td /><td /><td><span className="impact-bar"><i style={{ width: `${Math.min(100, Math.abs(process.percentage ?? (category.total_score ? process.direct_score / category.total_score * 100 : 0)))}%` }} /></span><span className="impact-result">{formatNumber(process.direct_score)} <small>{category.unit}</small></span></td>
            </tr>
            const flowRows = processOpen ? flows.map((flow) => <tr className="impact-flow-row" key={`${processKey}:${flow.name}`}>
              <td><span className="impact-indent flow" /><span className="impact-flow-icon"><Leaf size={14} /></span>{inventoryFlowName(flow.name)}</td>
              <td>{flow.category}</td>
              <td className="number">{formatNumber(flow.amount)} <small>{flow.unit}</small></td>
              <td className="number">{formatNumber(flow.factor)} <small>{category.unit}/{flow.unit}</small></td>
              <td><span className="impact-bar flow"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{formatNumber(flow.impact)} <small>{category.unit}</small></span></td>
            </tr>) : []
            return [processRow, ...flowRows]
          }) : null}
          {isOpen && subgroup === "flows" ? [...processes.reduce((grouped, process) => {
            processFlows(process.process_name, process.process_id, category.label).forEach((flow) => {
              const key = normalizedFlow(flow.name)
              const existing = grouped.get(key) ?? {
                name: flow.name,
                category: flow.category,
                factor: flow.factor,
                unit: flow.unit,
                amount: 0,
                impact: 0,
                processes: [] as Array<{ id: string; name: string; amount: number; impact: number }>,
              }
              existing.amount += flow.amount
              existing.impact += flow.impact
              existing.processes.push({
                id: process.process_id,
                name: cleanImpactProcessName(process.process_name),
                amount: flow.amount,
                impact: flow.impact,
              })
              grouped.set(key, existing)
            })
            return grouped
          }, new Map<string, {
            name: string
            category: string
            factor: number
            unit: string
            amount: number
            impact: number
            processes: Array<{ id: string; name: string; amount: number; impact: number }>
          }>()).entries()]
            .map(([flowKey, flow]) => ({ flowKey, ...flow }))
            .filter((flow) => Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0) >= threshold)
            .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
            .flatMap((flow) => {
              const flowId = `${categoryId}:flow:${flow.flowKey}`
              const flowOpen = !collapsedFlows.has(flowId)
              const flowRow = <tr className="impact-flow-group-row" key={flowId} onClick={() => toggleFlow(flowId)}>
                <td><span className="impact-indent" /><button className={`tree-toggle ${flowOpen ? "is-expanded" : ""}`} onClick={(event) => { event.stopPropagation(); toggleFlow(flowId) }} aria-expanded={flowOpen} aria-label={`${flowOpen ? "Collapse" : "Expand"} ${flow.name}`}><ChevronDown size={14} /></button><span className="impact-flow-icon"><Leaf size={14} /></span>{inventoryFlowName(flow.name)}</td>
                <td>{flow.category}</td>
                <td className="number">{formatNumber(flow.amount)} <small>{flow.unit}</small></td>
                <td className="number">{formatNumber(flow.factor)} <small>{category.unit}/{flow.unit}</small></td>
                <td><span className="impact-bar flow"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? flow.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{formatNumber(flow.impact)} <small>{category.unit}</small></span></td>
              </tr>
              const processRows = flowOpen ? flow.processes
                .filter((process) => Math.abs(category.total_score ? process.impact / category.total_score * 100 : 0) >= threshold)
                .sort((left, right) => Math.abs(right.impact) - Math.abs(left.impact))
                .map((process) => <tr className="impact-flow-process-row" key={`${flowId}:${process.id}`}>
                  <td><span className="impact-indent flow-process" /><span className="impact-process-icon"><Factory size={14} /></span>{process.name}</td>
                  <td /><td className="number">{formatNumber(process.amount)} <small>{flow.unit}</small></td><td />
                  <td><span className="impact-bar"><i style={{ width: `${Math.min(100, Math.abs(category.total_score ? process.impact / category.total_score * 100 : 0))}%` }} /></span><span className="impact-result">{formatNumber(process.impact)} <small>{category.unit}</small></span></td>
                </tr>) : []
              return [flowRow, ...processRows]
            }) : null}
        </Fragment>
      })}</tbody>
    </table></div>
  </div>
}
