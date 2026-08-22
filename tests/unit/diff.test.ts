import { describe, expect, it } from "vitest"
import { collapseContext, diffLines, diffStat, type DiffLine } from "@/lib/diff"

const render = (lines: DiffLine[]) => lines.map((line) => (
  line.kind === "gap" ? `… ${line.count}`
    : line.kind === "added" ? `+${line.text}`
      : line.kind === "removed" ? `-${line.text}`
        : ` ${line.text}`
))

describe("diffLines", () => {
  it("reports no changes for identical documents", () => {
    const lines = diffLines("a\nb\nc", "a\nb\nc")
    expect(lines.every((line) => line.kind === "context")).toBe(true)
    expect(diffStat(lines)).toEqual({ added: 0, removed: 0 })
  })

  it("detects an inserted line without rewriting its neighbours", () => {
    expect(render(diffLines("a\nc", "a\nb\nc"))).toEqual([" a", "+b", " c"])
  })

  it("detects a removed line", () => {
    expect(render(diffLines("a\nb\nc", "a\nc"))).toEqual([" a", "-b", " c"])
  })

  it("shows a changed line as a removal plus an addition", () => {
    expect(render(diffLines("a\nb\nc", "a\nB\nc"))).toEqual([" a", "-b", "+B", " c"])
  })

  it("handles an empty document on either side", () => {
    expect(render(diffLines("", "a\nb"))).toEqual(["+a", "+b"])
    expect(render(diffLines("a\nb", ""))).toEqual(["-a", "-b"])
  })

  it("ignores a trailing newline difference", () => {
    // Otherwise every document that gained or lost a final newline would look
    // like it changed on its last line.
    expect(diffStat(diffLines("a\nb\n", "a\nb"))).toEqual({ added: 0, removed: 0 })
  })

  it("counts additions and removals", () => {
    const lines = diffLines("a\nb\nc", "a\nX\nY\nc")
    expect(diffStat(lines)).toEqual({ added: 2, removed: 1 })
  })

  it("keeps a realistic YAML edit localised", () => {
    const before = ["name: Jacket", "processes:", "  - name: P1", "    amount: 1.0", "  - name: P2"].join("\n")
    const after = ["name: Jacket", "processes:", "  - name: P1", "    amount: 2.5", "  - name: P2"].join("\n")
    expect(render(diffLines(before, after))).toEqual([
      " name: Jacket",
      " processes:",
      "   - name: P1",
      "-    amount: 1.0",
      "+    amount: 2.5",
      "   - name: P2",
    ])
  })
})

describe("collapseContext", () => {
  const long = (changeAt: number, total = 30) => {
    const before = Array.from({ length: total }, (_, index) => `line ${index}`)
    const after = [...before]
    after[changeAt] = "CHANGED"
    return diffLines(before.join("\n"), after.join("\n"))
  }

  it("keeps context either side of a change and collapses the rest", () => {
    const collapsed = collapseContext(long(15), 2)
    expect(collapsed.some((line) => line.kind === "gap")).toBe(true)
    // The changed lines survive.
    expect(collapsed.some((line) => line.kind === "removed" && line.text === "line 15")).toBe(true)
    expect(collapsed.some((line) => line.kind === "added" && line.text === "CHANGED")).toBe(true)
    // And the two lines either side of the change survive as context.
    expect(collapsed.some((line) => line.kind === "context" && line.text === "line 13")).toBe(true)
    expect(collapsed.some((line) => line.kind === "context" && line.text === "line 17")).toBe(true)
  })

  it("collapses far fewer lines than it drops", () => {
    const full = long(15)
    const collapsed = collapseContext(full, 2)
    expect(collapsed.length).toBeLessThan(full.length)
  })

  it("reports how many lines each gap hides", () => {
    const collapsed = collapseContext(long(15), 2)
    const gaps = collapsed.filter((line) => line.kind === "gap")
    const hidden = gaps.reduce((sum, gap) => sum + (gap.kind === "gap" ? gap.count : 0), 0)
    expect(hidden).toBeGreaterThan(0)
    expect(hidden + collapsed.length - gaps.length).toBe(long(15).length)
  })

  it("leaves a short diff alone", () => {
    const lines = diffLines("a\nb", "a\nB")
    expect(collapseContext(lines, 3)).toEqual(lines)
  })

  it("collapses an unchanged document entirely", () => {
    const lines = diffLines("a\nb\nc", "a\nb\nc")
    expect(collapseContext(lines, 2)).toEqual([{ kind: "gap", count: 3 }])
  })
})
