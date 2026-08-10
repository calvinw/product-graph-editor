# Agent Tooling

This repository keeps its required development workflow independent of any coding-agent product. Repository tests and shell commands are authoritative. Skills, MCP servers, React Grab, and interactive browser tools are accelerators.

## Required project setup

```bash
npm install
npx playwright install --with-deps chromium
npm run build
npm run lint
```

Run the existing visual suite with `npm run test:visual`. Compare its known failures with `plan/responsive-baseline.md`.

## Skills

The official shadcn skill is stored at `.agents/skills/shadcn` using the installer’s universal target. `skills-lock.json` records its source and version hash.

Restore or update repository-installed skills with the current `skills` CLI rather than copying them into individual agent directories:

```bash
npx skills experimental_install
npx skills update --project
```

The repository-specific UI skill lives at `.skillshare/skills/product-graph-editor/SKILL.md`. Synchronize it to the targets configured in `.skillshare/config.yaml` with:

```bash
sync-skills.sh
```

The generic shadcn skill explains the component system. The Product Graph Editor skill contains this application’s architecture, responsive, accessibility, and verification rules.

## Local MCP servers

Local MCP is optional. The repository records portable stdio definitions but does not commit configuration for a particular client or write to an agent’s home directory.

### shadcn

```json
{
  "command": "npx",
  "args": ["shadcn@latest", "mcp"]
}
```

Use it to search and inspect shadcn registries. Use `npx shadcn@latest search`, `view`, `docs`, and `add` when MCP is unavailable.

### Chrome DevTools

```json
{
  "command": "npx",
  "args": ["-y", "chrome-devtools-mcp@latest"]
}
```

Use it for live DOM, computed-style, console, network, screenshot, and performance inspection. Use standard Playwright tests, `page.evaluate`, screenshots, and traces when MCP is unavailable.

### Client setup policy

Translate the definitions above into the active MCP client’s supported project or user configuration. Do not treat a checked-in Codex, Claude, editor, or other client configuration as canonical.

Do not add these commands to `configs/mcp-servers.conf`. That file and the current `install-mcps.sh` support remote URL/HTTP/SSE servers, not local stdio processes.

After configuring a client locally:

1. restart or reload the client
2. confirm both servers initialize
3. ask shadcn MCP to list or search the default registry
4. ask Chrome DevTools MCP to inspect a harmless local page
5. remove or disable a failing local adapter without blocking repository tests

## React Grab

React Grab provides source context for a visually selected element. It must be development-only and absent from the production bundle. Install or refresh it with:

```bash
npx grab@latest init
```

Agents that cannot consume React Grab context should locate source through rendered text, accessible roles, class names, and repository search.

## Playwright

`@playwright/test` and repository-owned specs are required. The separate Playwright CLI is optional and agent-neutral:

```bash
npm install -g @playwright/cli
playwright-cli install --skills
```

An agent without Playwright CLI skills can use `playwright-cli --help`, normal Playwright specs, or a temporary diagnostic spec. Convert useful interactive findings into a committed test or audit entry.

Do not generate client-specific Playwright agents as part of the shared foundation. Contributors may run `npx playwright init-agents --loop=<supported-client>` locally when useful.
