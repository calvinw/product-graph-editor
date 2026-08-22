import { describe, expect, it } from "vitest"
import {
  createMemoryVersionStore,
  createVersion,
  historyKeyFor,
  shouldAppend,
  snapshotsEqual,
  TRANSIENT_HISTORY_KEY,
  type DocumentSnapshot,
} from "@/lib/versionHistory"
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

describe("snapshotsEqual", () => {
  it("matches identical snapshots", () => {
    expect(snapshotsEqual(snapshot(), snapshot())).toBe(true)
  })

  it("separates a draft edit from the applied document", () => {
    expect(snapshotsEqual(snapshot(), snapshot({ yamlDraft: "name: Edited" }))).toBe(false)
    expect(snapshotsEqual(snapshot(), snapshot({ appliedYaml: "name: Edited" }))).toBe(false)
  })

  it("notices document metadata changes such as a rename", () => {
    const renamed = session({ title: "Renamed" })
    expect(snapshotsEqual(snapshot(), snapshot({ activeDocument: renamed }))).toBe(false)
  })

  it("notices a change to the session document list", () => {
    const extra = session({ id: "s2", title: "Second" })
    expect(snapshotsEqual(snapshot(), snapshot({ sessionDocuments: [session(), extra] }))).toBe(false)
  })
})

describe("shouldAppend", () => {
  it("always appends to an empty history", () => {
    expect(shouldAppend([], snapshot())).toBe(true)
  })

  it("refuses a snapshot identical to the head", () => {
    const history = [createVersion(snapshot(), { label: "Saved", source: "you" })]
    expect(shouldAppend(history, snapshot())).toBe(false)
  })

  it("appends when the document has moved on", () => {
    const history = [createVersion(snapshot(), { label: "Saved", source: "you" })]
    expect(shouldAppend(history, snapshot({ yamlDraft: "name: Edited" }))).toBe(true)
  })

  it("compares against the head only, not the whole history", () => {
    // Returning to an earlier state is a real event worth recording, so an
    // older identical entry must not suppress the append.
    const original = snapshot()
    const edited = snapshot({ yamlDraft: "name: Edited" })
    const history = [
      createVersion(original, { label: "Saved", source: "you" }),
      createVersion(edited, { label: "Edited", source: "assistant" }),
    ]
    expect(shouldAppend(history, original)).toBe(true)
  })
})

describe("historyKeyFor", () => {
  it("keys a session document by its id", () => {
    expect(historyKeyFor(session({ id: "abc" }))).toBe("abc")
  })

  it("keys a template by its id", () => {
    expect(historyKeyFor({
      kind: "template",
      id: "jacket",
      title: "Jacket",
      filename: "jacket.yaml",
      committedYaml: "",
    })).toBe("jacket")
  })

  it("buckets transient documents together", () => {
    expect(historyKeyFor(null)).toBe(TRANSIENT_HISTORY_KEY)
    expect(historyKeyFor({
      kind: "new",
      title: "Untitled model",
      filename: "untitled-model.yaml",
      committedYaml: "",
      previousDocument: null,
    })).toBe(TRANSIENT_HISTORY_KEY)
    expect(historyKeyFor({
      kind: "invalid-upload",
      title: "broken",
      filename: "broken.yaml",
      committedYaml: "",
      previousDocument: null,
    })).toBe(TRANSIENT_HISTORY_KEY)
  })

  it("gives two different models separate histories", () => {
    expect(historyKeyFor(session({ id: "a" }))).not.toBe(historyKeyFor(session({ id: "b" })))
  })
})

describe("createVersion", () => {
  it("stamps an id and an ISO timestamp", () => {
    const version = createVersion(snapshot(), { label: "Saved", source: "you" })
    expect(version.id).toBeTruthy()
    expect(version.label).toBe("Saved")
    expect(version.source).toBe("you")
    expect(new Date(version.timestamp).toISOString()).toBe(version.timestamp)
  })

  it("gives distinct ids to successive versions", () => {
    const a = createVersion(snapshot(), { label: "a", source: "you" })
    const b = createVersion(snapshot(), { label: "b", source: "you" })
    expect(a.id).not.toBe(b.id)
  })
})

describe("createMemoryVersionStore", () => {
  it("returns an empty list for an unknown model", () => {
    expect(createMemoryVersionStore().list("nope")).toEqual([])
  })

  it("appends in order and reads back by id", () => {
    const store = createMemoryVersionStore()
    const first = createVersion(snapshot(), { label: "First", source: "you" })
    const second = createVersion(snapshot({ yamlDraft: "b" }), { label: "Second", source: "assistant" })
    store.append("m1", first)
    store.append("m1", second)

    expect(store.list("m1").map((version) => version.label)).toEqual(["First", "Second"])
    expect(store.get(second.id)?.label).toBe("Second")
  })

  it("keeps models isolated from each other", () => {
    const store = createMemoryVersionStore()
    store.append("m1", createVersion(snapshot(), { label: "One", source: "you" }))
    store.append("m2", createVersion(snapshot(), { label: "Two", source: "you" }))
    expect(store.list("m1").map((version) => version.label)).toEqual(["One"])
    expect(store.list("m2").map((version) => version.label)).toEqual(["Two"])
  })

  it("never mutates a previously returned list", () => {
    // Callers hold these arrays in React state, so append must not change
    // an array that has already been rendered.
    const store = createMemoryVersionStore()
    store.append("m1", createVersion(snapshot(), { label: "One", source: "you" }))
    const before = store.list("m1")
    store.append("m1", createVersion(snapshot({ yamlDraft: "b" }), { label: "Two", source: "you" }))
    expect(before).toHaveLength(1)
    expect(store.list("m1")).toHaveLength(2)
  })

  it("clear drops every model's history, including lookup by id", () => {
    // Document ids can repeat after a reset, so leftover history would
    // otherwise attach itself to an unrelated new document.
    const store = createMemoryVersionStore()
    const version = createVersion(snapshot(), { label: "One", source: "you" })
    store.append("m1", version)
    store.append("m2", createVersion(snapshot(), { label: "Two", source: "you" }))
    store.clear()
    expect(store.list("m1")).toEqual([])
    expect(store.list("m2")).toEqual([])
    expect(store.get(version.id)).toBeUndefined()
  })

  it("is append-only: nothing is discarded when a later state is recorded", () => {
    const store = createMemoryVersionStore()
    const v1 = createVersion(snapshot(), { label: "v1", source: "you" })
    const v2 = createVersion(snapshot({ yamlDraft: "b" }), { label: "v2", source: "you" })
    store.append("m1", v1)
    store.append("m1", v2)
    // Restoring v1 appends a copy rather than truncating, so v2 survives.
    store.append("m1", createVersion(v1.snapshot, { label: "Restored v1", source: "you" }))
    expect(store.list("m1").map((version) => version.label)).toEqual(["v1", "v2", "Restored v1"])
    expect(store.get(v2.id)).toBeDefined()
  })
})
