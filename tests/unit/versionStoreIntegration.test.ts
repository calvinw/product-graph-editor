import { beforeEach, describe, expect, it } from "vitest"
import { useProductGraphStore } from "@/state/productGraphStore"
import type { SessionDocument } from "@/lib/modelWorkspace"

/**
 * Exercises the store wiring rather than the pure helpers: dedupe, per-model
 * history, and the restore path's deliberate choice not to disturb graph mode
 * or the selection.
 */

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

const actions = () => useProductGraphStore.getState().actions
const state = () => useProductGraphStore.getState()

/** Open a document the way the app does: commit it, apply it, record a baseline. */
function open(document: SessionDocument, label = "Opened") {
  actions().dispatchWorkspace({ type: "commit-new-session", document })
  actions().applySource(document.committedYaml)
  return actions().commitVersion({ label })
}

beforeEach(() => {
  actions().reset()
})

describe("commitVersion", () => {
  it("records a baseline and exposes it as state", () => {
    open(session())
    expect(state().versions).toHaveLength(1)
    expect(state().versions[0].label).toBe("Opened")
    expect(state().versions[0].snapshot.appliedYaml).toBe("name: Jacket")
  })

  it("defaults the author to you, and records the assistant when told", () => {
    open(session())
    actions().dispatchWorkspace({ type: "edit-draft", yaml: "name: Edited" })
    actions().commitVersion({ label: "Proposal", source: "assistant" })
    expect(state().versions.map((version) => version.source)).toEqual(["you", "assistant"])
  })

  it("dedupes: recording an unchanged document adds nothing", () => {
    open(session())
    expect(actions().commitVersion({ label: "Again" })).toBeNull()
    expect(state().versions).toHaveLength(1)
  })

  it("records once the draft actually moves", () => {
    open(session())
    actions().dispatchWorkspace({ type: "edit-draft", yaml: "name: Edited" })
    expect(actions().commitVersion({ label: "Edited" })).not.toBeNull()
    expect(state().versions).toHaveLength(2)
  })

  it("treats a rename as a change worth recording", () => {
    open(session())
    actions().dispatchWorkspace({ type: "rename-active", title: "Renamed" })
    expect(actions().commitVersion({ label: "Renamed" })).not.toBeNull()
  })

  it("keeps each model's history separate and swaps it on switch", () => {
    const first = session({ id: "a", title: "A", committedYaml: "name: A" })
    const second = session({ id: "b", title: "B", committedYaml: "name: B" })
    open(first, "Opened A")
    open(second, "Opened B")
    expect(state().versions.map((version) => version.label)).toEqual(["Opened B"])

    // Switching back must surface A's history, not B's.
    actions().dispatchWorkspace({ type: "load-document", document: first })
    expect(state().versions.map((version) => version.label)).toEqual(["Opened A"])
  })
})

describe("restoreVersion", () => {
  it("returns null for an unknown id and changes nothing", () => {
    open(session())
    const before = state().appliedRevision
    expect(actions().restoreVersion("nope")).toBeNull()
    expect(state().appliedRevision).toBe(before)
  })

  it("puts the recorded document back and advances the revision", () => {
    const baseline = open(session())!
    actions().dispatchWorkspace({ type: "edit-draft", yaml: "name: Edited" })
    actions().applySource("name: Edited")
    actions().commitVersion({ label: "Edited" })
    expect(state().appliedYaml).toBe("name: Edited")

    const before = state().appliedRevision
    const revision = actions().restoreVersion(baseline.id)
    expect(revision).toBe(before + 1)
    expect(state().appliedYaml).toBe("name: Jacket")
    expect(state().workspace.yamlDraft).toBe("name: Jacket")
  })

  it("appends rather than truncating, so what was ahead stays reachable", () => {
    const baseline = open(session())!
    actions().dispatchWorkspace({ type: "edit-draft", yaml: "name: Edited" })
    actions().applySource("name: Edited")
    const edited = actions().commitVersion({ label: "Edited" })!

    actions().restoreVersion(baseline.id)
    expect(state().versions.map((version) => version.label)).toEqual(["Opened", "Edited", "Restored Opened"])

    // The later version is still there, so going forward again works.
    actions().restoreVersion(edited.id)
    expect(state().appliedYaml).toBe("name: Edited")
  })

  it("does not eject you from scaled mode or clear the selection", () => {
    // The whole reason restore avoids applySource: that would reset the mode,
    // null the selection, and blank the result.
    const baseline = open(session())!
    actions().setGraphMode("scaled")
    actions().selectNode({ id: "n1", label: "Node", kind: "process", detail: "", color: "#fff" })
    actions().dispatchWorkspace({ type: "edit-draft", yaml: "name: Edited" })
    actions().applySource("name: Edited")
    actions().commitVersion({ label: "Edited" })

    actions().setGraphMode("scaled")
    actions().selectNode({ id: "n1", label: "Node", kind: "process", detail: "", color: "#fff" })
    actions().restoreVersion(baseline.id)

    expect(state().graphMode).toBe("scaled")
    expect(state().selectedNode?.id).toBe("n1")
  })

  it("clears scenario overrides, which described the document being left", () => {
    const baseline = open(session())!
    actions().dispatchWorkspace({ type: "edit-draft", yaml: "name: Edited" })
    actions().applySource("name: Edited")
    actions().commitVersion({ label: "Edited" })
    actions().setScenarioOverride("link-1", 42)
    expect(state().scenarioOverrides).toEqual({ "link-1": 42 })

    actions().restoreVersion(baseline.id)
    expect(state().scenarioOverrides).toEqual({})
  })

  it("does not claim the previous result is valid for the restored document", () => {
    // scenarioCommitRevision would mark the stale result usable; an arbitrary
    // restore must recalculate instead.
    const baseline = open(session())!
    actions().dispatchWorkspace({ type: "edit-draft", yaml: "name: Edited" })
    actions().applySource("name: Edited")
    actions().commitVersion({ label: "Edited" })

    actions().restoreVersion(baseline.id)
    expect(state().scenarioCommitRevision).toBeNull()
    expect(state().calculatedRevision).not.toBe(state().appliedRevision)
  })

  it("restoring the state you are already in records nothing new", () => {
    const baseline = open(session())!
    actions().restoreVersion(baseline.id)
    expect(state().versions).toHaveLength(1)
  })
})
