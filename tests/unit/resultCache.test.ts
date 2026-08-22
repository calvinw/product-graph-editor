import { describe, expect, it } from "vitest"
import { createResultCache } from "@/lib/resultCache"
import type { LcaResult } from "@/lib/lcaApi"

const result = (id: string) => ({ result_id: id } as unknown as LcaResult)

describe("createResultCache", () => {
  it("returns undefined for an unseen document", () => {
    expect(createResultCache().get("name: A")).toBeUndefined()
  })

  it("returns the exact result for the exact source", () => {
    const cache = createResultCache()
    cache.set("name: A", result("a"))
    expect(cache.get("name: A")?.result_id).toBe("a")
  })

  it("treats a one-character difference as a different document", () => {
    // The key is the source itself, so there is no collision to reason about.
    const cache = createResultCache()
    cache.set("amount: 1.0", result("one"))
    expect(cache.get("amount: 2.0")).toBeUndefined()
  })

  it("overwrites rather than duplicating when the same source is recalculated", () => {
    const cache = createResultCache()
    cache.set("name: A", result("first"))
    cache.set("name: A", result("second"))
    expect(cache.get("name: A")?.result_id).toBe("second")
    expect(cache.size).toBe(1)
  })

  it("evicts the oldest entry past the limit", () => {
    const cache = createResultCache(2)
    cache.set("a", result("a"))
    cache.set("b", result("b"))
    cache.set("c", result("c"))
    expect(cache.size).toBe(2)
    expect(cache.get("a")).toBeUndefined()
    expect(cache.get("b")?.result_id).toBe("b")
    expect(cache.get("c")?.result_id).toBe("c")
  })

  it("is least-recently-used, not least-recently-written", () => {
    // Stepping back to an old version should keep it warm, so that stepping
    // back and forth repeatedly stays instant.
    const cache = createResultCache(2)
    cache.set("a", result("a"))
    cache.set("b", result("b"))
    cache.get("a")
    cache.set("c", result("c"))
    expect(cache.get("a")?.result_id).toBe("a")
    expect(cache.get("b")).toBeUndefined()
  })

  it("clears everything", () => {
    const cache = createResultCache()
    cache.set("a", result("a"))
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.get("a")).toBeUndefined()
  })
})
