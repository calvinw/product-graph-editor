# Plan: adopt AI Elements in the assistant panel

Rebuild the assistant panel's presentation on the AI Elements registry, the same set the
FIT Retail Index chat app uses. Keep our transport, tool loop, confirmation gating, and
transcript pruning.

Direction set on review: adopt as much of the registry as applies, rather than
cherry-picking. The panel is to stop feeling hand-rolled next to
`calvinw/llm-chat-bus-dev`.

Status as of 30 August 2026: steps 1-7 delivered in aa66af3 and 571da23.

Three deviations were made deliberately and are recorded in those commits:

- `code-block` and Shiki were dropped. Taking them built a dist of 13MB across
  312 assets, against 2.2MB and 3 before. Tool payloads use a plain `pre`.
- The four `ui` primitives that `shadcn add` rewrote were reverted, because the
  button rewrite alone reshaped every control in the application. Only `icon-sm`
  was actually needed.
- The vendored directory is exempt from this project's lint style, following the
  precedent set for `src/components/ui`; `tsc` remains the gate.

Two problems found only by using it, both worth remembering:

- Passing `remarkPlugins` to the renderer *replaces* its defaults rather than
  adding to them. Wiring up KaTeX silently switched off `remark-gfm` and every
  markdown table fell back to raw pipes, with no error.
- The vendored components carry their own widths and type sizes -- `max-w-[95%]`
  on a message, shrink-to-fit on its content, a smaller scale inside tool blocks
  and a 32px conversation gap. All had to be overridden to fit a side panel.

Still to do: step 8 (the model selector in the composer footer -- the model name
is there now, but as a plain button that opens settings) and step 10 (prune the
dead `ai-chat-*` CSS, and drop `react-markdown` and `message-scroller` if nothing
else uses them).

---

## 1. What the reference app actually does

Studied `calvinw/llm-chat-bus-dev` at HEAD, the same repository `plan/mcp-remote-tools.md`
drew from.

`components.json` registers one extra registry:

```json
"registries": { "@ai": "https://registry.ai-sdk.dev/{name}.json" }
```

and vendors eleven components into `src/components/ai-elements/`: `conversation`,
`message`, `prompt-input`, `tool`, `reasoning`, `sources`, `code-block`,
`model-selector`, `suggestion`, `loader`, `shimmer`.

**AI Elements does not require the Vercel AI SDK runtime.**
`src/hooks/useOpenRouterChat.jsx` is 377 lines of direct
`fetch('https://openrouter.ai/api/v1/chat/completions')` with manual SSE buffer parsing,
delta-merged `tool_calls`, and a bounded tool loop (`MAX_TOOL_ROUNDS = 20`). It calls
neither `useChat` nor `streamText`. The `ai` and `@ai-sdk/openai` entries in that repo's
`package.json` are unused on this path.

That is the same shape as our `src/ai/chatTransport.ts` plus the loop in
`AiChatPanel.tsx:253-345`. The components' only contract is a message-parts shape:

```js
{ role, content, parts: [{ type: 'text', text }] }
{ type: `tool-${name}`, toolCallId, state, input, output }
```

`state` is one of `input-streaming`, `input-available`, `output-available`,
`output-error` (`tool.jsx:29-57`).

---

## 2. Adopt ten of the eleven

| Component | Replaces | Notes |
|---|---|---|
| `conversation` | `MessageScroller` | `Conversation`, `ConversationContent`, `ConversationEmptyState`, `ConversationScrollButton`. Uses `use-stick-to-bottom`. |
| `message` | the bubble + `ReactMarkdown` | `Message`, `MessageContent`, `MessageResponse`, `MessageActions`. Streamdown-backed. |
| `prompt-input` | the `textarea` + send `Button` | 1112 lines: attachments, action menu, submit/stop status, auto-resize. Retires `growPrompt()`. |
| `tool` | `<details><summary>` + `<pre>` | Collapsible with state badge, `Parameters`, output region. Surfaces tool *input*, which we never show today. |
| `loader` | the `"Thinking…"` span | |
| `suggestion` | the two welcome `Button`s | `Suggestions` + `Suggestion`, `AiChatPanel.tsx:384`. |
| `code-block` | nothing | Pulled in by `tool` and `message`. Shiki-backed. |
| `reasoning` | nothing | `Reasoning`, `ReasoningTrigger`, `ReasoningContent`. Nothing emits reasoning parts yet; vendor it and leave the branch dark until a model does. |
| `model-selector` | the `Select` in chat settings | Command-palette style with provider logos, `AiChatPanel.tsx:424`. Also lets the model move out of the settings dialog and into the composer footer, where the reference app puts it. |
| `shimmer` | nothing | Streaming-text treatment, pulled in by `message`. |

**Skip `sources`.** It renders retrieval citations. We have no RAG path.

### Consequences of taking the full set

- `MessageScroller` becomes unused. Decide whether to delete
  `src/components/ui/message-scroller.tsx` and drop `@shadcn/react`, or leave it for
  other surfaces. Nothing else imports it today.
- `react-markdown` becomes unused once `MessageResponse` lands. Drop it; keep
  `remark-gfm`, which Streamdown still takes.
- Taking `code-block` means taking Shiki. Accepted under this direction — the same
  highlighting also improves the large JSON tool payloads.

---

## 3. What is explicitly out of scope

None of this touches the logic layer, which stays exactly as it is:

- the bounded tool loop, `AiChatPanel.tsx:253-345`
- confirmation gating with the `STALE_CONFIRMATION` re-check, `AiChatPanel.tsx:310-320`
- MCP registry passthrough via `mcp.callTool`
- `pruneStaleSourceReads()`, `AiChatPanel.tsx:139-152`
- the resize handle, the API-key storage, the MCP server settings

---

## 4. A real defect this migration will not fix

Recorded here so it does not get mistaken for a rendering problem.

`AiChatPanel.tsx:274` rebuilds the API transcript each turn as

```ts
...priorMessages.map((message) => ({ role: message.role, content: messageText(message) }))
```

and `messageText()` (`AiChatPanel.tsx:43`) keeps only text segments. The `apiMessages`
array that accumulates assistant `tool_calls` and `role: "tool"` results is local to
`send()` and is discarded when it returns.

So every turn after the first sees the user's text and the assistant's prose, but no
record that a tool was ever called or what it returned. Tool results could not be
reconstructed even in principle: `ChatMessage` never stores `tool_call_id` or the
`tool_calls` array, and results live as segments *inside* the assistant message rather
than as separate `role: "tool"` rows.

Consequences:

- Follow-ups behave as though the earlier turn never happened. Anything the assistant's
  prose did not happen to mention is unrecoverable, so the model re-calls tools to answer
  questions about data it already fetched.
- `pruneStaleSourceReads()` (`AiChatPanel.tsx:139-152`) is nearly dead code. It only ever
  sees the current turn's `apiMessages`, and with `KEPT_SOURCE_READS = 1` and typically
  one read per turn the stale set is empty. The comment at `:267-270` reasons about
  context growing linearly with the number of reads; across turns it does not grow at
  all, because those reads are discarded.

Not affected: the `get_yaml_source` → `propose_yaml_edit` version handshake. The system
prompt (`AiChatPanel.tsx:155`) instructs the model to re-read immediately before
proposing, so it obtains a fresh token each turn regardless.

The fix is to hold the `ModelMessage[]` transcript in a ref across turns and append to it,
rather than reconstructing it from display segments — refreshing only the `system` message
each turn, since it embeds live runtime context. That also makes the pruning do what its
comment says. Roughly 30 lines. **Separate change, separate branch**, independent of this
migration.

---

## 5. Work items

### 5.1 Registry, dependencies, primitives

Add to `components.json`:

```json
"registries": { "@ai": "https://registry.ai-sdk.dev/{name}.json" }
```

New runtime dependencies: `streamdown`, `use-stick-to-bottom`, `shiki`, `nanoid`,
`motion` (the reference app carries all five for this component set — confirm each is
actually reached before adding it).

New shadcn primitives not yet in `src/components/ui/`: `badge`, `collapsible`,
`button-group`, `hover-card`, `scroll-area`, `command`, `avatar`, `textarea`. Add via the
shadcn MCP or CLI rather than hand-writing.

Two divergences from the reference app to handle on vendor:

- We use the unified `radix-ui` package (v1.6.7); bus-dev uses individual
  `@radix-ui/react-*`. Rewrite vendored imports to `radix-ui`.
- Our style is `radix-nova`, theirs is `new-york`. Request ours from the registry rather
  than copying their files.
- Our project is TSX (`"tsx": true`); theirs is JSX. The registry serves TS for us.

We do not need `remark-math` / `rehype-katex` / `katex`. The reference app renders
financial formulas; we render LCA tables. `message.jsx` imports them, so strip those
three imports on vendor.

### 5.2 Adapter

Extend `MessageSegment` to carry `toolCallId` and `input`, and map our segments to the
parts shape. `appendToolSegments` (`AiChatPanel.tsx:248`) currently discards `call.id` and
`call.function.arguments`, both in scope at `AiChatPanel.tsx:330`.

Map `error: boolean` to `state`: `output-error` when true, `output-available` otherwise.

### 5.3 Preserve the table export

`MarkdownTable` (`AiChatPanel.tsx:107-121`) gives CSV/TSV download on every rendered
table and is genuinely useful for an LCA tool. `message.jsx:314-321` passes `components`,
`remarkPlugins`, and `rehypePlugins` straight through to `Streamdown` — the same prop
surface `react-markdown` exposes — so it ports by dropping into that `components` map.

**Highest-risk item in the plan.** Verify it renders and that both download buttons fire
before going further.

### 5.4 CSS

`src/index.css` has 43 `ai-chat-*` rules. Under full adoption most of the message,
composer, tool, and welcome rules become dead; the sidebar shell, header, resize handle,
and `ai-chat-table` rules stay. Keep the panel's existing chrome — the bespoke look of
the sidebar itself is deliberate and is not part of this change.

### 5.5 Tests

**Screenshots are unaffected.** All 28 baselines in `tests/visual/__screenshots__/`
capture graph, Sankey, YAML, and results views. `toHaveScreenshot` appears exactly once
across the visual suite and no spec opens the assistant before capturing.

Assertions that must change:

`tests/responsive/ai-chat.responsive.spec.ts`

- `getByText("<name> · complete")` at lines 180, 189, 196, 206, 220, 233, 240, 250 →
  `ToolHeader` renders `type.split("-").slice(1).join("-")` plus a `Completed` / `Error`
  badge (`tool.jsx:60-80`).
- `.ai-chat-message-content p` (line 122) → the Streamdown output container.
- `[data-slot="message-scroller-viewport"]` (line 262) → the `Conversation` scroll
  container, since we are now replacing the scroller.
- `getByRole("textbox", { name: "Message", exact: true })` (lines 106, 118, 167, 186,
  203, 216, 230, 237, 247, 256) → `PromptInputTextarea` must keep an accessible name of
  exactly `Message`, or all ten update together. **Prefer keeping the name.**
- The send/stop button's `aria-label` (`Send message` / `Stop response`) is asserted
  indirectly; keep both labels.

`tests/visual/assistantEdit.visual.spec.ts`

- `.ai-chat-tool pre` (lines 120, 146) → the `ToolOutput` container.
- `getByRole("textbox", { name: "Message" })` (line 67) → same as above.

Untouched: `complementary` "PRISM assistant", `alertdialog` "Confirm assistant action",
`button` "Close AI assistant" / "Chat settings" / "Resize AI assistant".

---

## 6. Sequence

1. Add the `@ai` registry; add the eight shadcn primitives; add the runtime deps.
2. Vendor all ten components; rewrite Radix imports; strip KaTeX from `message`.
3. Extend the segment type and adapter.
4. Swap the render path: `Conversation` + `Message`/`MessageResponse` + `Tool` +
   `Loader` + `Suggestions`.
5. Port `MarkdownTable` into the Streamdown `components` map; verify CSV/TSV.
6. **Checkpoint — look at it before going further.**
7. Swap the composer for `PromptInput`, preserving the `Message` accessible name,
   Enter-to-send, and the stop button bound to `abortRef`.
8. Move the model picker to `ModelSelector` in the composer footer.
9. Update the assertions in §5.5.
10. Prune dead `ai-chat-*` CSS; drop `react-markdown`, and `message-scroller` +
    `@shadcn/react` if nothing else uses them.
11. Run `npm run build`, `npm run lint`, `npm run test:unit`, `npm run test:responsive`,
    `npm run test:visual` separately. Baseline: 93 unit, 53 responsive with 1 conditional
    skip, 47 visual, all exiting zero.

Steps 1-6 are the visible win. Step 7 is the largest single diff and is worth doing after
you have seen the messages render.

---

## 7. Open questions

- **Model picker: composer footer or settings dialog?** The reference app puts it in the
  composer. Moving it changes the `ai-chat-model-readout` button in our header
  (`AiChatPanel.tsx:376`) and the `Select` in settings (`AiChatPanel.tsx:424`).
- **Keep `MessageScroller` and `@shadcn/react`?** Nothing else imports them after this.
- **Should tool blocks default open on error?** The reference app does
  (`defaultOpen={part.state === 'output-error'}`, `ChatApp.jsx:888`); our `<details>` is
  always collapsed. Adopting it changes what `assistantEdit.visual.spec.ts:120,146`
  needs to click.
- **`MessageActions` (copy / regenerate)?** Free once `message` is vendored. Regenerate
  needs a loop entry point we do not currently expose.
