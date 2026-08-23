import { Button } from "product-graph-editor"
import { Play, Plus, Trash2 } from "lucide-react"

// Cards render on a white harness surface while :root defaults to the dark
// theme, so previews are framed in the light theme. Theme tokens are
// element-scoped, so this wrapper is all a consumer needs to theme a subtree.
function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="light" className="bg-background text-foreground rounded-lg p-6">
      {children}
    </div>
  )
}

export function Variants() {
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-3">
        <Button>Run calculation</Button>
        <Button variant="secondary">Duplicate study</Button>
        <Button variant="outline">Import YAML</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Delete node</Button>
        <Button variant="link">View documentation</Button>
      </div>
    </Frame>
  )
}

export function Sizes() {
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm">Small</Button>
        <Button>Default</Button>
        <Button size="icon" aria-label="Add process"><Plus /></Button>
      </div>
    </Frame>
  )
}

export function WithIcons() {
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-3">
        <Button><Play /> Run LCA</Button>
        <Button variant="outline"><Plus /> Add process</Button>
        <Button variant="destructive"><Trash2 /> Remove</Button>
      </div>
    </Frame>
  )
}

export function Disabled() {
  return (
    <Frame>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled>Run calculation</Button>
        <Button variant="outline" disabled>Import YAML</Button>
        <Button variant="destructive" disabled>Delete node</Button>
      </div>
    </Frame>
  )
}
