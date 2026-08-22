import type { ModelWorkspaceState } from "./modelWorkspace"

/**
 * Keeps session models across a reload.
 *
 * `sessionDocuments` otherwise lives only in memory, so a refresh or a stray
 * Cmd+W loses every model made this session -- and the unload warning only
 * fires while there are *unsaved* changes, so saving everything properly is
 * precisely what removes the warning and lets the work go silently.
 *
 * This is a convenience, not a backup: clearing site data wipes it, and
 * Download YAML remains the real archive. Undo protects you from your last
 * action; this protects you from closing the tab.
 */

const STORAGE_KEY = "product-graph-editor:workspace"
/** Bumped when the persisted shape changes, so old payloads are ignored rather than misread. */
const STORAGE_VERSION = 1

export type PersistedWorkspace = ModelWorkspaceState & { appliedYaml: string }

type Envelope = { version: number; workspace: PersistedWorkspace }

export function loadPersistedWorkspace(): PersistedWorkspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Envelope>
    if (parsed.version !== STORAGE_VERSION || !parsed.workspace) return null

    const { activeDocument, sessionDocuments, yamlDraft, appliedYaml } = parsed.workspace
    // Only trust a payload that still matches the shape the app expects. A
    // half-restored workspace is worse than none.
    if (!Array.isArray(sessionDocuments)) return null
    if (typeof yamlDraft !== "string" || typeof appliedYaml !== "string") return null
    if (!activeDocument || typeof activeDocument !== "object") return null
    return { activeDocument, sessionDocuments, yamlDraft, appliedYaml }
  } catch {
    return null
  }
}

export function savePersistedWorkspace(workspace: PersistedWorkspace) {
  try {
    // Transient documents are working state, not something to restore into on
    // the next load: a half-typed New model or a failed upload should not be
    // what greets you after a refresh.
    if (workspace.activeDocument?.kind !== "session") return
    const envelope: Envelope = { version: STORAGE_VERSION, workspace }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope))
  } catch {
    // Storage can be unavailable or full in restricted browser contexts.
    // Persistence is a convenience, so failing to write is not an error.
  }
}

export function clearPersistedWorkspace() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* Optional preference. */ }
}
