---
name: PRISM Product Graph Editor
colors:
  background: "#0b0d10"
  background-deep: "#090b0e"
  surface: "#111318"
  surface-raised: "#171a20"
  surface-muted: "#1a1d22"
  on-surface: "#f4f4f5"
  on-surface-muted: "#9298a3"
  outline: "#282c33"
  primary: "#8b5cf6"
  primary-secondary: "#6366f1"
  graph-edge: "#2563eb"
  foreground-process: "#a78bfa"
  background-process: "#38bdf8"
  positive: "#22c55e"
  warning: "#fbbf24"
  destructive: "#fb7185"
  light-background: "#eef1f5"
  light-surface: "#ffffff"
  light-on-surface: "#172033"
  light-outline: "#cbd1da"
typography:
  family: "Inter, ui-sans-serif, system-ui, sans-serif"
  monospace: "SFMono-Regular, Consolas, Liberation Mono, monospace"
  page-title: "22px / 620 / -0.035em"
  panel-title: "19px / 650 / -0.025em"
  section-title: "12px / 650"
  control: "11px / 500"
  overline: "9px / 750 / 0.09em uppercase"
rounded:
  small: "6px"
  default: "8px"
  medium: "10px"
  large: "12px"
  pill: "999px"
spacing:
  unit: "4px"
  topbar-height: "58px"
  graph-grid: "22px"
  panel-inset: "18px"
---

# PRISM Product Graph Editor Design System

## Visual Theme & Atmosphere

PRISM is a precision workspace for modeling product systems and inspecting life-cycle assessment results. It should feel like a serious analytical instrument: restrained, dense, legible, and responsive to direct manipulation. The visual hierarchy comes from layered neutral surfaces, fine outlines, small type, and carefully reserved semantic color—not from decoration.

Dark mode is the default expression. It uses a near-black canvas with graphite panels and luminous purple, blue, cyan, green, and rose signals. Light mode is a complete alternate theme, not a washed-out dark theme: use cool gray page surfaces, white cards, dark navy text, and stronger semantic colors for adequate contrast.

The graph canvas is the visual center. Controls float above it as compact translucent tools. Inspectors and settings feel like contained instrument panels. Result views are deliberately denser and more tabular, with clear column alignment and generous canvas allocation around them.

Avoid oversized marketing typography, decorative gradients outside the brand mark, excessive rounding, glassmorphism everywhere, and large empty cards. This is an expert application, so compactness is intentional, but every control must remain discoverable and usable.

## Color Palette & Roles

### Dark theme foundations

- **Deep workspace — `#090b0e`:** document body and deepest application backdrop.
- **Graph canvas — `#0b0d10`:** primary working canvas and default background token.
- **Base surface — `#111318`:** cards, popovers, floating navigation, and primary contained surfaces.
- **Raised surface — `#171a20`:** expanded graph nodes and visually elevated content.
- **Muted surface — `#1a1d22`:** quiet sections, controls, and secondary regions.
- **Active surface — `#292d35`:** selected tabs and pressed controls.
- **Primary text — `#f4f4f5`:** titles and high-emphasis content.
- **Secondary text — `#9298a3`:** labels, metadata, and helper text.
- **Outline — `#282c33`:** standard separators and panel borders.
- **Strong control outline — `#343944`:** inputs and interactive boundaries.

### Light theme foundations

- **Workspace — `#eef1f5`:** cool-gray page and canvas background.
- **Surface — `#ffffff`:** cards, popovers, tables, nodes, and inspectors.
- **Quiet surface — `#f8fafc`:** headers, node sections, and subdued rows.
- **Selected surface — `#dfe4eb`:** active navigation and selected regions.
- **Primary text — `#172033`:** standard foreground; use black only for maximum-emphasis data.
- **Secondary text — `#687385`:** descriptions and metadata.
- **Outline — `#cbd1da`:** borders and input boundaries.

### Brand and semantic signals

- **Primary violet — `#8b5cf6`:** focus rings, brand identity, and selected accents.
- **Deep violet — `#7c3aed`:** light-theme violet and foreground-process emphasis.
- **Indigo — `#6366f1`:** second stop of the compact PRISM brand-mark gradient.
- **Graph edge blue — `#2563eb`:** graph connections and strong blue signals.
- **Foreground process — `#a78bfa`:** foreground process nodes and scope labels in dark mode.
- **Background process / extraction — `#38bdf8`:** background database nodes, calculation status, and extraction flows in dark mode.
- **Positive — `#22c55e`:** successful or favorable values; use `#15803d` in light mode.
- **Warning — `#fbbf24`:** caution or path emphasis; use `#92400e` for light-theme text.
- **Emission / destructive — `#fb7185`:** emissions, negative results, and destructive actions; use `#dc2626` in light mode.

Semantic color should identify meaning consistently across nodes, rows, badges, and values. Do not use it as large-area decoration. Selected graph elements may add a low-opacity halo derived from their semantic color.

## Typography Rules

Use **Inter** first, followed by the system sans-serif stack. The application relies on compact sizes and carefully varied weight rather than dramatic scale.

- Page heading: 22px, weight 620, tight `-0.035em` tracking.
- Inspector or prominent panel title: 19px, weight 650, tight `-0.025em` tracking.
- View title: 15px, weight 650, paired with a 10px muted subtitle when needed.
- Section heading: 12px, weight 600–650.
- Body and property text: 12px with restrained line height.
- Controls, table headers, and compact navigation: 10–11px, weight 500–650.
- Overlines and categorical labels: 8–9px, weight 700–750, uppercase, `0.05em–0.14em` tracking.
- Numeric result columns use tabular numerals and right alignment.
- YAML and code surfaces use **SFMono-Regular**, Consolas, or Liberation Mono at approximately 12px with a 1.6 line height.

Use sentence case for buttons and navigation. Reserve uppercase for short category labels such as scope, property groups, and inspector overlines. Truncate long process names only where spatially necessary and preserve the full value through a tooltip or detail view.

## Component Stylings

### Application shell and brand

The desktop top bar is 58px tall, nearly opaque, and divided from the workspace by a one-pixel border. The brand mark is a compact 28px square with an 8px radius and a violet-to-indigo gradient. Pair it with the product name and current study title; the study title is the more contextual, truncatable element.

Keep utility actions at the opposite edge. Standard controls are compact, typically 26–34px high. Icon-only touch controls may grow to 36–40px at narrow widths.

### Primary navbar and contextual controls

Use a compact, full-width primary navbar rather than a floating segmented view rail. It separates global navigation from controls that operate on the current view: the navbar answers “Where am I going?” while contextual canvas and results toolbars answer “What can I do here?” The desktop hierarchy is PRISM identity, File menu, Graph, Editor, Results menu, the directly visible product selector when space permits, global settings, and compact calculation status.

The **File** menu contains document-level actions for starting or pasting YAML, uploading YAML, and downloading or exporting. **Graph** and **Editor** are direct workspace destinations. The **Results** menu contains Inventory, Impact analysis, Process results, Contributions, and Sankey; entries that require a completed calculation remain visibly disabled until available.

The **product selector** is the existing **LCA File** dropdown. It selects and loads a product-graph YAML from the server catalog. It is not a general-purpose Product command menu. Keep it directly visible at desktop widths; place it in a contained navigation sheet or menu only when space requires this at narrower widths.

**Status is not a menu.** It is a compact, non-interactive indicator that shows “Calculating…” during LCA calculation, “Processing…” during background graph processing, an appropriate error state when needed, and no label when idle. Do not let it crowd primary destinations.

Keep graph zoom, fit, layout, expand/collapse, and graph settings on the graph canvas. Keep Sankey settings with Sankey, and keep impact-category, table, and analysis controls within their respective result views. Active navigation uses `#292d35` rather than a loud fill. At narrow widths, use a compact header and contained menu, Sheet, or Drawer; do not force every label into one row or create page-level overflow. Touch targets must remain comfortable for touch and keyboard use.

### Buttons and form controls

Buttons are rectangular with restrained 6–8px radii, a one-pixel boundary, and clear hover, pressed, focus-visible, and disabled states. The default focus ring is violet. Destructive actions use rose/red only where the action is genuinely destructive.

Inputs, selects, and search fields use dark graphite or white surfaces according to theme, 1px outlines, and 8px radii unless embedded in a dense legacy results toolbar. Search is 34px tall on desktop. Labels remain visible; placeholder text must not be the only label.

### Graph canvas and connections

The canvas uses a subtle 22px dotted grid with a faint vignette so graph content remains dominant. Keep the graph and Sankey canvases expansive and avoid placing persistent chrome over their central working area. Edges use blue by default, with readable labels on theme-appropriate opaque backplates.

Selected elements gain a stronger colored outline and soft 20%-opacity halo. Dim unrelated graph elements to approximately 14–20% opacity during path or selection focus, while keeping the selected path fully legible.

### Process nodes

Collapsed nodes are compact horizontal chips, approximately 34px high, with a 10px radius and a semantic node color. Their icon sits in an 18px colored square with a 6px radius. Labels truncate cleanly, and the circular expand control stays visually secondary.

Expanded nodes are 270px wide in the graph and up to 300px in Sankey contexts, with a 12px radius, overflow containment, and a raised `#171a20` surface. The 34px header carries the semantic color in its border and icon. Divide inputs, outputs, extractions, and emissions into compact sections with aligned quantities. Foreground scope is violet; background scope is cyan/blue. Extractions are cyan, emissions are rose, and reference outputs retain foreground violet.

### Panels, inspectors, popovers, and dialogs

Floating panels use a 10–12px radius, a crisp one-pixel outline, 94–98% opaque surface, 10–12px blur, and a deep but soft shadow. The graph inspector is 286px wide on desktop and 270px at tablet sizes. It slides in from the right, fills the available height between the top controls and lower edge, and scrolls internally.

Inspector sections use small uppercase overlines, thin separators, and two-column property rows with strong numeric alignment. Settings panels are roughly 330px wide on larger screens but must be constrained to the viewport on phones. Dialogs and popovers must never extend beyond the viewport; dense settings should become a contained sheet, drawer, or internally scrolling overlay when necessary.

Respect reduced-motion preferences by removing pulsing status animation and inspector transitions.

### Tables and analytical result views

Keep semantic HTML tables. Headers are compact, medium gray (`#5d6265`) in dark mode and cool gray (`#dfe4ea`) in light mode. Use 10–11px table text, 28–34px row heights, tabular numerals, right-aligned numeric columns, fine cell separators, and subtle row hover states.

Tables scroll inside bordered containers; the document itself must not scroll horizontally. Sticky headers are appropriate for long impact tables. Resizable columns use a narrow handle with a cyan hover and focus-visible indicator. Hierarchical result tables communicate indentation, expansion, process scope, extraction, and emission through structure plus labels—not color alone.

### YAML editor and reports

The YAML editor is a focused monospace surface: `#0d1015` with `#cbd5e1` text in dark mode, and `#fbfcfd` with `#263244` text in light mode. Keep editor actions compact and visually separate validation or calculation status.

Markdown reports use a readable centered column up to 900px, 12px body text at approximately 1.65 line height, 23px report headings, and semantic tables that match the surrounding application.

### Icons, tooltips, and status

Use Lucide line icons with consistent optical sizing, usually 14–18px. Icons support labels and may replace them only when the action is conventional and a tooltip or accessible name is present. Tooltips use a compact 5px radius, 11px text, high contrast, and a soft shadow.

Calculation activity uses cyan text and a small pulsing cyan dot. Honor reduced motion and present the same status in text.

## Layout Principles

The application is a full-height workspace with a fixed-height top bar and a remaining canvas region. Primary graph and Sankey views should consume nearly all available space. Floating chrome sits near the edges, normally around 18–28px from its container, and should not form a second permanent sidebar unless the workflow requires it.

Use a 4px base spacing rhythm. Common gaps are 8px, 10px, 12px, 18px, 22px, and 28px. Dense controls may use 4–8px internal gaps; analytical panels need 18–28px outer padding. Prefer one-pixel dividers over large spacing when separating tightly related data.

### Responsive behavior

Design and verify every major workflow at **375 × 812**, **768 × 1024**, and **1440 × 900**.

- **Desktop / 1440px:** show the full PRISM identity, primary destinations, directly visible LCA File product selector, labeled settings action, and status when active. Preserve wide graph and table surfaces. Use floating contextual inspectors and canvas controls without obscuring central content.
- **Tablet / 768px:** keep primary destinations visible, constrain study titles, reduce the inspector to 270px, and move lower-priority utilities into a contained overflow menu when needed.
- **Phone / 375px:** use a compact header containing product identity or current file, the current section, and a menu trigger. Put destinations and utilities in a keyboard- and touch-accessible Sheet, Drawer, or menu. Constrain search, popovers, and settings to the viewport. Move narrow inspectors or dense settings into a contained overlay when that preserves the canvas better.

At every width, all major views and actions remain reachable, the page has no horizontal overflow, graph and Sankey canvases retain useful working space, tables scroll within their own containers, and dialogs remain fully inside the viewport. Maintain keyboard focus order, visible focus treatment, and comfortable touch targets.

## Design System Notes for Stitch Generation

When generating PRISM screens in Stitch, describe the result as a **dark-first scientific graph-analysis workspace**, not a generic admin dashboard. Start with the compact full-width application navbar, near-black dotted graph canvas, contextual edge controls, and small semantic process nodes. Use thin graphite outlines, restrained 8–12px rounding, Inter typography, Lucide line icons, and dense but orderly control spacing.

For a graph-editor screen, ask for an expansive XYFlow-style canvas with blue connections, violet foreground nodes, cyan background nodes, a compact search field at the upper left, edge-aligned contextual canvas controls, and a right-side inspector that slides over the canvas without permanently shrinking it. Keep File, Graph, Editor, Results, product selection, settings, and calculation status in the global navbar rather than in the graph controls.

For analytical results, ask for a contained full-height results surface with compact controls, semantic HTML-style tables, sticky gray headers, hierarchical rows, tabular numeric columns, and internal scrolling. Preserve semantic colors for foreground processes, background processes, extractions, emissions, positive values, warnings, and calculation status.

For responsive variants, explicitly generate the same workflow at 1440 × 900, 768 × 1024, and 375 × 812. On phone layouts, simplify brand chrome, enlarge icon touch targets, place global navigation in a viewport-contained menu or sheet, and convert dense inspectors to contained overlays while leaving useful graph canvas visible.

Generate dark and light versions as matched themes. In light mode, replace the near-black workspace with cool gray `#eef1f5`, use white surfaces, navy `#172033` text, `#cbd1da` outlines, and stronger violet, blue, green, and red semantic colors. Do not change information architecture or semantic meaning between themes.
