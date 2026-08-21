import type React from "react"
import { Button } from "@/components/ui/button"
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

export function CurrentModelTitle({ title, className = "" }: { title: string; className?: string }) {
  return <span className={cn("current-model-title", className)} aria-label={`Current model: ${title}`} title={title}>{title}</span>
}
