import { useEffect, useMemo, useState } from "react"
import { Check, Copy, FolderUp, Network, Plus, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { createTeamRoom, joinTeamRoom, listTeamRoomFiles, listTeamRooms, saveTeamRoomFile, type TeamRoom, type TeamRoomFile } from "@/lib/teamRooms"

function readableError(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message
  return fallback
}

export function TeamRoomDialog({ open, onOpenChange, currentFile, onOpenFile }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentFile: { name: string; yaml: string }
  onOpenFile: (file: TeamRoomFile) => void
}) {
  const [rooms, setRooms] = useState<TeamRoom[]>([])
  const [activeRoom, setActiveRoom] = useState<TeamRoom | null>(null)
  const [files, setFiles] = useState<TeamRoomFile[]>([])
  const [mode, setMode] = useState<"home" | "create" | "join">("home")
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")

  const refreshRooms = async () => {
    try { setRooms(await listTeamRooms()) } catch (error) { setMessage(readableError(error, "Could not load team rooms.")) }
  }
  useEffect(() => { if (open) { void refreshRooms(); setMessage("") } }, [open])
  useEffect(() => { if (!activeRoom) { setFiles([]); return }; void listTeamRoomFiles(activeRoom.id).then(setFiles).catch((error) => setMessage(error.message)) }, [activeRoom])
  const activeCode = activeRoom?.invite_code
  const initials = useMemo(() => activeRoom?.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase() ?? "◌", [activeRoom])

  const create = async () => {
    if (!name.trim()) return setMessage("Give your room a name.")
    setBusy(true); setMessage("")
    try { const room = await createTeamRoom(name); setRooms((current) => [room, ...current]); setActiveRoom(room); setMode("home") } catch (error) { setMessage(readableError(error, "Could not create room.")) } finally { setBusy(false) }
  }
  const join = async () => {
    if (code.replace(/\D/g, "").length !== 4) return setMessage("Enter the four-digit room code.")
    setBusy(true); setMessage("")
    try { const room = await joinTeamRoom(code); await refreshRooms(); setActiveRoom(room); setMode("home") } catch (error) { setMessage(readableError(error, "That room code is not available.")) } finally { setBusy(false) }
  }
  const shareCurrent = async () => {
    if (!activeRoom) return
    setBusy(true); setMessage("")
    try { const saved = await saveTeamRoomFile(activeRoom.id, currentFile.name, currentFile.yaml); setFiles((current) => [saved, ...current.filter((file) => file.id !== saved.id)]) } catch (error) { setMessage(readableError(error, "Could not save the shared file.")) } finally { setBusy(false) }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="team-room-dialog" aria-describedby="team-room-description">
      <DialogHeader className="team-room-hero">
        <div className="team-room-mark"><Network size={22} /></div>
        <div><DialogTitle>{activeRoom ? activeRoom.name : mode === "create" ? "Start a shared analysis" : mode === "join" ? "Join a shared analysis" : "Team rooms"}</DialogTitle><DialogDescription id="team-room-description">{activeRoom ? "A private studio for your team’s models and saved analyses." : "Create a private room or join one with an invite code."}</DialogDescription></div>
      </DialogHeader>
      {mode === "create" ? <div className="team-room-form"><label>Room name<Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Aether Materials" /></label><div className="team-room-actions"><Button variant="ghost" onClick={() => setMode("home")}>Back</Button><Button disabled={busy} onClick={() => void create()}><Plus size={15} />Create room</Button></div></div>
      : mode === "join" ? <div className="team-room-form"><label>Four-digit invite code<Input autoFocus inputMode="numeric" maxLength={4} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="4827" className="team-room-code-input" /></label><div className="team-room-actions"><Button variant="ghost" onClick={() => setMode("home")}>Back</Button><Button disabled={busy} onClick={() => void join()}>Join room</Button></div></div>
      : activeRoom ? <div className="team-room-studio"><div className="team-room-studio-head"><span className="team-room-avatar">{initials}</span><div><strong>Room studio</strong><small><UsersRound size={13} />{activeRoom.member_count} collaborators</small></div>{activeCode ? <Button variant="ghost" size="sm" className="team-room-copy" onClick={() => void navigator.clipboard.writeText(activeCode)}><Copy size={14} />{activeCode}</Button> : null}</div><div className="team-room-files"><div><span>Files in this room</span><Button size="sm" disabled={busy || !currentFile.yaml.trim()} onClick={() => void shareCurrent()}><FolderUp size={14} />Share current file</Button></div>{files.length ? files.map((file) => <button className="team-room-file" type="button" key={file.id} onClick={() => { onOpenFile(file); onOpenChange(false) }}><span><strong>{file.name}</strong><small>Shared {new Date(file.updated_at).toLocaleString()}</small></span><Check size={15} /></button>) : <p>No shared files yet. Share the model you are working on to start the room library.</p>}</div><Button variant="ghost" size="sm" onClick={() => setActiveRoom(null)}>Switch room</Button></div>
      : <div className="team-room-home"><div className="team-room-launch"><Button onClick={() => setMode("create")}><Plus size={15} />Create room</Button><Button variant="outline" onClick={() => setMode("join")}>Join with code</Button></div>{rooms.length ? <div className="team-room-list">{rooms.map((room) => <button type="button" key={room.id} onClick={() => setActiveRoom(room)}><span className="team-room-avatar">{room.name.slice(0, 2).toUpperCase()}</span><span><strong>{room.name}</strong><small>{room.member_count} collaborators</small></span></button>)}</div> : <p className="team-room-empty">Start a room to turn your current model into a shared analysis.</p>}</div>}
      {message ? <p className="team-room-message" role="alert">{message}</p> : null}
    </DialogContent>
  </Dialog>
}
