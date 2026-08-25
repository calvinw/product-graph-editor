# Plan: remote MCP tools in the assistant

Give the in-app assistant the same capability the FIT Retail Index chat app has:
connect to a remote MCP server from the browser, list its tools, and let the model
call them alongside our own registered tools.

Status: proposal, not started. Written for review.

---

## 1. What the reference app actually does

Studied `calvinw/llm-chat-bus-dev` at HEAD. Four pieces:

**`src/utils/mcpClient.jsx`** (492 lines) — a hand-rolled JSON-RPC 2.0 client over two
transports:

- *Streamable HTTP*: every message is a `POST` to the server URL. The server may answer
  with `application/json` or with a one-shot `text/event-stream` body. Session identity
  arrives in the `Mcp-Session-Id` response header and is echoed back on later requests.
- *SSE legacy*: `GET` the URL, hold the stream open, wait for an `event: endpoint` frame
  carrying a message endpoint URL; from then on requests are `POST`ed to that endpoint
  and responses arrive back on the held stream, matched by JSON-RPC id.

`detectTransport()` picks between them: a URL ending in `/sse` is assumed legacy without
probing; otherwise it tries a `ping` POST, then probes `/sse` variants, then falls back.
`connect()` runs `initialize` → `notifications/initialized` → `tools/list` and maps each
MCP tool's `inputSchema` into the OpenAI function-tool shape, tagged `_mcpTool: true`.
`callTool()` sends `tools/call` and flattens the returned content array to a string.

**`src/utils/httpClient.jsx`** — `buildMCPHeaders`, POST/GET wrappers, SSE body parsing.

**`src/hooks/useMCPManager.jsx`** — one server URL persisted at `mcp_server_url`,
debounced 1s reconnect whenever it changes, exposes `{status, tools, handlers, client}`,
plus an optional corsproxy.io escape hatch.

**`src/ChatApp.jsx`** — the whole integration is two lines:

```js
const mergedTools        = [...localTools, ...mcpTools];
const mergedToolHandlers = { ...toolHandlers, ...mcpToolHandlers };
```

…plus a settings field for the URL and a status badge listing the loaded tool names.

---

## 2. What we already have

`src/ai/viewTools.ts` (799 lines) exports `appToolDefinitions` — 31 tools in exactly the
same OpenAI function shape the reference uses — and `executeAppTool(call, runtime)` as a
single dispatcher. `src/components/AiChatPanel.tsx` runs the loop: up to 8 rounds of
`transport.stream({ tools: appToolDefinitions })`, then for each returned call either
executes directly or routes through `confirmedToolNames` → `requestToolConfirmation` →
staleness re-check → execute. `src/ai/chatTransport.ts` handles OpenRouter streaming.

So our tool loop is structurally the same as the reference's; the merge point is
`appToolDefinitions` (one array) and `executeAppTool` (one dispatcher). Both are single
call sites in `AiChatPanel.tsx` (lines 275 and 299/303).

`AiChatPanel` stays mounted when the panel is closed (it renders `null` into the portal),
so a connection can live in a hook there and survive open/close without reconnecting.

Note: `configs/mcp-servers.conf` already registers `lca=https://lca.mathplosion.com/mcp`
and `stitch=...`, but that file configures the **dev container's agents**, not the app.
It shares nothing with this work beyond the URL being a sensible default.

---

## 3. Finding that shapes the whole plan: CORS

I probed both servers before writing this, because browser MCP lives or dies on CORS.

**`https://lca.mathplosion.com/mcp` — blocked from the browser today.**

```
POST /mcp  (initialize)          → 200, mcp-session-id: 819cc5a6…
                                   access-control-allow-origin: http://localhost:5173
                                   ✗ no access-control-expose-headers
POST /mcp  (tools/list, no sid)  → -32600 "Bad Request: Missing session ID"
OPTIONS /mcp  w/ mcp-session-id  → 400 "Disallowed CORS headers"
                                   allow-headers: Accept, Accept-Language,
                                                  Content-Language, Content-Type
```

Three facts that compose into a hard block: the session id is required on every call
after `initialize`; JS cannot *read* it because `Access-Control-Expose-Headers` is absent;
and JS cannot *send* it because the preflight rejects `mcp-session-id`. There is no `/sse`
endpoint on that host (both `/sse` and `/mcp/sse` return 404).

**`https://bus-mgmt-databases.mcp.mathplosion.com/…/sse` — works from the browser.**

```
GET …/sse → 200 text/event-stream, access-control-allow-origin: *
            event: endpoint
            data: /mcp-dolt-database/messages/?session_id=f6ddb78c…
```

It works precisely because the session travels **in the URL query string**, so no custom
request header is ever needed and no preflight is triggered. That is why the reference app
defaults to an SSE endpoint. It is not a stylistic choice; it is the only shape that
currently works cross-origin against this fleet.

Consequences for us:

- Building the client is safe — the SSE-legacy path is proven to work in a browser today.
- Wiring the LCA server to the app requires a server-side change, not an app change. See
  section 3a: the fix is four lines in `calvinw/life-cycle-assessment-mcp`, written and
  verified.
- Local development needs nothing from anyone. `vite.config.ts` already proxies
  `/lca-api` → `https://lca.mathplosion.com`; adding a `/lca-mcp` → `…/mcp` entry makes the
  request same-origin, so CORS does not apply at all in `npm run dev`. Only the deployed
  GitHub Pages build depends on the server change.

### 3a. The engine-side fix

The relevant repo is `calvinw/life-cycle-assessment-mcp`, and the whole of the CORS policy
lives in one place — `sse_server.py`, lines 21–32:

```python
allow_methods=["GET", "POST", "OPTIONS"],
allow_headers=["Content-Type"],
```

That FastAPI `CORSMiddleware` config reproduces the live server's responses exactly
(`Access-Control-Allow-Headers: Accept, Accept-Language, Content-Language, Content-Type`
is what `allow_headers=["Content-Type"]` unions with the CORS safelist), so it is
definitively the live configuration. The change:

```python
allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
allow_headers=["Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version"],
expose_headers=["Mcp-Session-Id"],
```

- `expose_headers` lets JavaScript *read* the session id `initialize` returns.
- `allow_headers` lets the preflight pass so it can be *sent* back on every later request.
  Both are required; either alone still leaves the browser stuck after `initialize`.
- `Mcp-Protocol-Version` is sent by clients on MCP spec 2025-06-18 and later. Including it
  now avoids a second round-trip fix once a client negotiates a newer protocol version.
- `DELETE` is how a client terminates a session; without it a closed tab leaves the session
  to expire on its own.

Nothing here affects non-browser clients — Claude Code, Gemini, and the other agents reading
`configs/mcp-servers.conf` never send an `Origin` header, so CORS middleware does not apply
to them. The change is additive and cannot break an existing consumer.

Verified by extracting the config from the source with `ast` and exercising it against a stub
Starlette app: the current config fails all four browser checks with the same
`400 Disallowed CORS headers` the live server returns, and passes all four after the change,
with the "unapproved origin is refused" guarantee unchanged in both. Two matching tests were
added to the repo's existing `tests/test_cors.py`.

The change is written but has not been sent anywhere — it sits uncommitted in a throwaway clone,
and Elena has read-only access to that repo, so it lands as a PR from a fork rather than a direct
push. See decisions 8.1 and 8.2, which are what that PR is waiting on.

---

## 4. Design decisions

**Port the reference client to TypeScript rather than adding `@modelcontextprotocol/sdk`.**
The official SDK is browser-capable and would be the right call if we were writing a
general client, but the reference's ~300 usable lines are already proven against exactly
these servers including their quirks, and our `src/lib/*` convention is small dependency-free
modules with unit tests. Porting keeps `package.json` lean and keeps the failure modes ones
we can read. Trade-off accepted: we own protocol correctness, and we skip SDK features we
do not need (resources, prompts, sampling, resumability).

**Prefix remote tool names.** Our 31 tools and a server's tools share one flat namespace,
and a collision would silently shadow something like `get_yaml_source`. Register remote
tools as `mcp__<server>__<tool>`, matching the Claude Code convention, and strip the prefix
before `tools/call`. Local tools always win a tie by construction, since the prefix makes
ties impossible.

**Confirm remote calls unless the tool declares itself read-only.** Our existing gate is a
static `confirmedToolNames` set, which cannot know anything about tools discovered at
runtime. MCP tools may carry `annotations.readOnlyHint`; honour it, and require confirmation
for everything else. Replace the `confirmedToolNames.has(name)` test in `AiChatPanel.tsx:289`
with a `requiresConfirmation(name, registry)` helper so both tool families share one path.

**Cap remote tool output.** A `tools/call` against a SQL server can return megabytes, and
every tool result is pushed into the transcript verbatim (`AiChatPanel.tsx:310`). We already
prune repeated `get_yaml_source` reads for exactly this reason. Truncate remote results to a
fixed budget (~8 KB) with an explicit `truncated: true` marker so the model knows to narrow
its query rather than assuming it saw everything.

**No third-party CORS proxy.** The reference offers corsproxy.io. Routing MCP traffic —
including any auth header — through an unrelated host is a real disclosure, and the two
legitimate fixes (server-side CORS headers, or a dev-only Vite proxy) are both better. Show
a clear diagnostic instead: "the server did not allow browser requests."

**MCP settings live in the chat settings dialog,** not the global settings popover. It only
affects the assistant, and the reference puts it in the same place.

---

## 5. Files

New:

| File | Contents |
| --- | --- |
| `src/ai/mcpClient.ts` | `McpClient` class: transport detection, both transports, `connect()`, `listTools()`, `callTool()`, `disconnect()`. Port of the reference, typed, no `console.log` noise. |
| `src/ai/mcpRegistry.ts` | Pure functions: name prefix/unprefix, merging remote definitions into `appToolDefinitions`, `requiresConfirmation`, result flattening and truncation. |
| `src/hooks/useMcpServers.ts` | Connection lifecycle, localStorage persistence, debounced reconnect, `{status, error, tools, callTool}`. |
| `src/ai/mcpClient.test.ts` | Vitest against a stubbed `fetch`. |
| `src/ai/mcpRegistry.test.ts` | Vitest, pure. |

Edited:

- `src/components/AiChatPanel.tsx` — merge definitions at the `tools:` argument (line 275);
  route unknown-but-registered names to the MCP dispatcher next to `executeAppTool`
  (lines 299/303); swap the confirmation predicate (line 289); add the settings section.
- `src/index.css` — one small block for the settings rows and status badge.
- `configs/mcp-servers.conf` — a comment noting the app now has its own, separate MCP
  configuration, so nobody assumes editing this file changes app behaviour.

Untouched: `src/ai/viewTools.ts` keeps its current shape; the registry composes with it
rather than modifying it.

---

## 6. Phases

**Phase 1 — client and registry, no UI.** Write `mcpClient.ts` and `mcpRegistry.ts` with
their tests. Verify end-to-end from a scratch script against the Dolt SSE server (proven
reachable above): connect, list tools, call one, print the result. Nothing in the app
changes yet, so this phase cannot regress anything.

**Phase 2 — connection lifecycle and settings UI.** `useMcpServers.ts` plus a "Remote tools"
section in the chat settings dialog: URL field, status badge (`idle / connecting / connected
/ error`), the error text when there is one, the discovered tool count and names, and a
reconnect button. Tools are discovered and displayed but not yet offered to the model, so
the assistant's behaviour is still unchanged.

**Phase 3 — wire into the tool loop.** Merge definitions into the `tools:` argument, dispatch
prefixed calls to the client, apply the confirmation policy and the output cap. This is where
behaviour changes and where the manual smoke test matters.

Phase 1 and 2 are each independently committable and inert. Phase 3 is the one that needs
real review.

---

## 7. Verification

Per phase: `npm run build`, `npm run lint`, `npm test` (vitest). Phase 3 additionally
`npm run test:responsive` and `npm run test:visual`, compared against
`plan/responsive-baseline.md` — 24 responsive passing, 29 visual with the 3 accepted
failures unchanged.

Manual, Phase 3, at 375×812 / 768×1024 / 1440×900:

1. Blank URL → no remote tools, assistant behaves exactly as today.
2. Bad URL → status shows `error` with a readable message, assistant still works.
3. Dolt SSE URL → tools listed in settings; ask the assistant something that needs one;
   confirm the confirmation dialog appears for a non-read-only tool and that rejecting it
   returns a clean rejection to the model rather than an exception.
4. Disconnect mid-conversation (clear the URL) and confirm the next round degrades to local
   tools rather than throwing.
5. A deliberately large result → confirm truncation marker, and that the transcript stays
   navigable.

The settings section needs a Playwright responsive assertion only if it introduces new
overflow; the dialog is an existing, already-covered surface.

---

## 8. Open decisions

### Blocking — the engine PR is written and waiting on these two

**8.1 — Open the PR against `calvinw/life-cycle-assessment-mcp`?**

The change from section 3a is made and verified, but it is sitting uncommitted in a throwaway
clone at `/tmp/lca-mcp`. It has not been forked, pushed, committed, or sent anywhere.

Elena has `READ` permission on that repo (checked via `gh repo view --json viewerPermission`),
so landing it means forking to her account, pushing a branch, and opening a PR against `main`.
That is outward-facing and public, so it needs an explicit yes.

The PR would contain exactly two files:

- `sse_server.py` — the four-line CORS change plus the comment explaining why the header is
  needed in both directions.
- `tests/test_cors.py` — two added tests, one per direction, following the existing file's
  patterns.

Caveat to state in the PR body: the repo's own suite could not be run here. `tests/test_cors.py`
imports `sse_server` → `lca_server` → `lca_core`, which pulls in brightway25 and scipy, and this
machine has no `uv`. The config itself was verified independently (section 3a), but the two new
tests have not been executed against the real app object and should be run once by someone with
the environment.

Timing: sending it alongside Phase 1 means it is merged and redeployed by the time Phase 3
needs it. Merging is only half of it — the server also has to be redeployed via
`scripts/deploy_lca_server.sh` before the deployed editor sees any change.

**8.2 — Which origin should be allowed?**

`allow_origins` in `sse_server.py` currently lists `https://calvinw.github.io` and
`http://localhost:5173`. Our `.github/workflows/deploy.yml` publishes to GitHub Pages for
whichever account owns the repo, so:

- Deploying under **calvinw** → the existing entry already covers it, nothing to add.
- Deploying under **your account** → the deployed app's origin is a different `*.github.io`
  and needs its own entry, which should go into the same PR rather than a follow-up.

Tell me which, and I will size the PR accordingly. This does not affect local development
either way — the Vite proxy in 8.3 makes dev same-origin.

### Non-blocking — decide before the phase that needs them

**8.3 — Add the `/lca-mcp` Vite proxy?** Recommended regardless of 8.1, and independent of it.
Five lines in `vite.config.ts` alongside the existing `/lca-api` entry; makes `npm run dev`
same-origin so CORS never applies locally. Needed before Phase 3's manual testing.

**8.4 — One server or a list?** The reference supports one. I would ship a list from the start —
the data shape is `{id, url, enabled}[]` either way, one client per entry, and we already have
two endpoints that plausibly matter (LCA, Dolt). Going single-server now means a refactor later
rather than a new row. Costs maybe 30 extra lines. Needed before Phase 2.

**8.5 — Default URL.** Seed the Dolt SSE endpoint (works today, demonstrable immediately), seed
the LCA endpoint (relevant to this app, but browser-blocked until 8.1 lands), or ship blank. I
lean blank with both offered as one-click presets, so nothing connects to a third party without
an explicit act. Needed before Phase 2.

**8.6 — Custom auth headers in v1?** `configs/mcp-servers.conf` supports `X-Goog-Api-Key:$VAR`,
but a browser has no env vars — a key would sit in localStorage next to the OpenRouter key, and
any custom header forces a preflight that these servers currently reject. I would defer it until
a server needs it.

**8.7 — Confirmation default if a server omits `readOnlyHint`.** My proposal confirms. The
alternative — a per-server "trust this server" toggle — is friendlier but is a security decision
I would rather you make explicitly than have me pick. Needed before Phase 3.

---

## 9. Risks

- **CORS.** Was the main risk; section 3a retires most of it. The residual risk is scheduling:
  the deployed GitHub Pages build stays unable to reach the LCA server until that PR is merged
  *and* the server is redeployed (`scripts/deploy_lca_server.sh`). Local development is
  unaffected once the Vite proxy is in (decision 8.3). The deployed origin has to be on the
  server's allow-list too — decision 8.2.
- **Prompt size.** 31 local tools plus an unknown number of remote ones all ship in every
  request. A server exposing 40 tools would roughly double our tool payload on every round.
  If that bites, the fix is a per-server tool allowlist in settings — noted, not planned.
- **Transport auto-detection is guesswork.** The reference's `detectTransport` probes and
  falls back through several shapes and is the least predictable part of the port. Let the
  settings UI expose an explicit transport override (`auto / http / sse`) so a
  misdetection is a dropdown away from being fixed rather than a bug report.
