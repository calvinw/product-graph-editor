import { describe, expect, it } from "vitest"
import { documentToken } from "@/lib/versionHistory"
import type { DocumentSnapshot } from "@/lib/versionHistory"
import type { SessionDocument } from "@/lib/modelWorkspace"

function session(overrides: Partial<SessionDocument> = {}): SessionDocument {
  return {
    kind: "session",
    id: "s1",
    title: "Jacket",
    filename: "jacket.yaml",
    committedYaml: "name: Jacket",
    source: "new",
    ...overrides,
  }
}

function snapshot(overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  const document = session()
  return {
    activeDocument: document,
    sessionDocuments: [document],
    yamlDraft: "name: Jacket",
    appliedYaml: "name: Jacket",
    ...overrides,
  }
}

describe("documentToken", () => {
  it("is stable for the same document", () => {
    expect(documentToken(snapshot())).toBe(documentToken(snapshot()))
  })

  it("changes when the draft changes", () => {
    // This is the whole point: a hand edit between turns must invalidate a
    // proposal the assistant wrote against the older text.
    expect(documentToken(snapshot())).not.toBe(documentToken(snapshot({ yamlDraft: "name: Edited" })))
  })

  it("changes when switching to a different model", () => {
    const other = session({ id: "s2", title: "Tote" })
    expect(documentToken(snapshot())).not.toBe(documentToken(snapshot({ activeDocument: other })))
  })

  it("notices a single character of difference", () => {
    expect(documentToken(snapshot({ yamlDraft: "amount: 1.0" })))
      .not.toBe(documentToken(snapshot({ yamlDraft: "amount: 2.0" })))
  })

  it("is unaffected by appliedYaml, which the assistant never reads", () => {
    // The token guards the content the assistant rewrites. Applying or
    // recalculating without touching the draft should not invalidate a
    // proposal in flight.
    expect(documentToken(snapshot({ appliedYaml: "name: Jacket" })))
      .toBe(documentToken(snapshot({ appliedYaml: "something else entirely" })))
  })

  it("is a short hex string, safe to round-trip through a tool call", () => {
    expect(documentToken(snapshot())).toMatch(/^[0-9a-f]{8}$/)
  })
})
