# Agent Tooling

This repository keeps its required development workflow independent of any coding-agent product. Repository tests and shell commands are authoritative. Skills, MCP servers, React Grab, and interactive browser tools are accelerators.

## Required project setup

```bash
npm ci
npx playwright install --with-deps chromium
npm run build
npm run lint
```

Run the existing visual suite with `npm run test:visual`. Compare its known failures with `plan/responsive-baseline.md`.

In the devcontainer, `scripts/post-create.sh` runs the dependency, skill, and browser setup sequentially. Required setup fails visibly; optional MCP registration reports a warning without blocking the application toolchain.

## Skills

`.agents/skills/` is the repository's single source of truth. Codex and OpenCode discover that directory directly. Claude Code uses symlinks in `.claude/skills/`, refreshed by:

```bash
scripts/setup-agent-skills.sh
```

The repository currently provides:

- `product-graph-editor-ui-development` — application-specific architecture and responsive QA
- `shadcn` — official component-system guidance
- `frontend-design` — visual design judgment
- `vercel-react-best-practices` — React architecture and performance guidance
- `web-design-guidelines` — accessibility and UX review

`skills-lock.json` records upstream sources and hashes. Update upstream skills with the project-installed CLI:

```bash
npx --no-install skills update --project --yes
scripts/setup-agent-skills.sh
```

Do not edit generated Claude links or create independent copies. The setup script removes obsolete compatibility links after a skill is renamed or deleted. Edit repository-owned skills in `.agents/skills/`; update externally sourced skills through the CLI.

## Local MCP servers

Local MCP is optional. `scripts/setup-local-mcps.sh` registers the repository's local shadcn server for Claude Code and Codex and keeps the OpenCode definition in `opencode.json`.

### shadcn

```json
{
  "command": "npx",
  "args": ["shadcn@latest", "mcp"]
}
```

Use it to search and inspect shadcn registries. Use `npx shadcn@latest search`, `view`, `docs`, and `add` when MCP is unavailable.

### Chrome DevTools

Chrome DevTools MCP is documented as a portable, manual integration; `scripts/setup-local-mcps.sh` does not register it automatically.

```json
{
  "command": "npx",
  "args": ["-y", "chrome-devtools-mcp@latest"]
}
```

Use it for live DOM, computed-style, console, network, screenshot, and performance inspection. Use standard Playwright tests, `page.evaluate`, screenshots, and traces when MCP is unavailable.

### Client setup policy

Use `scripts/setup-local-mcps.sh` to refresh the supported client registrations. The executable definition in that script is canonical; generated client state is not.

Do not add these commands to `configs/mcp-servers.conf`. That file and the current `install-mcps.sh` support remote URL/HTTP/SSE servers, not local stdio processes.

After configuring a client locally:

1. restart or reload the client
2. confirm each server you configured initializes
3. ask shadcn MCP to list or search the default registry
4. if configured, ask Chrome DevTools MCP to inspect a harmless local page
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
