# AI Agentic Tools Dev Container Guide

This dev container is built from [calvinw/ai-agentic-tools](https://github.com/calvinw/ai-agentic-tools) and includes a comprehensive toolkit for AI-assisted development.

## Container Image

**Base:** Node.js 22-slim  
**Published to:** `ghcr.io/calvinw/ai-course-devcontainer:latest`  
**Rebuilt:** Automatically on Dockerfile changes, weekly via GitHub Actions

---

## System Tools & Utilities

The container includes essential CLI tools pre-installed:

### File & Process Tools
- `curl`, `wget` — HTTP clients
- `git` — Version control
- `vim` — Text editor
- `jq` — JSON processor
- `bat` — Syntax-highlighted cat
- `ripgrep` — Fast file search
- `fd-find` — User-friendly find alternative
- `tree` — Directory tree viewer
- `fzf` — Fuzzy finder
- `lsof`, `procps`, `iproute2` — Process/network inspection
- `make` — Build automation
- `bubblewrap` — Sandboxing utility

### Specialized Tools
- `glow` — Markdown renderer
- `gh` — GitHub CLI
- `upterm` — Terminal sharing
- `miller` — Data transformation tool
- `pspg` — PostgreSQL pager
- `poppler-utils` — PDF utilities

### Development Environment
- `python3` with `pip` and `venv`
- UTF-8 locale support
- `/workspace` as default working directory

---

## AI Coding Assistants

Pre-installed via npm:

- **Claude Code** — Anthropic's agentic coding tool (installed separately)
- **OpenCode** — Open source AI coding agent
- **GitHub Copilot** — GitHub's AI pair programmer
- **Crush** — Charm's beautifully themed terminal assistant
- **Google Gemini** — Google's AI coding assistant
- **OpenAI Codex** — OpenAI's code generation model
- **Alibaba Qwen Code** — Qwen's AI coding assistant
- **Supergateway** (v3.4.3) — MCP bridge for Codex integration

---

## Available Scripts

Inherited scripts are located in `/usr/local/lib/ai-tools/` and added to PATH. Repository-specific scripts live in `scripts/` and are invoked by path.

### Environment & Setup

**`setup-env.sh`**
- Generates Ed25519 SSH key pair at `~/.ssh/id_ed25519` (if not present)
- Appends `$HOME/.local/bin` to `~/.bashrc` for local package discovery
- Enables pip/pipx-installed tools to be discoverable in shell

**`install-mcps.sh`**
- Reads `configs/mcp-servers.conf` and registers Model Context Protocol servers
- Installs MCPs to all AI tools: Claude, OpenCode, Gemini, Crush, Copilot, Codex
- Safe to re-run; existing entries are replaced with current values
- Example: `install-mcps.sh` (runs automatically on container creation)

**`uninstall-mcps.sh`**
- Removes all MCP registrations listed in `configs/mcp-servers.conf`
- Cleans up MCP server entries from all tool configurations

### Skills Management

**`scripts/setup-agent-skills.sh`**
- Treats `.agents/skills/` as the repository's canonical skills directory
- Refreshes Claude Code compatibility links in `.claude/skills/`
- Removes stale compatibility links after skills are renamed or deleted
- Validates discovery with the project-installed `skills` CLI
- Runs automatically after `npm ci` during Codespace creation

Codex and OpenCode discover `.agents/skills/` directly. Do not create independent copies in agent-specific directories.

### Optional Add-ons

**`install-datascience.sh`**
- Installs Python data science ecosystem
- Includes: numpy, pandas, matplotlib, seaborn, requests
- Installs: Jupyter, Quarto, TinyTeX
- Optional; run only if needed: `install-datascience.sh`

**`install-dolt.sh`**
- Installs Dolt — a version-controlled SQL database
- Optional; run only if needed: `install-dolt.sh`

**`install_upterm.sh`**
- Installs Upterm for terminal sharing capabilities
- Already included in container; script available for updates

### Repository Synchronization

**`sync-from-upstream.sh`**
- Synchronizes changes from the upstream ai-agentic-tools repository
- Used for keeping container definition in sync with source

**`lib-mcp-parse.sh`**
- Library script for parsing MCP configuration files
- Sourced by other scripts; not meant to be run directly

---

## Configuration Files

### `configs/mcp-servers.conf`
Defines which Model Context Protocol servers to install. Format:
```
# SSE MCP (no authentication):
dolt=https://bus-mgmt-databases.mcp.mathplosion.com/mcp-dolt-database/sse

# HTTP MCP with authentication:
# stitch=https://stitch.googleapis.com/mcp|http|X-Goog-Api-Key:$STITCH_API_KEY
```

Run `install-mcps.sh` after editing to register changes.

### `.agents/skills/`
Project-level Agent Skills directory and single source of truth.
- Edit repository-owned skills here
- Update third-party skills with `npx --no-install skills update --project --yes`
- Run `scripts/setup-agent-skills.sh` after adding or renaming a skill
- Do not edit `.claude/skills/` symlinks directly

### `opencode.json`
Project-level OpenCode configuration (project root, highest precedence).
- Sets default model and provider settings
- Example: Configures Deepseek V4 Flash via OpenRouter
- Overrides `~/.config/opencode/opencode.json` and `.opencode/` configs

### `.devcontainer/devcontainer.json`
Dev container configuration.
- References container image: `ghcr.io/calvinw/ai-course-devcontainer:latest`
- Runs `scripts/post-create.sh` for sequential environment, dependency, Agent Skill, browser, and optional MCP setup
- Declares secrets for GitHub Codespaces: `STITCH_API_KEY`

---

## Typical Workflow

1. **First container creation** — Runs automatically:
   - `setup-env.sh` — SSH key + PATH setup
   - `npm ci` — Restore locked project dependencies and the `skills` CLI
   - `scripts/setup-agent-skills.sh` — Link and validate repository Agent Skills
   - `npx playwright install --with-deps chromium` — Install the browser test runtime
   - `install-mcps.sh` — Optionally register MCPs from `configs/mcp-servers.conf`
   - `scripts/setup-local-mcps.sh` — Register repository-local MCP servers

   Required setup is fail-fast. MCP registration is optional and reports warnings without blocking the application toolchain.

2. **Adding new MCPs** — Edit `configs/mcp-servers.conf`, then:
   ```
   # install-mcps.sh
   ```

3. **Creating/modifying repository skills** — Edit files in `.agents/skills/`, then:
   ```
   # scripts/setup-agent-skills.sh
   ```

4. **Installing additional upstream skills**:
   ```
   # npx --no-install skills add owner/repository --skill skill-name \
       --agent codex --agent claude-code --agent opencode --yes
   # scripts/setup-agent-skills.sh
   ```

5. **Adding optional tools**:
   ```
   # install-datascience.sh
   # install-dolt.sh
   ```

---

## Responsive UI Development

Use `.agents/skills/product-graph-editor-ui-development/SKILL.md` for application UI work. Before modifying a responsive surface, read `plan/responsive-ui-plan.md`, `plan/responsive-audit.md`, and `plan/responsive-baseline.md`.

Preserve the React, Vite, Tailwind CSS 4, shadcn/ui, Radix, and XYFlow architecture. Keep graph and LCA behavior intact, retain semantic result tables, inspect existing `src/components/ui/` primitives before adding components, and avoid unrelated refactors.

Test the affected workflow—not only the initial page render—at:

- 375 × 812 — phone
- 768 × 1024 — tablet portrait
- 1440 × 900 — desktop

At narrow widths, prioritize graph and Sankey viewport space; keep navigation, settings, and inspectors reachable; contain table scrolling; prevent document-level horizontal overflow; keep overlays within the viewport; and preserve focus, keyboard interaction, and usable touch targets.

Run each verification command separately:

```bash
npm run build
npm run lint
npm run test:unit
npm run test:responsive
npm run test:visual
```

Expected baseline results are 21 unit tests passed, 53 responsive tests passed with 1 deliberate viewport-conditional skip (the assistant split-pane test does not apply at phone width), and 31 visual tests passed with no failures. All three suites exit zero. The three formerly accepted visual failures (issues #37, #38, #39) are fixed and closed, so there is no accepted-failure allowance: a failing visual test is a regression. Never update screenshot baselines without visually reviewing the actual, expected, and diff images.

---

## Starting Agents

All launcher scripts live in `permissions/` (baked into container image):

- `claude.sh` — Runs Claude Code with sandbox mode
- `opencode.sh` — Runs OpenCode with allow-all permissions
- `copilot.sh` — Runs GitHub Copilot with allow-all
- `crush.sh` — Runs Crush with yolo mode
- `codex.sh` — Runs OpenAI Codex
- `gemini.sh` — Runs Google Gemini

---

## Environment Variables

**For authentication in Codespaces:**
- `STITCH_API_KEY` — Stitch MCP authentication

Declare these in `.devcontainer/devcontainer.json` under `"secrets"` and add values in GitHub Codespaces settings.

---

## Source Repository

All tools, scripts, and Dockerfile: [calvinw/ai-agentic-tools](https://github.com/calvinw/ai-agentic-tools)

Container rebuilt automatically on changes to:
- Dockerfile
- Scripts in `scripts/` directory
- Weekly via GitHub Actions
