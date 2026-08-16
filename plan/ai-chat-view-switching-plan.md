# AI Chat View-Switching Plan

## Implementation status

- [x] Navigation-only tool boundary implemented
- [x] `list_views`, `get_active_view`, and `switch_view` registered with strict schemas
- [x] Available-result rules enforced for analysis views
- [x] Existing guarded navigation path reused
- [x] OpenRouter-compatible streaming transport implemented
- [x] Non-modal, resizable right sidebar implemented
- [x] Phone, tablet, and desktop Playwright workflows added
- [x] API key and selected model persisted in browser local storage
- [ ] Production backend model proxy
- [ ] Dedicated unit-test runner for tool validation independent of Playwright

## Objective

Embed an AI chat panel in the Product Graph Editor with one deliberately narrow capability: understand the application's registered views and switch to an available view at the user's request.

This milestone proves the chat transport, application-context boundary, validated tool execution, responsive shell integration, and shared Zustand action path without allowing the assistant to modify YAML, run calculations, change graph settings, or mutate model data.

## User Experience

Add an **AI assistant** action to the application navigation.

- Desktop: open a collapsible right-side chat panel while preserving useful graph and result-view space.
- Phone and tablet portrait: open the chat in a contained full-height dialog surface so it does not permanently reduce the canvas.
- Preserve keyboard focus when opening and closing the chat.
- Keep the composer, messages, errors, and controls inside the viewport.

Example requests:

- "Show me the YAML editor."
- "Go to the graph."
- "Open LCA results."
- "Show the Sankey view."

If a requested analysis view is unavailable because there is no current calculation, the assistant must explain that and leave the current view unchanged.

## Capability Boundary

The first milestone exposes only:

```text
list_views()
get_active_view()
switch_view({ view })
```

The runtime may read:

- the active view
- the registered view names and descriptions
- whether each view is currently available
- the reason an unavailable view is disabled

The runtime may change only the active view through the application's guarded navigation path.

The assistant must not:

- read or edit YAML contents
- start or cancel calculations
- read complete graph or LCA result payloads
- select graph nodes
- change graph, result, or Sankey settings
- save, replace, upload, download, or delete models

## Architecture

Add a small integration boundary:

```text
src/ai/
├── viewRegistry.ts
├── viewTools.ts
├── chatTransport.ts
└── types.ts

src/components/
└── AiChatPanel.tsx
```

### View registry

Create one registry for the model-facing view identifiers, labels, descriptions, and availability rules:

- `graph`
- `yaml`
- `results`
- `inventory`
- `impact`
- `process`
- `contribution`
- `sankey`

Analysis views other than the general Results view require current LCA results, matching the existing human navigation controls.

### Guarded navigation

The chat must not assign `activeView` directly. A successful `switch_view` request is handed to the same `requestView`/`requestAction` flow used by navigation controls so existing unsaved-YAML confirmation behavior remains authoritative.

The tool returns a structured result:

```ts
type SwitchViewResult =
  | { status: "completed"; view: ProductGraphView; label: string }
  | { status: "unavailable"; view: ProductGraphView; reason: string }
  | { status: "confirmation_required"; view: ProductGraphView; reason: string }
```

### Chat transport

Keep provider-specific behavior behind a transport interface. The browser chat owns conversation presentation and streaming state; the host owns credentials and request delivery.

For local development, allow an OpenRouter-compatible endpoint and a user-supplied browser-session key. Production deployment must replace this with a backend proxy so provider credentials are not shipped to the browser.

### Tool loop

Support OpenAI-compatible function definitions and streamed tool calls. Validate every tool name and argument locally before invoking the host navigation callback. Unknown tools and invalid view identifiers return structured errors without changing application state.

## Implementation Sequence

1. [x] Define the view registry, availability selector, tool schemas, and validation.
2. [ ] Add a dedicated unit-test runner for listing views, reading the active view, rejecting invalid or unavailable views, and requesting valid navigation. Equivalent mocked Playwright coverage exists today.
3. [x] Add the transport-independent chat controller and mocked transport used by browser tests.
4. [x] Build the chat panel with the repository's existing React, shadcn/Radix, Tailwind, Markdown, and theme primitives.
5. [x] Connect valid tool calls to the existing guarded navigation callback in `App.tsx`.
6. [x] Add the responsive, non-modal desktop sidebar and contained narrow-screen behavior.
7. [x] Add Playwright workflows with a mocked transport so tests require no provider key or network.
8. [x] Exercise and visually inspect the workflow at 375 x 812, 768 x 1024, and 1440 x 900.

## Verification

Automated coverage must demonstrate:

- the assistant action is reachable at all supported sizes
- the chat opens, closes, and restores focus
- a user can submit with Enter and add a newline with Shift+Enter
- plain and streamed assistant responses render correctly
- `list_views` reports accurate availability
- `get_active_view` reflects human and assistant navigation
- `switch_view` opens Graph, Edit, and Results
- unavailable analysis views are rejected without navigation
- available analysis views can open after a current calculation exists
- dirty YAML navigation uses the existing confirmation flow
- invalid tool arguments cannot change the active view
- the document has no page-level horizontal overflow
- the graph retains useful space when the desktop chat is open

Run the repository suites separately:

```bash
npm run build
npm run lint
npm run test:responsive
npm run test:visual
```

Compare visual failures with `plan/responsive-baseline.md`. No previously passing visual test may fail, and no accepted failure may change or expand. Do not update screenshots without inspecting actual, expected, and diff images.

## Definition of Done

This milestone is complete when a user can ask the embedded assistant to identify and switch application views, unavailable views remain protected, unsaved-work safeguards cannot be bypassed, no other product state is exposed or mutable, and the build, lint, responsive, and previously passing visual checks remain green.
