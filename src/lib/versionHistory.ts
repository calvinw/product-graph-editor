import type { ActiveDocument, ModelWorkspaceState } from "./modelWorkspace"

/**
 * Who authored a version. Becomes a user id once there is a server.
 */
export type VersionSource = "you" | "assistant"

/**
 * Everything a version snapshot captures: the reducer-owned document tier
 * plus `appliedYaml`, which is written by the apply actions rather than the
 * reducer. Mirrors `DocumentSnapshot` in the store; declared here so this
 * module stays free of store imports and therefore trivially testable.
 */
export type DocumentSnapshot = ModelWorkspaceState & { appliedYaml: string }

export type Version = {
  id: string
  label: string
  source: VersionSource
  /** ISO 8601, so it survives serialization to localStorage or a database. */
  timestamp: string
  snapshot: DocumentSnapshot
}

/**
 * The persistence boundary. Deliberately narrow and append-only, which is the
 * shape a server needs too: no updates, no write conflicts, no locking.
 *
 * The first implementation is in-memory because undo history is session
 * scoped. A localStorage or database implementation slots in behind the same
 * three methods without touching callers.
 */
export type VersionStore = {
  list(modelId: string): Version[]
  get(versionId: string): Version | undefined
  append(modelId: string, version: Version): void
  /**
   * Drop every recorded version. Needed because document ids can repeat
   * across a store reset, which would otherwise leave a new document
   * inheriting the previous one's history.
   */
  clear(): void
}

export function createMemoryVersionStore(): VersionStore {
  const byModel = new Map<string, Version[]>()
  const byId = new Map<string, Version>()
  return {
    list: (modelId) => byModel.get(modelId) ?? [],
    get: (versionId) => byId.get(versionId),
    append: (modelId, version) => {
      byModel.set(modelId, [...(byModel.get(modelId) ?? []), version])
      byId.set(version.id, version)
    },
    clear: () => {
      byModel.clear()
      byId.clear()
    },
  }
}

/**
 * History is kept per model, so switching models shows that model's own
 * history rather than one global list.
 *
 * Transient documents (New, or a failed upload) have no id of their own and
 * share a single bucket. They are short-lived by nature: the moment one is
 * saved it becomes a session document with a real id and starts a fresh
 * history, which is the correct boundary — the saved model's history should
 * not begin with the scratch states that preceded it.
 */
export const TRANSIENT_HISTORY_KEY = "__transient__"

export function historyKeyFor(activeDocument: ActiveDocument | null): string {
  if (!activeDocument) return TRANSIENT_HISTORY_KEY
  if (activeDocument.kind === "session" || activeDocument.kind === "template") return activeDocument.id
  return TRANSIENT_HISTORY_KEY
}

/**
 * Whether two snapshots describe the same document state.
 *
 * A false negative only costs one redundant history entry, so this favours
 * being cheap and obvious over being exhaustive. `activeDocument` and
 * `sessionDocuments` are each built in exactly one place, so their key order
 * is stable and JSON comparison is reliable in practice.
 */
export function snapshotsEqual(a: DocumentSnapshot, b: DocumentSnapshot): boolean {
  return a.yamlDraft === b.yamlDraft
    && a.appliedYaml === b.appliedYaml
    && JSON.stringify(a.activeDocument) === JSON.stringify(b.activeDocument)
    && JSON.stringify(a.sessionDocuments) === JSON.stringify(b.sessionDocuments)
}

/**
 * The dedupe rule: never record a version identical to the one already at the
 * head of the list.
 *
 * This is what keeps the automatic pre-proposal snapshot quiet. Save and then
 * immediately ask the assistant for a change, and the pre-proposal snapshot
 * equals the last version, so nothing is added — the automatic entry appears
 * only when there is genuinely uncommitted work to protect.
 */
export function shouldAppend(history: Version[], snapshot: DocumentSnapshot): boolean {
  const latest = history[history.length - 1]
  return !latest || !snapshotsEqual(latest.snapshot, snapshot)
}

/**
 * Compact relative time for history rows. `now` is injectable so this stays a
 * pure function rather than something only testable with fake timers.
 */
export function relativeTime(timestamp: string, now: Date = new Date()): string {
  const elapsed = now.getTime() - new Date(timestamp).getTime()
  if (!Number.isFinite(elapsed)) return ""
  const seconds = Math.max(0, Math.round(elapsed / 1000))
  if (seconds < 45) return "just now"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function createVersion(
  snapshot: DocumentSnapshot,
  { label, source, id, timestamp }: {
    label: string
    source: VersionSource
    id?: string
    timestamp?: string
  },
): Version {
  return {
    id: id ?? globalThis.crypto?.randomUUID?.() ?? `version-${Date.now()}-${Math.random()}`,
    label,
    source,
    timestamp: timestamp ?? new Date().toISOString(),
    snapshot,
  }
}
