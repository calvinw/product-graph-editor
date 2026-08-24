import { describe, expect, it } from "vitest"
import {
  initialModelWorkspace,
  modelWorkspaceReducer,
  safeYamlFilename,
  uniqueSessionTitle,
  yamlFilenameStem,
  type ModelWorkspaceState,
  type SessionDocument,
} from "@/lib/modelWorkspace"

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

function stateWith(document: SessionDocument, draft = document.committedYaml): ModelWorkspaceState {
  return { activeDocument: document, sessionDocuments: [document], yamlDraft: draft }
}

describe("modelWorkspaceReducer", () => {
  it("is pure: the input state is never mutated", () => {
    const before = stateWith(session())
    const snapshot = structuredClone(before)
    modelWorkspaceReducer(before, { type: "edit-draft", yaml: "changed" })
    expect(before).toEqual(snapshot)
  })

  describe("edit-draft", () => {
    it("changes only the draft", () => {
      const before = stateWith(session())
      const after = modelWorkspaceReducer(before, { type: "edit-draft", yaml: "name: Edited" })
      expect(after.yamlDraft).toBe("name: Edited")
      expect(after.activeDocument).toBe(before.activeDocument)
      expect(after.sessionDocuments).toBe(before.sessionDocuments)
    })
  })

  describe("load-document", () => {
    it("resets the draft to the loaded document's committed content", () => {
      const other = session({ id: "s2", title: "Tote", committedYaml: "name: Tote" })
      const after = modelWorkspaceReducer(stateWith(session(), "unsaved edits"), {
        type: "load-document",
        document: other,
      })
      expect(after.activeDocument).toEqual(other)
      expect(after.yamlDraft).toBe("name: Tote")
    })
  })

  describe("commit-new-session", () => {
    it("appends to the session list and makes the new document active", () => {
      const existing = session()
      const added = session({ id: "s2", title: "Copy of Jacket", committedYaml: "name: Copy" })
      const after = modelWorkspaceReducer(stateWith(existing), { type: "commit-new-session", document: added })
      expect(after.sessionDocuments).toHaveLength(2)
      expect(after.sessionDocuments[1]).toEqual(added)
      expect(after.activeDocument).toEqual(added)
      expect(after.yamlDraft).toBe("name: Copy")
    })
  })

  describe("commit-active-session", () => {
    it("writes the draft into both the active document and the session list", () => {
      const after = modelWorkspaceReducer(stateWith(session(), "name: Saved"), {
        type: "commit-active-session",
        yaml: "name: Saved",
      })
      expect(after.activeDocument?.committedYaml).toBe("name: Saved")
      expect(after.sessionDocuments[0].committedYaml).toBe("name: Saved")
      // Committing makes the document clean: draft and committed now agree.
      expect(after.yamlDraft).toBe(after.activeDocument?.committedYaml)
    })

    it("ignores a non-session active document", () => {
      const before: ModelWorkspaceState = { ...initialModelWorkspace, yamlDraft: "draft" }
      expect(modelWorkspaceReducer(before, { type: "commit-active-session", yaml: "x" })).toBe(before)
    })
  })

  describe("rename-active", () => {
    it("retitles the document, derives a new filename, and leaves the draft alone", () => {
      const after = modelWorkspaceReducer(stateWith(session(), "in-progress edits"), {
        type: "rename-active",
        title: "My Winter Jacket",
      })
      expect(after.activeDocument?.title).toBe("My Winter Jacket")
      expect(after.activeDocument?.filename).toBe("my-winter-jacket.yaml")
      expect(after.sessionDocuments[0].title).toBe("My Winter Jacket")
      // A rename must not discard uncommitted work.
      expect(after.yamlDraft).toBe("in-progress edits")
    })

    it("ignores a non-session active document", () => {
      expect(modelWorkspaceReducer(initialModelWorkspace, { type: "rename-active", title: "x" }))
        .toBe(initialModelWorkspace)
    })
  })

  describe("start-new and discard", () => {
    it("remembers the previous document so discard can restore it", () => {
      const original = session()
      const blank = modelWorkspaceReducer(stateWith(original), { type: "start-new" })
      expect(blank.activeDocument?.kind).toBe("new")
      expect(blank.yamlDraft).toBe("")

      const restored = modelWorkspaceReducer(blank, { type: "discard" })
      expect(restored.activeDocument).toEqual(original)
      expect(restored.yamlDraft).toBe(original.committedYaml)
    })

    it("does not stack transient documents: two New actions still restore the real one", () => {
      const original = session()
      const once = modelWorkspaceReducer(stateWith(original), { type: "start-new" })
      const twice = modelWorkspaceReducer(once, { type: "start-new" })
      const restored = modelWorkspaceReducer(twice, { type: "discard" })
      expect(restored.activeDocument).toEqual(original)
    })

    it("discarding on a session document reverts the draft, not the document", () => {
      const after = modelWorkspaceReducer(stateWith(session(), "unsaved"), { type: "discard" })
      expect(after.yamlDraft).toBe("name: Jacket")
      expect(after.activeDocument).toEqual(session())
    })
  })

  describe("start-invalid-upload", () => {
    it("keeps the unparseable text as the draft while preserving the prior document", () => {
      const original = session()
      const after = modelWorkspaceReducer(stateWith(original), {
        type: "start-invalid-upload",
        title: "broken",
        filename: "broken.yaml",
        yaml: "not: [valid",
      })
      expect(after.activeDocument?.kind).toBe("invalid-upload")
      expect(after.yamlDraft).toBe("not: [valid")
      expect(modelWorkspaceReducer(after, { type: "discard" }).activeDocument).toEqual(original)
    })
  })

  describe("delete-session", () => {
    it("removes only the named document", () => {
      const a = session({ id: "a" })
      const b = session({ id: "b" })
      const before: ModelWorkspaceState = { activeDocument: a, sessionDocuments: [a, b], yamlDraft: "" }
      const after = modelWorkspaceReducer(before, { type: "delete-session", id: "b" })
      expect(after.sessionDocuments.map((item) => item.id)).toEqual(["a"])
    })
  })
})

describe("safeYamlFilename", () => {
  it("slugifies a title", () => {
    expect(safeYamlFilename("My Winter Jacket")).toBe("my-winter-jacket.yaml")
  })

  it("strips punctuation and collapses separators", () => {
    expect(safeYamlFilename("Copy of Jacket — 1 unit (3-tier)")).toBe("copy-of-jacket-1-unit-3-tier.yaml")
  })

  it("falls back when a title has nothing usable", () => {
    expect(safeYamlFilename("///")).toBe("untitled-model.yaml")
    expect(safeYamlFilename("   ")).toBe("untitled-model.yaml")
  })
})

describe("yamlFilenameStem", () => {
  it("drops a .yaml or .yml extension", () => {
    expect(yamlFilenameStem("cotton_fiber.yaml")).toBe("cotton_fiber")
    expect(yamlFilenameStem("cotton_fiber.YML")).toBe("cotton_fiber")
  })

  it("falls back for an empty stem", () => {
    expect(yamlFilenameStem(".yaml")).toBe("Untitled model")
  })
})

describe("uniqueSessionTitle", () => {
  it("returns the title unchanged when it is free", () => {
    expect(uniqueSessionTitle("Jacket", [])).toBe("Jacket")
  })

  it("suffixes on collision, case-insensitively", () => {
    const documents = [session({ title: "Jacket" })]
    expect(uniqueSessionTitle("jacket", documents)).toBe("jacket (2)")
  })

  it("keeps counting past an existing suffix", () => {
    const documents = [
      session({ id: "1", title: "Jacket" }),
      session({ id: "2", title: "Jacket (2)" }),
    ]
    expect(uniqueSessionTitle("Jacket", documents)).toBe("Jacket (3)")
  })
})
