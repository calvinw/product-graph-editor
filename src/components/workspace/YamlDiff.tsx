import { collapseContext, diffLines, diffStat } from "@/lib/diff"

/**
 * A unified line diff between two YAML documents.
 *
 * Shared by the history panel and the editor's pending-change review, so both
 * read identically. Computed at display time from two whole documents --
 * never stored, never transported.
 */
export function YamlDiff({ before, after }: { before: string; after: string }) {
  const lines = diffLines(before, after)
  const stat = diffStat(lines)
  if (!stat.added && !stat.removed) {
    return <p className="history-diff-empty">No YAML changes.</p>
  }

  return (
    <pre className="history-diff" aria-label="Changed lines">
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

/** The `+N -M` summary, shown without needing to expand anything. */
export function YamlDiffStat({ before, after }: { before: string; after: string }) {
  const stat = diffStat(diffLines(before, after))
  if (!stat.added && !stat.removed) return null
  return (
    <span className="history-diff-stat">
      <span className="is-added">+{stat.added}</span>
      <span className="is-removed">-{stat.removed}</span>
    </span>
  )
}
