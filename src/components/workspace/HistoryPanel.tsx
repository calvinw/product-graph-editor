import { useState } from "react"
import { History, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { collapseContext, diffLines, diffStat } from "@/lib/diff"
import { relativeTime, snapshotsEqual, type DocumentSnapshot, type Version } from "@/lib/versionHistory"

/**
 * What changed in this version, against the one before it.
 *
 * For assistant edits this matters more than the undo itself: the edit arrives
 * as a wall of new YAML, and being able to step back without knowing what you
 * are stepping back from is only half a feature.
 *
 * Computed at display time from two whole documents -- never stored, never
 * transported.
 */
function VersionDiff({ previous, version }: { previous: Version | undefined; version: Version }) {
  if (!previous) return <p className="history-diff-empty">First recorded version.</p>

  const lines = diffLines(previous.snapshot.yamlDraft, version.snapshot.yamlDraft)
  const stat = diffStat(lines)
  if (!stat.added && !stat.removed) {
    return <p className="history-diff-empty">No YAML changes; the document metadata changed.</p>
  }

  return (
    <pre className="history-diff" aria-label="Changes in this version">
      {collapseContext(lines).map((line, index) => (
        line.kind === "gap"
          ? <span key={index} className="history-diff-gap">{`⋯ ${line.count} unchanged line${line.count === 1 ? "" : "s"}`}</span>
          : <span key={index} className={`history-diff-line is-${line.kind}`}>
              {line.kind === "added" ? "+" : line.kind === "removed" ? "-" : " "}{line.text}
            </span>
      ))}
    </pre>
  )
}

/**
 * The version list made visible, and the main way to use undo.
 *
 * Newest first, because that is the end people reach for. Restoring any row is
 * "restore to here" -- a snapshot is a whole document, so stepping back
 * several entries is the same single operation as stepping back one.
 */
export function HistoryPanel({
  versions,
  current,
  onRestore,
}: {
  versions: Version[]
  current: DocumentSnapshot
  onRestore: (versionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const newestFirst = [...versions].reverse()
  // Which recorded version, if any, the document currently matches. When
  // nothing matches there are uncommitted edits ahead of the whole list.
  const currentId = newestFirst.find((version) => snapshotsEqual(version.snapshot, current))?.id

  // Close on restore: the point of restoring is to see the graph and editor
  // change, which cannot happen with the panel covering them.
  const restore = (versionId: string) => {
    setOpen(false)
    onRestore(versionId)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button className="navbar-menu-trigger" variant="ghost" size="sm" aria-label="Version history">
          <History data-icon="inline-start" size={14} />History
        </Button>
      </PopoverTrigger>
      <PopoverContent className="history-panel" side="bottom" align="start" sideOffset={6}>
        <div className="history-panel-title">
          <span>Version history</span>
          {versions.length ? <small>{versions.length} version{versions.length === 1 ? "" : "s"}</small> : null}
        </div>

        {newestFirst.length === 0 ? (
          <p className="history-empty">No versions recorded yet. Saving or opening a model records one.</p>
        ) : (
          <ul className="history-list">
            {!currentId ? (
              <li className="history-uncommitted">Unsaved edits, not yet recorded as a version.</li>
            ) : null}
            {newestFirst.map((version, index) => {
              // newestFirst is reversed, so the chronologically previous
              // version is the next one along.
              const previous = newestFirst[index + 1]
              const stat = previous
                ? diffStat(diffLines(previous.snapshot.yamlDraft, version.snapshot.yamlDraft))
                : null
              return (
                <li key={version.id} className={`history-row${version.id === currentId ? " is-current" : ""}`}>
                  <div className="history-row-head">
                    <span className="history-row-label" title={version.label}>{version.label}</span>
                    <span className={`history-badge is-${version.source}`}>{version.source}</span>
                  </div>
                  <div className="history-row-meta">
                    <time dateTime={version.timestamp}>{relativeTime(version.timestamp)}</time>
                    {stat && (stat.added || stat.removed) ? (
                      <span className="history-diff-stat">
                        <span className="is-added">+{stat.added}</span>
                        <span className="is-removed">-{stat.removed}</span>
                      </span>
                    ) : null}
                    {version.id === currentId ? (
                      <span className="history-current-tag">current</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="history-restore"
                        onClick={() => restore(version.id)}
                      >
                        <RotateCcw data-icon="inline-start" size={12} />Restore
                      </Button>
                    )}
                  </div>
                  <details className="history-diff-toggle">
                    <summary>What changed</summary>
                    <VersionDiff previous={previous} version={version} />
                  </details>
                </li>
              )
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  )
}
