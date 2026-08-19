import type { RefObject } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

/** Names and creates a session-local copy of the current model. */
export function SaveAsDialog({
  saveAsOpen, setSaveAsOpen, saveAsName, setSaveAsName, saveAsError, setSaveAsError,
  saveAsReturnFocusRef, saveAsSessionModel, setPendingAction,
}: {
  saveAsOpen: boolean
  setSaveAsOpen: (open: boolean) => void
  saveAsName: string
  setSaveAsName: (name: string) => void
  saveAsError: string
  setSaveAsError: (message: string) => void
  saveAsReturnFocusRef: RefObject<HTMLElement | null>
  saveAsSessionModel: (event: React.FormEvent<HTMLFormElement>) => void
  setPendingAction: (action: null) => void
}) {
  return (
    <Dialog open={saveAsOpen} onOpenChange={(open) => { setSaveAsOpen(open); if (!open) { setSaveAsError(""); setPendingAction(null) } }}>
      <DialogContent onCloseAutoFocus={(event) => {
        event.preventDefault()
        const fallback = [...document.querySelectorAll<HTMLElement>("[data-file-menu-trigger]")].find((element) => element.offsetParent !== null)
        const target = saveAsReturnFocusRef.current?.isConnected ? saveAsReturnFocusRef.current : fallback
        target?.focus()
      }}>
        <form className="save-as-form" onSubmit={saveAsSessionModel}>
          <DialogHeader>
            <DialogTitle>Save model as</DialogTitle>
            <DialogDescription>Create a writable model for this browser session. It will not survive a page refresh.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(saveAsError)}>
              <FieldLabel htmlFor="save-as-model-name">Model name</FieldLabel>
              <Input id="save-as-model-name" value={saveAsName} maxLength={120} aria-invalid={Boolean(saveAsError)} autoFocus onChange={(event) => { setSaveAsName(event.target.value); setSaveAsError("") }} />
              <FieldError>{saveAsError}</FieldError>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { setSaveAsOpen(false); setPendingAction(null) }}>Cancel</Button>
            <Button type="submit">Save As</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
