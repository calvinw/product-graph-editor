import type { ProductGraphCatalogEntry } from "./lcaApi"

export type CatalogDocument = {
  kind: "catalog"
  id: string
  title: string
  filename: string
  committedYaml: string
}

export type SessionDocument = {
  kind: "session"
  id: string
  title: string
  filename: string
  committedYaml: string
  source: "new" | "catalog-copy" | "upload" | "session-copy"
}

export type ModelDocument = CatalogDocument | SessionDocument

type TransientDocumentBase = {
  title: string
  filename: string
  committedYaml: ""
  previousDocument: ModelDocument | null
}

export type TransientDocument =
  | TransientDocumentBase & { kind: "new" }
  | TransientDocumentBase & { kind: "invalid-upload" }

export type ActiveDocument = ModelDocument | TransientDocument

export type ModelWorkspaceState = {
  activeDocument: ActiveDocument | null
  sessionDocuments: SessionDocument[]
  yamlDraft: string
}

export type ModelWorkspaceAction =
  | { type: "load-document"; document: ModelDocument }
  | { type: "edit-draft"; yaml: string }
  | { type: "start-new" }
  | { type: "start-invalid-upload"; title: string; filename: string; yaml: string }
  | { type: "commit-new-session"; document: SessionDocument }
  | { type: "commit-active-session"; yaml: string }
  | { type: "discard" }

export const initialModelWorkspace: ModelWorkspaceState = {
  activeDocument: null,
  sessionDocuments: [],
  yamlDraft: "",
}

function previousDocument(activeDocument: ActiveDocument | null): ModelDocument | null {
  if (!activeDocument) return null
  if (activeDocument.kind === "new" || activeDocument.kind === "invalid-upload") {
    return activeDocument.previousDocument
  }
  return activeDocument
}

export function modelWorkspaceReducer(
  state: ModelWorkspaceState,
  action: ModelWorkspaceAction,
): ModelWorkspaceState {
  switch (action.type) {
    case "load-document":
      return { ...state, activeDocument: action.document, yamlDraft: action.document.committedYaml }
    case "edit-draft":
      return { ...state, yamlDraft: action.yaml }
    case "start-new":
      return {
        ...state,
        activeDocument: {
          kind: "new",
          title: "Untitled model",
          filename: "untitled-model.yaml",
          committedYaml: "",
          previousDocument: previousDocument(state.activeDocument),
        },
        yamlDraft: "",
      }
    case "start-invalid-upload":
      return {
        ...state,
        activeDocument: {
          kind: "invalid-upload",
          title: action.title,
          filename: action.filename,
          committedYaml: "",
          previousDocument: previousDocument(state.activeDocument),
        },
        yamlDraft: action.yaml,
      }
    case "commit-new-session":
      return {
        activeDocument: action.document,
        sessionDocuments: [...state.sessionDocuments, action.document],
        yamlDraft: action.document.committedYaml,
      }
    case "commit-active-session": {
      if (state.activeDocument?.kind !== "session") return state
      const document = { ...state.activeDocument, committedYaml: action.yaml }
      return {
        activeDocument: document,
        sessionDocuments: state.sessionDocuments.map((item) => (
          item.id === document.id ? document : item
        )),
        yamlDraft: action.yaml,
      }
    }
    case "discard": {
      if (!state.activeDocument) return state
      if (state.activeDocument.kind === "new" || state.activeDocument.kind === "invalid-upload") {
        const document = state.activeDocument.previousDocument
        return { ...state, activeDocument: document, yamlDraft: document?.committedYaml ?? "" }
      }
      return { ...state, yamlDraft: state.activeDocument.committedYaml }
    }
  }
}

export function catalogEntryToDocument(entry: ProductGraphCatalogEntry): CatalogDocument {
  return {
    kind: "catalog",
    id: entry.id,
    title: entry.name,
    filename: entry.filename,
    committedYaml: entry.product_graph,
  }
}

export function yamlFilenameStem(filename: string) {
  return filename.replace(/\.ya?ml$/i, "") || "Untitled model"
}

export function safeYamlFilename(title: string) {
  const stem = title
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return `${stem || "untitled-model"}.yaml`
}

export function uniqueSessionTitle(title: string, documents: SessionDocument[]) {
  const normalized = new Set(documents.map((document) => document.title.toLocaleLowerCase()))
  if (!normalized.has(title.toLocaleLowerCase())) return title
  let suffix = 2
  while (normalized.has(`${title} (${suffix})`.toLocaleLowerCase())) suffix += 1
  return `${title} (${suffix})`
}
