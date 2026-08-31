import { useState } from "react"
import { Check, ChevronDown, CopyPlus, Download, FilePlus2, FileUp, History, Save as SaveIcon, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProductGraphTemplate } from "@/lib/lcaApi"
import type { ActiveDocument, SessionDocument } from "@/lib/modelWorkspace"
import { productGraphLabel } from "@/lib/resultFormatting"
import { HistoryPanel } from "@/components/workspace/HistoryPanel"
import type { DocumentSnapshot, Version } from "@/lib/versionHistory"

export function FileMenu({
  activeDocument,
  templates,
  sessionDocuments,
  canSave,
  canSaveAs,
  canDownload,
  onNew,
  onSelectTemplate,
  onSelectSession,
  onSave,
  onSaveAs,
  onUpload,
  onDownload,
  onClearSession,
  onDeleteSession,
  versions,
  documentSnapshot,
  onRestoreVersion,
}: {
  activeDocument: ActiveDocument | null
  templates: ProductGraphTemplate[]
  sessionDocuments: SessionDocument[]
  canSave: boolean
  canSaveAs: boolean
  canDownload: boolean
  onNew: () => void
  onSelectTemplate: (id: string) => void
  onSelectSession: (id: string) => void
  onSave: () => void
  onSaveAs: () => void
  onUpload: () => void
  onDownload: () => void
  onClearSession: () => void
  onDeleteSession: (id: string) => void
  /** Omitted on the mobile navigation, which carries no history submenu. */
  versions?: Version[]
  documentSnapshot?: DocumentSnapshot
  onRestoreVersion?: (versionId: string) => void
}) {
  const [open, setOpen] = useState(false)
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <Button data-file-menu-trigger className="navbar-menu-trigger model-menu-trigger" variant="ghost" size="sm">File<ChevronDown data-icon="inline-end" /></Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="navbar-dropdown model-menu-content">
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onNew}><FilePlus2 />New...</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Templates...</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="navbar-dropdown template-submenu">
          {templates.map((item) => {
            const selected = activeDocument?.kind === "template" && activeDocument.id === item.id
            return <DropdownMenuItem key={item.id} aria-current={selected ? "true" : undefined} onSelect={() => onSelectTemplate(item.id)}>
              <span className="model-menu-item-title" title={item.filename}>{productGraphLabel(item.name)}</span>{selected ? <Check className="model-menu-check" /> : null}
            </DropdownMenuItem>
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {sessionDocuments.length ? <>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel>This session</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onClearSession}><Trash2 />Clear Session</DropdownMenuItem>
          {sessionDocuments.map((document) => {
            const selected = activeDocument?.kind === "session" && activeDocument.id === document.id
            return <div key={document.id} className="session-model-row">
              <DropdownMenuItem className="session-model-select" aria-current={selected ? "true" : undefined} onSelect={() => onSelectSession(document.id)}>
                <span className="model-menu-item-title">{document.title}</span>{selected ? <Check className="model-menu-check" /> : null}
              </DropdownMenuItem>
              <DropdownMenuItem asChild onSelect={(event) => {
                // Keep File open so several session files can be managed in
                // one pass. Radix otherwise closes the menu after selection.
                event.preventDefault()
                onDeleteSession(document.id)
              }}>
                <button type="button" className="session-model-delete" aria-label={`Delete ${document.title}`} title={`Delete ${document.title}`}>
                  <X size={14} />
                </button>
              </DropdownMenuItem>
            </div>
          })}
        </DropdownMenuGroup>
      </> : null}
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!canSave} onSelect={onSave}><SaveIcon />Save</DropdownMenuItem>
        <DropdownMenuItem disabled={!canSaveAs} onSelect={onSaveAs}><CopyPlus />Save As...</DropdownMenuItem>
        {versions && documentSnapshot && onRestoreVersion ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><History />History</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="navbar-dropdown history-panel">
              <HistoryPanel
                versions={versions}
                current={documentSnapshot}
                onRestore={onRestoreVersion}
                onClose={() => setOpen(false)}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onUpload}><FileUp />Upload YAML...</DropdownMenuItem>
        <DropdownMenuItem disabled={!canDownload} onSelect={onDownload}><Download />Download YAML</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
