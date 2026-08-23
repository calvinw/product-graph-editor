import {
  Button, Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, Field, FieldLabel, Input,
} from "product-graph-editor"

// DialogContent always renders through a portal on document.body, so it escapes
// any wrapper element. Theme it at the document level instead -- which is also
// how a real application themes this design system.
if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-theme", "light")
}

export function RenameStudy() {
  return (
    <Dialog open modal={false}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename study</DialogTitle>
          <DialogDescription>
            The name appears in the workspace header and in exported YAML.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="d-name">Study name</FieldLabel>
          <Input id="d-name" defaultValue="Copy of Cotton Tote Bag" />
        </Field>
        <DialogFooter>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
