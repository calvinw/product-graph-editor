import {
  AlertDialog, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { ActiveDocument } from "@/lib/modelWorkspace"

/** Asks how to handle an unsaved draft before navigating away. */
export function UnsavedChangesDialog({
  pendingConfirmationOpen, activeDocument, canSaveAs,
  cancelPendingAction, discardAndContinue, saveAndContinue, saveAsAndContinue,
}: {
  pendingConfirmationOpen: boolean
  activeDocument: ActiveDocument | null
  canSaveAs: boolean
  cancelPendingAction: () => void
  discardAndContinue: () => void
  saveAndContinue: () => void
  saveAsAndContinue: () => void
}) {
  return (
    <AlertDialog open={pendingConfirmationOpen} onOpenChange={(open) => { if (!open) cancelPendingAction() }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Unsaved YAML changes</AlertDialogTitle>
          <AlertDialogDescription>
            {activeDocument?.kind === "session"
              ? `Save changes to "${activeDocument.title}" before continuing?`
              : "Save a copy before continuing?"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={cancelPendingAction}>Keep editing</AlertDialogCancel>
          <Button variant="destructive" onClick={discardAndContinue}>Discard changes</Button>
          {activeDocument?.kind === "session"
            ? <Button onClick={saveAndContinue}>Save</Button>
            : <Button disabled={!canSaveAs} onClick={saveAsAndContinue}>Save As...</Button>}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
