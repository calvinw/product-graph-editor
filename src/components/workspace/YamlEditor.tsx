import { CopyPlus, Save as SaveIcon, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { YamlDiff, YamlDiffStat } from "@/components/workspace/YamlDiff"
import type { ActiveDocument } from "@/lib/modelWorkspace"

/**
 * The YAML authoring surface.
 *
 * Extracted from App.tsx so that swapping the textarea for a real code editor
 * later (Ace or CodeMirror, whose value would be syntax highlighting and error
 * markers on the failing line) is a change to one file rather than surgery on
 * the app shell.
 *
 * Two undo scopes meet here and must not fight. The browser gives the textarea
 * per-keystroke undo for free; model-level undo steps between recorded
 * versions. See `remountKey` and `onDraftSettled` below.
 */
export function YamlEditor({
  yamlDraft,
  yamlError,
  isDirty,
  isTransient,
  isCalculating,
  activeDocument,
  canSaveAs,
  draftAuthor,
  remountKey,
  onChange,
  onSave,
  onSaveAs,
}: {
  yamlDraft: string
  yamlError: string
  isDirty: boolean
  isTransient: boolean
  isCalculating: boolean
  activeDocument: ActiveDocument | null
  canSaveAs: boolean
  /** Who wrote the pending change; an assistant rewrite shows its diff up front. */
  draftAuthor: "you" | "assistant"
  /**
   * Changing this remounts the textarea, which is the only way to clear a
   * plain textarea's native undo stack. After model undo replaces the contents
   * programmatically the browser's stack is stale but still live, so Cmd+Z
   * inside the field could otherwise undo back to pre-restore text and desync
   * the draft from the history.
   */
  remountKey: number
  onChange: (yaml: string) => void
  onSave: () => void
  onSaveAs: () => void
}) {
  return (
    <div className="yaml-editor">
      <div className="yaml-editor-head">
        <div>
          <strong>Product graph YAML</strong>
          <span>{isTransient ? "Start writing YAML, or upload an existing file from the File menu." : "Edit the current session model."}</span>
        </div>
      </div>
      {/*
        An assistant rewrite arrives as a wall of new YAML. Without this you
        would have to save it first and then open the history panel to find
        out what it changed, which is exactly backwards -- the review has to
        come before the commit. Open by default for an assistant edit, closed
        for your own typing, which needs no explaining back to you.
      */}
      {isDirty && !isTransient ? (
        <details className="yaml-pending-diff" open={draftAuthor === "assistant"}>
          <summary>
            {draftAuthor === "assistant" ? <Sparkles size={12} aria-hidden="true" /> : null}
            <span>{draftAuthor === "assistant" ? "Assistant proposed these changes" : "Unsaved changes"}</span>
            <YamlDiffStat before={activeDocument?.committedYaml ?? ""} after={yamlDraft} />
          </summary>
          <YamlDiff before={activeDocument?.committedYaml ?? ""} after={yamlDraft} />
        </details>
      ) : null}
      <textarea
        key={remountKey}
        value={yamlDraft}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        aria-label="Product graph YAML"
      />
      <div className="yaml-editor-foot">
        <span className={yamlError ? "yaml-error" : isDirty ? "yaml-dirty" : ""}>
          {yamlError || (!yamlDraft.trim()
            ? "Start writing YAML, or upload a file from the File menu."
            : isDirty
              ? activeDocument?.kind === "session"
                ? "Unsaved changes. Save to update this session model."
                : "Unsaved draft. Save As to create a session model."
              : isCalculating
                ? "Calculating the saved YAML…"
                : "Saved in this browser session.")}
        </span>
        {activeDocument?.kind === "session" && isDirty
          ? <Button size="sm" onClick={onSave}><SaveIcon data-icon="inline-start" />Save</Button>
          : isTransient
            ? <Button size="sm" disabled={!canSaveAs} onClick={onSaveAs}><CopyPlus data-icon="inline-start" />Save As...</Button>
            : null}
      </div>
    </div>
  )
}
