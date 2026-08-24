import type { LcaResult } from "./lcaApi"

/**
 * A small LRU of calculated results, keyed by the exact YAML that produced
 * them.
 *
 * Undo changes `appliedYaml`, which normally means waiting for the server to
 * recalculate before the scores come back. Stepping back to a document that
 * was calculated a minute ago should not need a round trip: the same input
 * deterministically produces the same result, so a cache hit is exact rather
 * than an approximation.
 *
 * Keyed on the source itself, so there is no hash collision to reason about
 * and no invalidation policy to get wrong -- different YAML is simply a
 * different key.
 */
export type ResultCache = {
  get(source: string): LcaResult | undefined
  set(source: string, result: LcaResult): void
  clear(): void
  readonly size: number
}

export const DEFAULT_RESULT_CACHE_LIMIT = 20

export function createResultCache(limit = DEFAULT_RESULT_CACHE_LIMIT): ResultCache {
  // Map keeps insertion order, so the oldest key is simply the first one.
  // Re-inserting on read is what makes it least-recently-used rather than
  // least-recently-written: revisiting an old version keeps it warm.
  const entries = new Map<string, LcaResult>()
  return {
    get(source) {
      const result = entries.get(source)
      if (result === undefined) return undefined
      entries.delete(source)
      entries.set(source, result)
      return result
    },
    set(source, result) {
      if (entries.has(source)) entries.delete(source)
      entries.set(source, result)
      while (entries.size > limit) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },
    clear: () => entries.clear(),
    get size() { return entries.size },
  }
}

/**
 * The application's cache. Module-level so the calculation hook can fill it
 * and the restore path can read it without threading an instance through.
 */
export const resultCache = createResultCache()
