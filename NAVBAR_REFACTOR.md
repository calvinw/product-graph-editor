# Navbar Refactor

## Recommendation

Move the application's primary navigation into a compact, full-width navbar, but do not copy every existing toolbar control into one row. Use a sectioned, menu-style navbar that separates global navigation from controls that operate on the current view.

The navbar should answer **“Where am I going?”** Contextual toolbars should answer **“What can I do here?”**

## Proposed desktop hierarchy

```text
┌──────────────────────────────────────────────────────────────────────┐
│ PRISM │ File ▾ │ Graph │ Editor │ Results ▾ │ Product ▾ │ ⚙ │ Status │
└──────────────────────────────────────────────────────────────────────┘
```

### File menu

Use `File` for document-level actions such as:

- create or paste YAML
- upload YAML
- download or export actions

### Primary workspace destinations

- `Graph` opens the graph workspace.
- `Editor` opens the YAML editor.
- `Results` is a primary destination with its analytical views grouped beneath it.

The Results section should include:

- Inventory
- Impact analysis
- Process results
- Contributions
- Sankey

Results that require a calculation should remain visibly disabled until they are available.

### Product and utilities

- Keep the product selector directly visible when space permits.
- Keep global settings available from every viewport.
- Show calculation status consistently without allowing it to crowd primary navigation.
- Theme controls may remain inside global settings.

## Controls that should remain contextual

Do not move controls into the navbar merely because space is available. Keep controls close to the surface they manipulate:

- graph zoom, fit, layout, and expand/collapse controls stay on the graph canvas
- graph settings stay with the graph view
- Sankey settings stay with the Sankey view
- impact-category, table, and analysis controls stay in their respective result views

This separation prevents the global navbar from becoming dense and difficult to understand.

## Responsive behavior

Design and verify the navbar at the repository's three supported viewport sizes:

- 375 × 812 — phone
- 768 × 1024 — tablet portrait
- 1440 × 900 — desktop

### Desktop

Use one compact top navbar with visible primary destinations, the product selector, global settings, and status where space permits.

### Tablet

Keep primary destinations visible. Move lower-priority utilities into an overflow menu when necessary. Do not allow the document to overflow horizontally.

### Phone

Do not force every label into one horizontal row. Use a compact header with the product identity or current file, the current section, and a menu trigger. Contextual actions can appear in a separate contained row, menu, Sheet, or Drawer.

Every major destination and action must remain reachable by touch and keyboard.

## Design workflow

Treat this as an application-shell and information-architecture change rather than a small CSS adjustment.

1. Redesign only the application header and primary navigation in Stitch.
2. Produce phone, tablet portrait, and desktop variants.
3. Confirm the hierarchy for File, Graph, Editor, Results, product selection, settings, and calculation status.
4. Review and approve the navigation behavior before implementation.
5. Update `.stitch/DESIGN.md` to replace its current floating-navigation guidance.
6. Implement the approved shell in React.
7. Add or update behavioral Playwright coverage at all three supported sizes.

Do not ask Stitch to redesign the entire Product Graph Editor as part of this task. Preserve the established graph canvas, inspectors, YAML editor, analytical tables, and their behavior unless a specific navbar integration requires a narrowly scoped adjustment.

## Acceptance criteria

- Primary destinations are clear and reachable at all three supported sizes.
- File actions are grouped separately from workspace navigation.
- Results retain a clear secondary hierarchy.
- Contextual controls remain close to the views they manipulate.
- The navbar increases usable workspace without obscuring the canvas.
- Product selection, global settings, and calculation status remain accessible.
- The page has no horizontal overflow.
- Keyboard navigation, focus behavior, and touch targets remain usable.
- Existing desktop behavior outside the application shell is preserved.
- Build, lint, responsive tests, and the recorded visual baseline remain within expectations.
