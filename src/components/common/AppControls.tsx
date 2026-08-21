import type React from "react"
import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function ToolButton({ label, children, onClick, pressed }: { label: string; children: React.ReactNode; onClick?: () => void; pressed?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={label} aria-pressed={pressed} onClick={onClick} variant="ghost" size="icon" className={cn("text-muted-foreground hover:text-foreground", pressed && "is-active")}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8} className="tooltip">{label}</TooltipContent>
    </Tooltip>
  )
}

export function AppSelect({
  value,
  onValueChange,
  options,
  label,
}: {
  value: string
  onValueChange: (value: string) => void
  options: Array<{ value: string; label: string; disabled?: boolean }>
  label: string
}) {
  return <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
    <SelectContent position="popper">
      {options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}
    </SelectContent>
  </Select>
}

export function CurrentModelTitle({
  title,
  className = "",
  onRename,
}: {
  title: string
  className?: string
  onRename?: (title: string) => boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!editing) setDraft(title) }, [title, editing])
  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  if (!onRename) {
    return <span className={cn("current-model-title", className)} aria-label={`Current model: ${title}`} title={title}>{title}</span>
  }

  const commit = () => {
    const applied = onRename(draft)
    setEditing(false)
    if (!applied) setDraft(title)
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        className={cn("current-model-title current-model-title-input", className)}
        value={draft}
        maxLength={120}
        aria-label="Model title"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); commit() }
          else if (event.key === "Escape") { event.preventDefault(); setEditing(false); setDraft(title) }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={cn("current-model-title current-model-title-button", className)}
      onClick={() => setEditing(true)}
      aria-label={`Current model: ${title}`}
      title={`${title} (click to rename)`}
    >
      {title}
    </button>
  )
}
