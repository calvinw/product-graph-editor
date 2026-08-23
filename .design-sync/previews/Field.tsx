import {
  Checkbox, Field, FieldContent, FieldDescription, FieldError, FieldGroup,
  FieldLabel, FieldLegend, FieldSeparator, FieldSet, FieldTitle, Input,
} from "product-graph-editor"

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

export function StudyDetails() {
  return (
    <Frame>
      <FieldSet className="w-full max-w-md">
        <FieldLegend>Study details</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="f-name">Study name</FieldLabel>
            <Input id="f-name" defaultValue="Cotton tote bag" />
            <FieldDescription>Shown in the workspace header and on exports.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="f-unit">Functional unit</FieldLabel>
            <Input id="f-unit" defaultValue="1 unit" />
            <FieldDescription>The reference amount every result is scaled to.</FieldDescription>
          </Field>
        </FieldGroup>
      </FieldSet>
    </Frame>
  )
}

export function HorizontalAndSeparated() {
  return (
    <Frame>
      <FieldGroup className="w-full max-w-md">
        <Field orientation="horizontal">
          <Checkbox id="f-decimals" defaultChecked />
          <FieldContent>
            <FieldTitle>Show all decimal places</FieldTitle>
            <FieldDescription>Applied to numerical results across the workspace.</FieldDescription>
          </FieldContent>
        </Field>
        <FieldSeparator />
        <Field orientation="horizontal">
          <Checkbox id="f-reference" />
          <FieldContent>
            <FieldTitle>Show reference amounts</FieldTitle>
            <FieldDescription>Annotate each edge with its scaled flow amount.</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
    </Frame>
  )
}

export function Invalid() {
  return (
    <Frame>
      <Field className="w-full max-w-md" data-invalid="true">
        <FieldLabel htmlFor="f-threshold">Contribution threshold</FieldLabel>
        <Input id="f-threshold" defaultValue="-4" aria-invalid />
        <FieldError>Threshold must be between 0 and 100 percent.</FieldError>
      </Field>
    </Frame>
  )
}
