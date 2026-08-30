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

const VERSION_STORAGE_KEY = "product-graph-editor:versions"
const VERSION_STORAGE_VERSION = 1
/**
 * Versions kept per model. At roughly 2 KB a document this is ~200 KB against
 * a 5 MB localStorage budget, so the cap is a trimming policy rather than a
 * limit imposed by space.
 */
export const VERSION_LIMIT_PER_MODEL = 100

type VersionEnvelope = { version: number; models: Record<string, Version[]> }

/**
 * The same append-only store, mirrored to localStorage so history survives a
 * reload.
 *
 * Writes are best-effort: a full or unavailable storage degrades to
 * memory-only rather than breaking the app, because losing history is a far
 * smaller harm than losing the ability to edit.
 */
export function createPersistentVersionStore(
  limit = VERSION_LIMIT_PER_MODEL,
  storageKey = VERSION_STORAGE_KEY,
): VersionStore {
  const byModel = new Map<string, Version[]>()
  const byId = new Map<string, Version>()

  const index = (versions: Version[]) => versions.forEach((version) => byId.set(version.id, version))

  try {
    const raw = localStorage.getItem(storageKey)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VersionEnvelope>
      if (parsed.version === VERSION_STORAGE_VERSION && parsed.models) {
        for (const [modelId, versions] of Object.entries(parsed.models)) {
          if (!Array.isArray(versions)) continue
          byModel.set(modelId, versions)
          index(versions)
        }
      }
    }
  } catch {
    // A corrupt or unreadable payload starts an empty history rather than
    // failing: partial history is worse than none.
  }

  const persist = () => {
    try {
      const envelope: VersionEnvelope = {
        version: VERSION_STORAGE_VERSION,
        models: Object.fromEntries(byModel),
      }
      localStorage.setItem(storageKey, JSON.stringify(envelope))
    } catch {
      // Quota exceeded or storage unavailable; keep working in memory.
    }
  }

  return {
    list: (modelId) => byModel.get(modelId) ?? [],
    get: (versionId) => byId.get(versionId),
    append: (modelId, version) => {
      const next = [...(byModel.get(modelId) ?? []), version]
      // Trim the oldest, which is what a person is least likely to want back.
      const trimmed = next.length > limit ? next.slice(next.length - limit) : next
      byModel.set(modelId, trimmed)
      byId.set(version.id, version)
      persist()
    },
    clear: () => {
      byModel.clear()
      byId.clear()
      try { localStorage.removeItem(storageKey) } catch { /* Optional. */ }
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

/** Drop every persisted version. Used by "Clear Session". */
export function clearPersistedVersions(storageKey = VERSION_STORAGE_KEY) {
  try {
    localStorage.removeItem(storageKey)
  } catch { /* Storage can be unavailable in restricted browser contexts. */ }
}

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
 * The token both sides of an assistant edit stamp, so a proposal written
 * against a document that no longer exists can be rejected outright rather
 * than silently overwriting newer work.
 *
 * Derived from the content the assistant actually reads and rewrites — the
 * draft — plus the document's identity, so it changes on a hand edit, an undo,
 * a history restore, or a switch to another model. Nothing extra to keep in
 * sync, because there is no separate counter to forget to bump.
 *
 * FNV-1a: short, stable across reloads, and collision-resistant enough for a
 * staleness check whose failure mode is asking the model to re-read.
 */
export function documentToken(snapshot: DocumentSnapshot): string {
  const source = `${snapshot.activeDocument?.title ?? ""}${snapshot.yamlDraft}`
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash = Math.imul(hash ^ source.charCodeAt(index), 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

/**
 * Where the live document sits in the version list, or -1 when it matches no
 * recorded version — meaning there are edits ahead of the whole list.
 */
export function currentVersionIndex(versions: Version[], current: DocumentSnapshot): number {
  return versions.findIndex((version) => snapshotsEqual(version.snapshot, current))
}

/**
 * What Cmd+Z should restore.
 *
 * With an append-only list there is no undo stack to pop: "undo" is simply
 * restoring the version before wherever you currently are. Sitting ahead of
 * the list (uncommitted edits) steps back to the most recent recorded state;
 * callers should record the uncommitted work first so it stays reachable.
 */
export function undoTarget(versions: Version[], current: DocumentSnapshot): Version | null {
  const index = currentVersionIndex(versions, current)
  if (index === -1) return versions[versions.length - 1] ?? null
  return index > 0 ? versions[index - 1] : null
}

/**
 * What Shift+Cmd+Z should restore. Redo needs no separate stack and no rules
 * about what clears it: going forward is just restoring a later version.
 */
export function redoTarget(versions: Version[], current: DocumentSnapshot): Version | null {
  const index = currentVersionIndex(versions, current)
  if (index === -1) return null
  return index < versions.length - 1 ? versions[index + 1] : null
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
