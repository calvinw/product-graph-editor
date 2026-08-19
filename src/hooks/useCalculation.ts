import { useCallback, useRef, useState, type RefObject } from "react"
import {
  calculateContributionGraphs, calculateLca, lcaResultToMarkdown,
  type ContributionGraph,
} from "@/lib/lcaApi"
import { useDisplaySettings } from "@/lib/displaySettings"
import { useProductGraphStore } from "@/state/productGraphStore"

/**
 * Owns the two-call LCA pipeline.
 *
 * Call 1 (`calculateSource`) establishes a baseline keyed by `result_id`.
 * Call 2 (`loadContributionGraphs`) lazily fills contribution graphs into that
 * baseline, requesting only the categories not already present and deduping
 * concurrent requests by key. `mergeContributionGraphs` rejects any batch whose
 * `result_id` no longer matches, which is what makes stale responses safe.
 *
 * State reads come from the store directly rather than through props, so the
 * component only has to supply what the hook cannot know: the applied-revision
 * ref that guards against out-of-order responses, and two callbacks.
 */
export function useCalculation({
  appliedRevisionRef,
  onResultsMarkdown,
  onOpenGraph,
}: {
  appliedRevisionRef: RefObject<number>
  onResultsMarkdown: (markdown: string) => void
  onOpenGraph: () => void
}) {
  const { decimalPlaces, showAllDecimalPlaces } = useDisplaySettings()
  const appliedYaml = useProductGraphStore((state) => state.appliedYaml)
  const appliedRevision = useProductGraphStore((state) => state.appliedRevision)
  const calculatedRevision = useProductGraphStore((state) => state.calculatedRevision)
  const lcaResult = useProductGraphStore((state) => state.lcaResult)
  const calculationStatus = useProductGraphStore((state) => state.calculationStatus)
  const {
    startCalculation, completeCalculation, failCalculation, finishCalculation,
    mergeContributionGraphs,
  } = useProductGraphStore((state) => state.actions)

  const [contributionError, setContributionError] = useState("")
  const [loadingContributionKeys, setLoadingContributionKeys] = useState<Set<string>>(() => new Set())
  const activeCalculationRef = useRef<AbortController | null>(null)
  const contributionRequestsRef = useRef<Map<string, Promise<ContributionGraph[]>>>(new Map())

  const isCalculating = calculationStatus === "calculating"
  const calculationInProgress = isCalculating || loadingContributionKeys.size > 0

  /** Abort any in-flight calculation and drop contribution state. Used when new YAML is applied. */
  const resetCalculationState = useCallback(() => {
    activeCalculationRef.current?.abort()
    activeCalculationRef.current = null
    setContributionError("")
    contributionRequestsRef.current.clear()
    setLoadingContributionKeys(new Set())
  }, [])

  const calculateSource = async (source: string, revision: number, openGraphWhenReady = false) => {
    activeCalculationRef.current?.abort()
    const controller = new AbortController()
    activeCalculationRef.current = controller
    startCalculation()
    setContributionError("")
    contributionRequestsRef.current.clear()
    setLoadingContributionKeys(new Set())
    try {
      const result = await calculateLca(source, controller.signal)
      if (controller.signal.aborted || appliedRevisionRef.current !== revision) return
      completeCalculation(result, revision)
      onResultsMarkdown(lcaResultToMarkdown(result, decimalPlaces, showAllDecimalPlaces))
      if (openGraphWhenReady) onOpenGraph()
    } catch (error) {
      if (controller.signal.aborted || appliedRevisionRef.current !== revision) return
      failCalculation(error instanceof Error ? error.message : "Could not calculate the current product graph.")
    } finally {
      if (activeCalculationRef.current === controller) {
        activeCalculationRef.current = null
        finishCalculation()
      }
    }
  }

  const loadContributionGraphs = async (requestedCategories: string[]): Promise<ContributionGraph[]> => {
    const current = lcaResult
    if (!current || calculatedRevision !== appliedRevision) {
      throw new Error("Calculate the current product graph before loading cumulative contributions.")
    }
    const availableLabels = Object.keys(current.lcia)
    const resolveLabel = (query: string) => {
      const normalized = query.trim().toLowerCase()
      const exact = availableLabels.filter((label) => label.toLowerCase() === normalized)
      const component = availableLabels.filter((label) => label.split("|")[0].trim().toLowerCase() === normalized)
      const substring = availableLabels.filter((label) => label.toLowerCase().includes(normalized))
      const matches = exact.length ? exact : component.length ? component : substring
      return matches.length === 1 ? matches[0] : query
    }
    const labels = [...new Set(requestedCategories.filter(Boolean).map(resolveLabel))]
    const existing = new Map(current.contribution_graphs.map((graph) => [graph.label, graph]))
    const missing = labels.filter((label) => !existing.has(label))
    if (!missing.length) return labels.flatMap((label) => existing.get(label) ?? [])

    const requestKey = `${current.result_id}:${[...missing].sort().join("\u001f")}`
    let request = contributionRequestsRef.current.get(requestKey)
    if (!request) {
      setLoadingContributionKeys((keys) => new Set(keys).add(requestKey))
      request = calculateContributionGraphs(appliedYaml, missing, current.result_id)
        .then((batch) => {
          mergeContributionGraphs(batch.result_id, batch.contribution_graphs)
          setContributionError("")
          return batch.contribution_graphs
        })
        .finally(() => {
          if (contributionRequestsRef.current.get(requestKey) !== request) return
          contributionRequestsRef.current.delete(requestKey)
          setLoadingContributionKeys((keys) => {
            const next = new Set(keys)
            next.delete(requestKey)
            return next
          })
        })
      contributionRequestsRef.current.set(requestKey, request)
    }
    const loaded = await request
    const combined = new Map([...existing, ...loaded.map((graph) => [graph.label, graph] as const)])
    return labels.flatMap((label) => combined.get(label) ?? [])
  }

  return {
    calculateSource,
    loadContributionGraphs,
    resetCalculationState,
    setContributionError,
    contributionError,
    loadingContributionKeys,
    isCalculating,
    calculationInProgress,
    calculationStatus,
  }
}
