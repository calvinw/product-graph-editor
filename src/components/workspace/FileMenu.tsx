import { Check, ChevronDown, CopyPlus, Download, FilePlus2, FileUp, Save as SaveIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { ProductGraphTemplate } from "@/lib/lcaApi"
import type { ActiveDocument, SessionDocument } from "@/lib/modelWorkspace"
import { productGraphLabel } from "@/lib/resultFormatting"

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
}) {
  return <DropdownMenu>
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
          {sessionDocuments.map((document) => {
            const selected = activeDocument?.kind === "session" && activeDocument.id === document.id
            return <DropdownMenuItem key={document.id} aria-current={selected ? "true" : undefined} onSelect={() => onSelectSession(document.id)}>
              <span className="model-menu-item-title">{document.title}</span>{selected ? <Check className="model-menu-check" /> : null}
            </DropdownMenuItem>
          })}
        </DropdownMenuGroup>
      </> : null}
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem disabled={!canSave} onSelect={onSave}><SaveIcon />Save</DropdownMenuItem>
        <DropdownMenuItem disabled={!canSaveAs} onSelect={onSaveAs}><CopyPlus />Save As...</DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuItem onSelect={onUpload}><FileUp />Upload YAML...</DropdownMenuItem>
        <DropdownMenuItem disabled={!canDownload} onSelect={onDownload}><Download />Download YAML</DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
