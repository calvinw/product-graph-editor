import { useEffect, useRef } from "react"
import { CopyPlus, Save as SaveIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
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
  remountKey,
  onChange,
  onDraftSettled,
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
  /**
   * Changing this remounts the textarea, which is the only way to clear a
   * plain textarea's native undo stack. After model undo replaces the contents
   * programmatically the browser's stack is stale but still live, so Cmd+Z
   * inside the field could otherwise undo back to pre-restore text and desync
   * the draft from the history.
   */
  remountKey: number
  onChange: (yaml: string) => void
  /**
   * Called when native text undo can no longer help, i.e. when this editor
   * unmounts. The handler records a draft version so the work done in this
   * editing session stays reachable afterwards.
   */
  onDraftSettled: () => void
  onSave: () => void
  onSaveAs: () => void
}) {
  const settledRef = useRef(onDraftSettled)
  settledRef.current = onDraftSettled

  // Unmount, not blur, is the moment that matters: a textarea's native undo
  // stack survives losing focus, but is destroyed when the element goes away.
  // This view is conditionally rendered, so switching to the graph unmounts it
  // -- without this, typing and then switching views would lose the stack with
  // nothing recorded in its place. Capturing on blur instead would also add a
  // spurious "unsaved" entry before every Save, since clicking Save blurs.
  useEffect(() => () => settledRef.current(), [])

  return (
    <div className="yaml-editor">
      <div className="yaml-editor-head">
        <div>
          <strong>Product graph YAML</strong>
          <span>{isTransient ? "Start writing YAML, or upload an existing file from the File menu." : "Edit the current session model."}</span>
        </div>
      </div>
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
