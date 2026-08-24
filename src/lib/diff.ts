/**
 * Line-level diff, computed from two whole documents at display time.
 *
 * This is the only diff in the undo design: it is never stored, never
 * transported, and never a source of truth. Versions hold whole documents,
 * and the assistant returns whole documents; comparing them exactly is what
 * code is good at, so nothing here needs to survive a round trip.
 *
 * Classic LCS, which is more than fast enough for documents of a few hundred
 * lines. Revisit only if documents reach thousands of lines.
 */

export type DiffLine =
  | { kind: "context" | "added" | "removed"; text: string }
  /** A collapsed run of unchanged lines. */
  | { kind: "gap"; count: number }

export type DiffStat = { added: number; removed: number }

function splitLines(source: string): string[] {
  // An empty document has no lines at all, not one empty line -- otherwise
  // diffing against it reports a phantom removal.
  if (source === "") return []
  // A trailing newline would likewise produce a phantom empty final line that
  // shows up as a change whenever one document ends with one and the other
  // does not.
  const lines = source.split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before)
  const b = splitLines(after)

  // lengths[i][j] = LCS length of a[i:] and b[j:]
  const lengths: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = a[i] === b[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i] })
      i += 1
      j += 1
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      out.push({ kind: "removed", text: a[i] })
      i += 1
    } else {
      out.push({ kind: "added", text: b[j] })
      j += 1
    }
  }
  while (i < a.length) { out.push({ kind: "removed", text: a[i] }); i += 1 }
  while (j < b.length) { out.push({ kind: "added", text: b[j] }); j += 1 }
  return out
}

export function diffStat(lines: DiffLine[]): DiffStat {
  return lines.reduce<DiffStat>((stat, line) => {
    if (line.kind === "added") stat.added += 1
    if (line.kind === "removed") stat.removed += 1
    return stat
  }, { added: 0, removed: 0 })
}

/**
 * Replace long runs of unchanged lines with a gap marker, keeping `context`
 * lines either side of each change. An assistant edit to one stage of a
 * hundred-line graph should not require scrolling past the ninety lines it did
 * not touch.
 */
export function collapseContext(lines: DiffLine[], context = 3): DiffLine[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  lines.forEach((line, index) => {
    if (line.kind === "context" || line.kind === "gap") return
    for (let offset = -context; offset <= context; offset += 1) {
      const near = index + offset
      if (near >= 0 && near < lines.length) keep[near] = true
    }
  })

  const out: DiffLine[] = []
  let skipped = 0
  lines.forEach((line, index) => {
    if (keep[index]) {
      if (skipped) { out.push({ kind: "gap", count: skipped }); skipped = 0 }
      out.push(line)
    } else {
      skipped += 1
    }
  })
  if (skipped) out.push({ kind: "gap", count: skipped })
  return out
}
