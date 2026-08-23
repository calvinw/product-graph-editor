// Gallery entry point: local components in a file with no exports, which is
// what this rule flags. Fast refresh is irrelevant for a one-off preview page.
/* eslint-disable react-refresh/only-export-components */
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"

// Deliberately the built artifacts, not src/. This page is a check on what
// ships: if a component only renders correctly from source, it is broken here.
import "../dist-lib/styles.css"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  Button, Checkbox,
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
  Field, FieldDescription, FieldGroup, FieldLabel, FieldSet, FieldLegend,
  Input, Label,
  Popover, PopoverContent, PopoverTrigger,
  RadioGroup, RadioGroupItem,
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  Separator, Toggle, ToggleGroup, ToggleGroupItem,
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "../dist-lib/index.js"

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-6">
        {children}
      </div>
    </section>
  )
}

function Gallery() {
  const [theme, setTheme] = useState<"dark" | "light">("dark")
  const [alertOpen, setAlertOpen] = useState(false)
  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark"
    document.documentElement.setAttribute("data-theme", next)
    setTheme(next)
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background text-foreground">
        <div className="mx-auto flex max-w-5xl flex-col gap-8 p-12">
          <header className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-semibold">Design System Gallery</h1>
              <p className="text-sm text-muted-foreground">
                Rendered from dist-lib — the built bundle and compiled stylesheet.
              </p>
            </div>
            <Button variant="outline" onClick={toggleTheme}>
              {theme === "dark" ? "Light" : "Dark"} theme
            </Button>
          </header>

          <Row title="Button">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button disabled>Disabled</Button>
          </Row>

          <Row title="Input, Label, Field">
            <FieldSet className="w-full max-w-sm">
              <FieldLegend>Study details</FieldLegend>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="g-name">Study name</FieldLabel>
                  <Input id="g-name" placeholder="Jacket product graph" />
                  <FieldDescription>Shown in the workspace header.</FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <Checkbox id="g-check" defaultChecked />
                  <FieldLabel htmlFor="g-check">Show all decimal places</FieldLabel>
                </Field>
              </FieldGroup>
            </FieldSet>
          </Row>

          <Row title="Select">
            <Select defaultValue="climate">
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Impact method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="climate">Climate change</SelectItem>
                <SelectItem value="water">Water use</SelectItem>
                <SelectItem value="land">Land use</SelectItem>
              </SelectContent>
            </Select>
          </Row>

          <Row title="Radio group">
            <RadioGroup defaultValue="scaled" className="flex gap-6">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="scaled" id="g-scaled" />
                <Label htmlFor="g-scaled">Scaled graph</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="structure" id="g-structure" />
                <Label htmlFor="g-structure">Structure graph</Label>
              </div>
            </RadioGroup>
          </Row>

          <Row title="Toggle and toggle group">
            <Toggle>Snap</Toggle>
            <Toggle defaultPressed>Grid</Toggle>
            <Separator orientation="vertical" className="h-8" />
            <ToggleGroup type="single" defaultValue="graph">
              <ToggleGroupItem value="graph">Graph</ToggleGroupItem>
              <ToggleGroupItem value="editor">Editor</ToggleGroupItem>
              <ToggleGroupItem value="results">Results</ToggleGroupItem>
            </ToggleGroup>
          </Row>

          <Row title="Overlays">
            <Dialog>
              <DialogTrigger asChild><Button variant="outline">Dialog</Button></DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Rename study</DialogTitle>
                  <DialogDescription>Give this product graph a new name.</DialogDescription>
                </DialogHeader>
                <Input defaultValue="Copy of Jacket" />
                <DialogFooter>
                  <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
                  <Button>Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {/* AlertDialog exports no Trigger -- it is controlled by `open`. */}
            <Button variant="destructive" onClick={() => setAlertOpen(true)}>
              Alert dialog
            </Button>
            <AlertDialog open={alertOpen} onOpenChange={setAlertOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this node?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Its connections will be removed. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <Popover>
              <PopoverTrigger asChild><Button variant="outline">Popover</Button></PopoverTrigger>
              <PopoverContent className="flex flex-col gap-2">
                <p className="text-sm font-medium">Decimal places</p>
                <p className="text-sm text-muted-foreground">
                  Applied to numerical results across the workspace.
                </p>
              </PopoverContent>
            </Popover>

            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="outline">Dropdown</Button></DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>File</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>New study</DropdownMenuItem>
                <DropdownMenuItem>Open…</DropdownMenuItem>
                <DropdownMenuItem>Export YAML</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Tooltip>
              <TooltipTrigger asChild><Button variant="ghost">Tooltip</Button></TooltipTrigger>
              <TooltipContent>Fit the graph to the viewport</TooltipContent>
            </Tooltip>
          </Row>

          <Row title="Separator">
            <div className="flex w-full flex-col gap-3">
              <span className="text-sm">Above</span>
              <Separator />
              <span className="text-sm">Below</span>
            </div>
          </Row>
        </div>
      </div>
    </TooltipProvider>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
)
