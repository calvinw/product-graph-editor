# General Agent State Plan

## Objective

Provide a reusable Zustand-based state and command package inside this repository. It must work across different applications and panels without containing retail-chat, LCA, React-component, or other product-specific assumptions.

The shared architecture is:

```text
Human UI action ─┐
                 ├─> named application action ─> Zustand ─> subscribed consumers
LLM command ─────┘
       ↑
validation, availability checks, confirmation, and audit history
```

Applications supply their own state shape, actions, selectors, validators, and commands. The package supplies state creation, safe persistence, the LLM command boundary, confirmation lifecycle, and optional React bindings.

## Package Boundary

The implementation lives in `packages/agent-state` and is independently installable and testable.

```text
packages/agent-state/
├── src/
│   ├── createAgentStore.js
│   ├── createCommandBus.js
│   ├── storage.js
│   ├── react.js
│   └── index.js
├── test/
├── README.md
└── package.json
```

The default export surface does not import React. React applications use the separate `@ai-lca-tools/agent-state/react` entry point.

## State Store

`createAgentStore` accepts:

- `initialState`: application-owned data
- `actions`: a factory for named and validated application actions
- `persistence`: optional, explicitly selected persistence configuration

The resulting vanilla Zustand state contains:

```js
{
  data: applicationState,
  meta: { revision: 0 },
  actions: applicationActions
}
```

Actions receive a restricted API:

- `get()`: current application data
- `getRevision()`: current revision
- `set(update, replace?)`: update application data and increment the revision

The application should keep business rules in named actions. Human controls and LLM commands call those same actions, preventing two competing mutation paths.

## State Ownership

Good shared state includes:

- Active panels or views
- Cross-panel selections
- Shared filters
- Loaded domain data
- Calculation or request status
- Conversation state used by multiple surfaces
- User preferences needed across sessions

Keep these outside shared state unless the host has a specific reason:

- DOM nodes and refs
- Abort controllers and stream readers
- Hover and animation state
- Unsubmitted form drafts owned by one component
- Credentials and secrets

## LLM Command Bus

`createCommandBus` maps model-facing command names to application-defined execution functions. A command may specify:

- Model-facing description
- JSON Schema parameters
- Runtime validation and normalization
- Availability rules
- Risk category
- Confirmation summary
- Execution function

The execution context contains current data, named actions, revision information, and read-only getters. It deliberately excludes Zustand's raw `setState`.

The public result statuses are:

- `completed`
- `confirmation_required`
- `rejected`
- `error`

Errors contain stable codes so UI and model adapters do not need to parse error text.

## Confirmations

Commands marked `mutation`, `external`, or `destructive` require confirmation by default. Applications can configure the risk set or mark an individual command with `confirm: true`.

The initial execution creates a pending proposal with:

- Unique confirmation ID
- Command and validated arguments
- User-facing summary
- Source
- Creation time
- Application revision

Only `commandBus.confirm(id)` can execute the proposal. There is no public execution option that bypasses confirmation.

By default, confirmation fails if application state changed after the proposal. A command may allow intervening state changes when its own action performs sufficient revalidation.

## Context and Tool Definitions

Applications provide a `contextSelector` that exposes only the state appropriate for the model:

```js
const commandBus = createCommandBus({
  store,
  contextSelector: state => ({
    activePanel: state.activePanel,
    selectedId: state.selectedId
  }),
  commands
})
```

`commandBus.getContext()` returns that safe projection. Detailed or sensitive data should be accessed through specific query commands.

`commandBus.getToolDefinitions()` produces OpenAI-compatible function definitions from the same command configuration used for validation and execution.

## Persistence

Persistence is opt-in and requires an explicit `select` function. This makes it difficult to accidentally persist secrets, request state, transient errors, or full conversations.

```js
persistence: {
  name: 'application-preferences',
  version: 1,
  storage,
  select: state => ({
    theme: state.theme,
    panelSizes: state.panelSizes
  })
}
```

Browser JSON storage and in-memory test storage helpers are provided. Hosts own schema migrations and custom merge behavior.

## React Integration

`createStoreHook(store)` binds any vanilla store to React. Panels should use narrow selectors:

```js
const selectedId = useAppStore(state => state.data.selectedId)
const selectRecord = useAppStore(state => state.actions.selectRecord)
```

`createCommandRuntimeHook(commandBus)` gives confirmation and audit panels reactive access to command runtime state.

Other frameworks can use the vanilla `getState` and `subscribe` methods without React.

## Verification

Automated tests must cover:

- Named action updates and revision tracking
- Isolation between store instances
- Invalid state updates
- Explicit persistence selection
- Successful validated command execution
- Invalid and unknown commands
- Mandatory command executors
- Confirmation requirements and rejection
- Inability to bypass confirmation through execution options
- Stale confirmation protection
- Tool definition and context generation

The package is complete when its test suite and syntax checks pass independently and its README documents vanilla, React, command, confirmation, and persistence usage.

---

# Product Graph Editor Integration Plan

## Goal

Embed the reusable AI chat in `product-graph-editor` so the assistant can discover registered views, switch between them, read deliberately exposed state, and invoke validated application actions. Human controls and model commands must use the same named Zustand actions.

Zustand will become the shared source of truth only for state used across views or by the assistant. Transient presentation state can remain in React.

```text
Navbar or view control ─┐
                        ├─> named Zustand action ─> product editor UI
LLM tool call ──────────┘
             ↑
registered view schema, safe selector, validation, and confirmation
```

## Principles

- Do not copy the complete AI Chat Tool example into the product editor.
- Reuse `@ai-lca-tools/agent-state` and an extracted chat component.
- Keep product-specific pane definitions in `product-graph-editor`.
- Do not maintain synchronized React and Zustand copies of the same state.
- Never provide raw Zustand `setState` to the model.
- Do not automatically expose complete graphs, YAML documents, or LCA results.
- Preserve all existing unsaved-work, availability, and confirmation rules.
- Reuse the product editor's existing shadcn components and theme.

## Phase 1: Prepare the Reusable Packages

### Support an Existing Host Store

Extend `@ai-lca-tools/agent-state` so a pane runtime can register an existing host-owned Zustand store instead of always constructing a separate pane store.

The intended API is conceptually:

```ts
createPaneRuntime({
  store: productGraphStore,
  panes: productGraphPanes
})
```

Required behavior:

- Continue supporting the current self-contained store mode.
- Let pane selectors read host application state.
- Let commands invoke only registered host actions.
- Preserve validation, revision tracking, confirmations, and audit history.
- Reject duplicate pane IDs and tool names during startup.
- Keep raw store mutation outside the command execution context.

### Extract the Chat Component

Create a reusable React component such as:

```tsx
<AiChatPanel
  runtime={productGraphRuntime}
  models={models}
  transport={transport}
  storageNamespace="product-graph-editor"
/>
```

The reusable component owns:

- Conversation rendering and history
- Composer and response streaming
- Model selection
- Tool-call execution rounds
- Tool activity and error presentation
- Stop-response behavior

The host application owns:

- Pane registration
- Zustand state and named actions
- Chat placement and visibility
- Provider transport and credentials
- Model availability
- Confirmation UI and policy

The component must not include the example Appearance, Response, or Fruit panes, require a full-page shell, or copy a second set of shadcn primitives into the destination.

### Package Distribution

Target two separately consumable packages:

```text
@ai-lca-tools/agent-state
@ai-lca-tools/chat-react
```

Use local package tarballs during integration. After the APIs stabilize, publish the packages to npm or GitHub Packages. React and Zustand should be peer dependencies where appropriate so the destination does not load duplicate runtime instances.

### Phase 1 Acceptance Criteria

- The existing AI Chat Tool demo still works.
- A test host can provide its own Zustand store.
- The chat UI renders independently from the example application shell.
- Package declarations work for TypeScript consumers.
- Runtime, confirmation, and tool-definition tests pass.

**Status:** implemented in `@ai-lca-tools/agent-state` and
`@ai-lca-tools/chat-react`. The package consumer smoke test installs local
tarballs into an isolated TypeScript fixture. Product-editor changes begin with
Phase 2 and remain intentionally out of this repository change.

## Phase 2: Add a Product Editor Store

Install Zustand in `product-graph-editor` and create a domain-specific state directory:

```text
src/state/
├── productGraphStore.ts
├── navigationSlice.ts
├── graphSlice.ts
├── workspaceSlice.ts
├── calculationSlice.ts
└── selectors.ts
```

The implementation may start in one file. The important boundary is the public state and named action API, not the number of files.

### First State to Migrate

Move the simplest shared state first:

- Active application view
- Selected graph node ID
- Graph mode
- Graph orientation
- Graph connection style
- Reference-amount visibility
- Calculation status
- Current-result availability and revision
- Active document metadata
- Result filters and selections shared across views

Define named actions such as:

```ts
actions.requestViewChange(view)
actions.selectNode(nodeId)
actions.clearNodeSelection()
actions.setGraphMode(mode)
actions.setGraphOrientation(orientation)
actions.startCalculation()
actions.completeCalculation(result)
actions.failCalculation(error)
```

Human controls must use these actions before any model commands are connected.

### State That Can Remain Local Initially

- Open dropdown and dialog state
- Temporary dialog input
- Hover and animation state
- Table column widths
- File input elements and DOM refs
- React Flow viewport state
- Abort controllers and active stream readers

React Flow nodes and edges may stay in the existing React Flow hooks initially. Store shared selection and display settings in Zustand. Move the complete graph only if model-driven graph editing requires a store-owned graph.

### Preserve Guarded Navigation

The product editor already protects view changes when work is unsaved. Both human navigation and model commands must go through the same request path:

```text
Tab click ──────┐
                ├─> requestViewChange ─> guard/confirmation ─> state update
LLM switch tool ┘
```

A model command must not directly assign the active view and bypass existing safeguards.

### Phase 2 Acceptance Criteria

- Existing human interactions behave the same after migration.
- Zustand is the only source of truth for each migrated value.
- No effects synchronize duplicate React and Zustand values.
- Unsaved-work protections still apply.
- Narrow selectors prevent unrelated view rerenders.

## Phase 3: Register Product Editor Views

Add an AI integration directory in the destination:

```text
src/ai/
├── paneRegistry.ts
├── paneRuntime.ts
├── modelConfig.ts
└── transport.ts
```

Register these application views:

- Graph
- Editor
- Results
- Inventory
- Impact Analysis
- Process Results
- Contributions
- Sankey

Each pane registration must define its model-facing description, availability rules, safe state selector, validated commands, and risk policy.

### Graph Pane

Expose a bounded summary such as:

```ts
{
  activeModelTitle,
  selectedNodeId,
  selectedNodeSummary,
  nodeCount,
  connectionCount,
  graphMode,
  graphOrientation
}
```

Candidate commands:

- `select_graph_node`
- `clear_graph_selection`
- `set_graph_mode`
- `set_graph_orientation`
- `focus_graph_view`

Do not expose the complete graph unless a specific workflow requires it.

### Editor Pane

Expose document metadata rather than the full YAML by default:

```ts
{
  documentTitle,
  hasUnsavedChanges,
  yamlIsValid,
  appliedRevision
}
```

Candidate commands:

- `open_editor`
- `save_document`
- `calculate_current_model`

Editing or replacing YAML should not be part of the first integration. When added, it must require confirmation and revalidation.

### Result Panes

Expose summarized result state:

```ts
{
  resultsAvailable,
  calculationStatus,
  selectedImpactCategory,
  selectedProcess,
  selectedFlow
}
```

Candidate commands:

- `select_impact_category`
- `select_result_process`
- `select_inventory_flow`
- `set_sankey_orientation`

Analysis panes must be unavailable until a current calculation exists, matching the existing disabled-view behavior.

### Command Risk Policy

| Action | Suggested risk |
|---|---|
| Read registered state | `read` |
| Switch view | `ui` |
| Change a display setting | `ui` |
| Select a node or result | `ui` |
| Start a calculation | `mutation` |
| Edit YAML | `mutation` |
| Replace a document | `mutation` |
| Delete a model | `destructive` |
| Download or export | `external` |

Mutation, destructive, and external actions should use host-controlled confirmation.

### Phase 3 Acceptance Criteria

- Only registered panes appear in model context.
- Each selector returns only its documented safe projection.
- Unavailable analysis views cannot be opened through a tool call.
- Invalid command arguments cannot mutate state.
- Commands use the same actions as human controls.

## Phase 4: Embed the Chat Panel

Mount the chat as a product-editor feature rather than replacing its shell.

Recommended placement:

- Collapsible right-side panel on desktop
- Full-height drawer on narrow screens
- Navbar control to open and close the chat

Reuse the destination's existing `Button`, `Dialog`, `Select`, and other shadcn components. The graph must resize or refit correctly when the chat panel opens and closes.

Configure the initial model list as:

```ts
[
  ['openai/gpt-4o-mini', 'GPT-4o mini'],
  ['openai/gpt-5.6-luna', 'GPT-5.6 Luna']
]
```

### Phase 4 Acceptance Criteria

- Opening the chat does not obscure required graph controls.
- The graph responds correctly to available-width changes.
- The chat is keyboard accessible.
- Responsive behavior works at existing test breakpoints.
- The model chooser appears only in the chat navbar.

## Phase 5: Secure the Model Transport

The local example may accept an OpenRouter key in browser storage, but a production product editor should proxy provider requests through a backend:

```text
Browser chat
    ↓
product-graph-editor backend
    ↓
OpenRouter
```

The backend should:

- Hold provider credentials
- Restrict allowed models
- Apply authentication and rate limits where appropriate
- Stream responses to the browser
- Avoid logging secrets or unnecessary application context

The browser executes registered UI tools locally after the tool call passes runtime validation and any required confirmation.

## Phase 6: Verification

### Store Tests

- Named actions update expected state.
- Invalid views and node IDs are rejected.
- Result views cannot open without current results.
- Unsaved-document rules cannot be bypassed.
- Selectors return stable, minimal projections.

### Pane Runtime Tests

- Only registered panes are listed.
- Only selected safe state reaches model context.
- Unregistered state cannot be read or changed.
- Invalid tool arguments do not mutate state.
- Risky actions require confirmation.
- Human and model actions produce identical store updates.

### Component and Integration Tests

- Chat opens, closes, streams, and stops correctly.
- Model selection works.
- Tool calls and failures render clearly.
- Switching Graph to Editor activates the Editor view.
- Inventory switching is rejected before calculation.
- Inventory switching succeeds after calculation.
- Selecting a graph node updates the inspector.
- Critical scenarios pass at desktop and mobile sizes.

## Recommended Pull Request Sequence

1. **Agent-state host-store support** — reusable API and unit tests.
2. **Reusable chat component** — extract UI without product-specific state.
3. **Product editor Zustand foundation** — navigation, selection, display settings, and calculation metadata.
4. **Product editor pane registry** — safe selectors, view switching, and registered actions.
5. **Embedded chat panel** — layout, accessibility, and responsive behavior.
6. **Production model proxy** — backend transport and credential handling.
7. **Integration tests** — mocked tool calls and responsive workflows.

Each pull request should remain independently testable and preserve current product-editor behavior.

## Definition of Done

The integration is complete when:

- Zustand is the only source of truth for shared AI-accessible state.
- Human controls and model tools use the same named actions.
- Every model-accessible view is explicitly registered.
- Unregistered state remains inaccessible.
- Result-view availability and unsaved-work protections cannot be bypassed.
- The reusable chat contains no product-specific business logic.
- Provider credentials are not shipped to production browsers.
- Unit, integration, responsive, and production-build checks pass.
