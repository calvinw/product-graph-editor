#!/usr/bin/env bash
set -euo pipefail

# setup-local.sh — set up a local clone of this repository for command-line
# agent work with Claude Code, OpenCode, and Codex.
#
# For developers working from a normal clone. If you are in the devcontainer or
# a Codespace, scripts/post-create.sh already did all of this; do not run this.
#
# Self-contained on purpose: it calls no other repository script and reads no
# configuration file, so it keeps working if the container tooling changes.
#
#   ./scripts/setup-local.sh              full setup
#   ./scripts/setup-local.sh --skip-deps  never touch node_modules
#   ./scripts/setup-local.sh --help
#
# What it does:
#   1. checks prerequisites and reports which agents it found
#   2. installs dependencies if they are stale, then Playwright's Chromium
#   3. makes .agents/skills discoverable by all three agents
#   4. registers the local shadcn MCP server
#
# Safe to re-run at any time. Nothing outside this repository is modified
# except the per-agent MCP registrations in step 4.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
cd -- "$project_root"

skip_deps=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) skip_deps=1 ;;
    -h|--help) awk 'NR>3 && /^#/ { sub(/^# ?/, ""); print; next } NR>3 { exit }' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

# Plain strings rather than bash arrays: macOS still ships bash 3.2, where
# referencing an empty array under `set -u` is an error.
warn_count=0
warn_log=""

step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
note() { printf '     %s\n' "$1"; }
warn() {
  printf '     WARNING: %s\n' "$1" >&2
  warn_count=$((warn_count + 1))
  warn_log="${warn_log}       - ${1}"$'\n'
}
have() { command -v "$1" >/dev/null 2>&1; }

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
step "Checking prerequisites"

missing=""
for tool in node npm git; do
  have "$tool" || missing="$missing $tool"
done
if [ -n "$missing" ]; then
  echo "     Required tools not found:$missing" >&2
  echo "     Install them and re-run." >&2
  exit 1
fi
note "node $(node --version), npm v$(npm --version)"

if [ ! -f package-lock.json ]; then
  echo "     package-lock.json not found. Run this from a clone of the repository." >&2
  exit 1
fi

agents_found=0
for agent in claude opencode codex; do
  if have "$agent"; then
    note "$agent: $(command -v "$agent")"
    agents_found=$((agents_found + 1))
  else
    note "$agent: not installed, will be skipped"
  fi
done
if [ "$agents_found" -eq 0 ]; then
  warn "None of claude, opencode, or codex are on PATH. Skills and dependencies will still be set up, but no agent will be configured."
fi

# ── 2. Dependencies ──────────────────────────────────────────────────────────
if [ "$skip_deps" -eq 1 ]; then
  step "Skipping dependencies and Playwright (--skip-deps)"
else
  step "Checking project dependencies"

  # npm ci deletes node_modules and reinstalls from scratch, so only run it
  # when something is actually stale. These are the same four checks
  # start_server.sh makes, so the two agree about when a reinstall is needed.
  deps_stale=0
  if [ ! -d node_modules ]; then
    deps_stale=1
  elif [ ! -f node_modules/.package-lock.json ] \
    || [ package.json -nt node_modules/.package-lock.json ] \
    || [ package-lock.json -nt node_modules/.package-lock.json ]; then
    deps_stale=1
  elif ! npm ls --depth=0 >/dev/null 2>&1; then
    deps_stale=1
  elif ! node --input-type=module -e "await import('vite')" >/dev/null 2>&1; then
    # npm can report a healthy top-level tree while a nested optional
    # dependency, such as Rollup's platform binary, is missing.
    deps_stale=1
  fi

  if [ "$deps_stale" -eq 1 ]; then
    note "dependencies are stale, running npm ci"
    npm ci
  else
    note "dependencies are current, nothing to install"
  fi

  step "Installing the Playwright Chromium runtime"
  # --with-deps installs Linux system packages through apt. On macOS the
  # browser bundle is self-contained and the flag would fail.
  if [ "$(uname -s)" = "Linux" ]; then
    npx playwright install --with-deps chromium
  else
    npx playwright install chromium
  fi
fi

# ── 3. Agent skills ──────────────────────────────────────────────────────────
step "Making .agents/skills discoverable"

# .agents/skills holds the real skill directories and is the single source of
# truth. Codex and OpenCode read it directly. Claude Code looks in
# .claude/skills, so that directory gets a symlink per skill.
if [ ! -d .agents/skills ]; then
  echo "     .agents/skills is missing. This does not look like a full clone." >&2
  exit 1
fi

mkdir -p .claude/skills

# Remove links this script previously created whose skill has since been
# renamed or deleted, and links left behind by the older skillshare tooling
# that point into .skillshare. Both kinds are broken and would otherwise
# shadow a real skill of the same name. Anything else is left alone.
pruned=0
for agent_dir in .claude/skills .opencode/skills .crush/skills .github/skills; do
  [ -d "$agent_dir" ] || continue
  for link_path in "$agent_dir"/*; do
    [ -L "$link_path" ] || continue
    [ -e "$link_path" ] && continue
    case "$(readlink "$link_path")" in
      *.agents/skills/*|*.skillshare/*)
        note "pruning broken link: $link_path"
        unlink "$link_path"
        pruned=$((pruned + 1))
        ;;
    esac
  done
done
[ "$pruned" -eq 0 ] && note "no broken skill links to prune"

linked=0
for skill_dir in .agents/skills/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue

  skill_name="${skill_dir##*/}"
  link_path=".claude/skills/$skill_name"

  if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then
    warn "$link_path exists and is not a symlink; leaving it untouched."
    continue
  fi

  ln -sfn "../../.agents/skills/$skill_name" "$link_path"
  linked=$((linked + 1))
done

note "$linked skills linked into .claude/skills"
note "codex and opencode read .agents/skills directly; no copies made"

# ── 4. shadcn MCP server ─────────────────────────────────────────────────────
step "Registering the shadcn MCP server"

# shadcn is a project dependency, so the MCP server is started on demand out of
# node_modules rather than running as a daemon.
shadcn_bin="$project_root/node_modules/.bin/shadcn"

if [ ! -x "$shadcn_bin" ]; then
  warn "node_modules/.bin/shadcn is missing. Re-run without --skip-deps to install it, then run this script again."
else
  if have claude; then
    # Local scope is stored outside the repository but keyed to this project
    # path, so it needs no approval prompt the way a shared .mcp.json would.
    claude mcp remove --scope local shadcn >/dev/null 2>&1 || true
    if claude mcp add --scope local shadcn -- npx --no-install shadcn mcp >/dev/null 2>&1; then
      note "claude: registered (local scope, this project only)"
    else
      warn "claude mcp add shadcn failed."
    fi
  fi

  if have codex; then
    # Codex can start an MCP process before adopting the project as its working
    # directory, so give it the absolute path rather than relying on cwd.
    codex mcp remove shadcn >/dev/null 2>&1 || true
    if codex mcp add shadcn -- "$shadcn_bin" mcp >/dev/null 2>&1; then
      note "codex: registered (global, absolute path)"
    else
      warn "codex mcp add shadcn failed."
    fi
  fi

  if have opencode; then
    if grep -q '"shadcn"' opencode.json 2>/dev/null; then
      note "opencode: already configured by the repository's opencode.json"
    else
      warn "opencode.json has no shadcn entry; expected it to be committed in this repository."
    fi
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
step "Done"
if [ "$warn_count" -eq 0 ]; then
  note "Local setup complete."
else
  note "Local setup complete with $warn_count warning(s):"
  printf '%s' "$warn_log"
fi
note ""
note "Verify:"
note "  npx --no-install skills list     skills the agents can see"
note "  claude mcp list                  claude's MCP servers"
note "  codex mcp list                   codex's MCP servers"
note ""
note "Run the app with: ./start_server.sh"
