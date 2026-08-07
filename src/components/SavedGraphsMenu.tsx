import { useEffect, useRef, useState } from "react"
import { FolderOpen, Pencil, Save, Trash2 } from "lucide-react"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button, buttonVariants } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { supabase } from "@/lib/supabase"

export type SavedGraph = {
  id: string
  name: string
  yaml_content: string
  created_at: string
  updated_at: string
}

export function SavedGraphsMenu({ userId, yaml, suggestedName, activeId, onActiveIdChange, onOpen }: {
  userId: string
  yaml: string
  suggestedName: string
  activeId: string | null
  onActiveIdChange: (id: string | null) => void
  onOpen: (graph: SavedGraph) => void
}) {
  const [open, setOpen] = useState(false)
  const [graphs, setGraphs] = useState<SavedGraph[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [name, setName] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<SavedGraph | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const loadGraphs = async () => {
    if (!supabase) return
    setLoading(true)
    setError("")
    const { data, error: loadError } = await supabase
      .from("product_graphs")
      .select("id,name,yaml_content,created_at,updated_at")
      .order("updated_at", { ascending: false })
    if (loadError) setError(loadError.message)
    else setGraphs((data ?? []) as SavedGraph[])
    setLoading(false)
  }

  useEffect(() => {
    if (open) void loadGraphs()
    // Reload each time the menu opens so changes from another tab are visible.
  }, [open])

  useEffect(() => {
    if (!open) return
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || panelRef.current?.contains(target)) return
      if (target instanceof Element && target.closest("[data-saved-graphs-trigger]")) return
      setOpen(false)
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true)
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true)
  }, [open])

  useEffect(() => {
    const closeFromGraph = () => setOpen(false)
    window.addEventListener("prism:close-saved-graphs", closeFromGraph)
    return () => window.removeEventListener("prism:close-saved-graphs", closeFromGraph)
  }, [])

  const saveExisting = async () => {
    if (!supabase || !activeId || !yaml.trim()) return
    setSaving(true)
    setError("")
    const { data, error: saveError } = await supabase
      .from("product_graphs")
      .update({ yaml_content: yaml })
      .eq("id", activeId)
      .eq("user_id", userId)
      .select("id,name,yaml_content,created_at,updated_at")
      .single()
    if (saveError) setError(saveError.message)
    else setGraphs((current) => [data as SavedGraph, ...current.filter((graph) => graph.id !== activeId)])
    setSaving(false)
  }

  const beginSaveAs = () => {
    setName(suggestedName || "Untitled product graph")
    setSaveAsOpen(true)
    setError("")
  }

  const saveAs = async () => {
    if (!supabase || !name.trim() || !yaml.trim()) return
    setSaving(true)
    setError("")
    const { data, error: saveError } = await supabase
      .from("product_graphs")
      .insert({ user_id: userId, name: name.trim(), yaml_content: yaml })
      .select("id,name,yaml_content,created_at,updated_at")
      .single()
    if (saveError) setError(saveError.message)
    else {
      const saved = data as SavedGraph
      setGraphs((current) => [saved, ...current])
      onActiveIdChange(saved.id)
      setSaveAsOpen(false)
    }
    setSaving(false)
  }

  const rename = async (id: string) => {
    if (!supabase || !renameValue.trim()) return
    setError("")
    const { data, error: renameError } = await supabase
      .from("product_graphs")
      .update({ name: renameValue.trim() })
      .eq("id", id)
      .eq("user_id", userId)
      .select("id,name,yaml_content,created_at,updated_at")
      .single()
    if (renameError) setError(renameError.message)
    else {
      setGraphs((current) => [data as SavedGraph, ...current.filter((graph) => graph.id !== id)])
      setRenamingId(null)
    }
  }

  const deleteGraph = async () => {
    if (!supabase || !deleteTarget) return
    setError("")
    const { error: deleteError } = await supabase
      .from("product_graphs")
      .delete()
      .eq("id", deleteTarget.id)
      .eq("user_id", userId)
    if (deleteError) setError(deleteError.message)
    else {
      setGraphs((current) => current.filter((graph) => graph.id !== deleteTarget.id))
      if (activeId === deleteTarget.id) onActiveIdChange(null)
      setDeleteTarget(null)
    }
  }

  return <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button data-saved-graphs-trigger variant="outline" className="my-files-trigger"><FolderOpen size={15} />My files</Button></PopoverTrigger>
      <PopoverContent ref={panelRef} className="saved-graphs-panel" align="start" sideOffset={8} onInteractOutside={() => setOpen(false)}>
        <div className="saved-graphs-head"><div><strong>My files</strong><span>Private product graphs saved to your account.</span></div><Button size="sm" onClick={activeId ? () => void saveExisting() : beginSaveAs} disabled={saving || !yaml.trim()}><Save size={14} />{saving ? "Saving…" : activeId ? "Save" : "Save as"}</Button></div>
        <Button variant="outline" size="sm" className="save-as-secondary" onClick={beginSaveAs} disabled={saving || !yaml.trim()}>Save current as a new file</Button>
        {saveAsOpen ? <div className="saved-graph-form"><Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="File name" autoFocus onKeyDown={(event) => { if (event.key === "Enter") void saveAs() }} /><Button size="sm" onClick={() => void saveAs()} disabled={saving || !name.trim()}>Save</Button><Button variant="ghost" size="sm" onClick={() => setSaveAsOpen(false)}>Cancel</Button></div> : null}
        {error ? <p className="saved-graphs-error" role="alert">{error}</p> : null}
        <div className="saved-graphs-list">
          {loading ? <p className="saved-graphs-empty">Loading files…</p> : graphs.length ? graphs.map((graph) => <div className={`saved-graph-row${graph.id === activeId ? " is-active" : ""}`} key={graph.id}>
            {renamingId === graph.id ? <div className="saved-graph-rename"><Input value={renameValue} maxLength={120} autoFocus onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void rename(graph.id); if (event.key === "Escape") setRenamingId(null) }} /><Button size="sm" onClick={() => void rename(graph.id)}>Save</Button></div> : <>
              <button className="saved-graph-open" type="button" onClick={() => { onActiveIdChange(graph.id); onOpen(graph); setOpen(false) }}><strong>{graph.name}</strong><span>Updated {new Date(graph.updated_at).toLocaleString()}</span></button>
              <Button variant="ghost" size="icon" aria-label={`Rename ${graph.name}`} onClick={() => { setRenamingId(graph.id); setRenameValue(graph.name) }}><Pencil size={14} /></Button>
              <Button variant="ghost" size="icon" aria-label={`Delete ${graph.name}`} onClick={() => setDeleteTarget(graph)}><Trash2 size={14} /></Button>
            </>}
          </div>) : <p className="saved-graphs-empty">No saved files yet. Save the current YAML to create your first one.</p>}
        </div>
      </PopoverContent>
    </Popover>
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(next) => !next && setDeleteTarget(null)}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete saved file?</AlertDialogTitle><AlertDialogDescription>{deleteTarget ? `“${deleteTarget.name}” will be permanently deleted from your account.` : "This file will be permanently deleted."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className={buttonVariants({ variant: "destructive" })} onClick={() => void deleteGraph()}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>
}
