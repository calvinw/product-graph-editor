#!/usr/bin/env bash
set -euo pipefail

# setup-local.sh — bring a plain local checkout to the same state the
# devcontainer produces, for Claude Code, OpenCode, and Codex.
#
# The devcontainer gets setup-env.sh and install-mcps.sh from the image at
# /usr/local/lib/ai-tools. Those do not exist on a local machine, so the MCP
# registration is reimplemented here for the three agents this repo uses.
# Everything is idempotent: re-run it after changing skills or
# configs/mcp-servers.conf.
#
#   ./scripts/setup-local.sh              full setup
#   ./scripts/setup-local.sh --skip-deps  skip npm ci and Playwright
#
# Skills come from .agents/skills, which is canonical. .skillshare is ignored,
# and any dangling links it left behind are pruned.

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
cd -- "$project_root"

skip_deps=0
for arg in "$@"; do
  case "$arg" in
    --skip-deps) skip_deps=1 ;;
    -h|--help) sed -n '3,20p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

warnings=()
step() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
note() { printf '    %s\n' "$1"; }
warn() { printf '    WARNING: %s\n' "$1" >&2; warnings+=("$1"); }
have() { command -v "$1" >/dev/null 2>&1; }

# ── Preflight ─────────────────────────────────────────────────────────────────
step "Checking prerequisites"
missing=()
for tool in node npm python3 git; do
  have "$tool" || missing+=("$tool")
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "    Required tools not found: ${missing[*]}" >&2
  echo "    Install them and re-run." >&2
  exit 1
fi
note "node $(node --version), npm $(npm --version), $(python3 --version)"

for agent in claude opencode codex; do
  if have "$agent"; then
    note "$agent: $(command -v "$agent")"
  else
    warn "$agent not found on PATH; its configuration will be skipped."
  fi
done

# ── Dependencies ──────────────────────────────────────────────────────────────
if [ "$skip_deps" -eq 0 ]; then
  step "Restoring locked project dependencies"
  npm ci

  step "Installing the Playwright Chromium runtime"
  # --with-deps installs Linux system packages through apt and is not
  # meaningful on macOS, where the browser bundle is self-contained.
  if [ "$(uname -s)" = "Linux" ]; then
    npx playwright install --with-deps chromium
  else
    npx playwright install chromium
  fi
else
  step "Skipping npm ci and Playwright (--skip-deps)"
fi

# ── Skills ────────────────────────────────────────────────────────────────────
step "Linking repository Agent Skills"
# .agents/skills is canonical. Claude Code needs compatibility symlinks; Codex
# and OpenCode read .agents/skills directly, so they get no per-agent copies.
scripts/setup-agent-skills.sh

# skillshare previously distributed skills into per-agent directories as links
# into .skillshare. That directory no longer holds them, so those links dangle
# and shadow the canonical skill of the same name. Prune only broken links that
# point at .skillshare; leave everything else alone.
pruned=0
for agent_dir in .claude/skills .opencode/skills .crush/skills .github/skills; do
  [ -d "$agent_dir" ] || continue
  for link_path in "$agent_dir"/*; do
    [ -L "$link_path" ] || continue
    [ -e "$link_path" ] && continue
    case "$(readlink "$link_path")" in
      *.skillshare/*)
        note "Pruning dangling skillshare link: $link_path"
        unlink "$link_path"
        pruned=$((pruned + 1))
        ;;
    esac
  done
done
[ "$pruned" -eq 0 ] && note "No dangling skillshare links found."

skill_count=$(find .agents/skills -maxdepth 2 -name SKILL.md | wc -l | tr -d ' ')
note "$skill_count skills available from .agents/skills"

# ── shadcn MCP (local, stdio) ────────────────────────────────────────────────
step "Registering the local shadcn MCP server"
if [ -x node_modules/.bin/shadcn ]; then
  scripts/setup-local-mcps.sh
else
  warn "node_modules/.bin/shadcn is missing; run without --skip-deps to install it."
fi

# ── Remote MCP servers ────────────────────────────────────────────────────────
step "Registering remote MCP servers from configs/mcp-servers.conf"
if [ ! -f configs/mcp-servers.conf ]; then
  warn "configs/mcp-servers.conf not found; no remote MCP servers registered."
else
  # Codex speaks streamable HTTP natively (codex-cli 0.149 registers
  # [mcp_servers.NAME] with a url field). It has no SSE transport, so only SSE
  # servers still need supergateway to bridge them.
  supergateway_bin="$(command -v supergateway || true)"
  if [ -z "$supergateway_bin" ] \
     && grep -vE '^[[:space:]]*(#|$)' configs/mcp-servers.conf | grep -qv '|http'; then
    warn "supergateway not found, and configs/mcp-servers.conf has SSE servers. Codex has no SSE transport, so those are skipped for Codex; install with 'npm i -g supergateway' and re-run. HTTP servers register natively and are unaffected, as are Claude and OpenCode."
  fi

  python3 - "$supergateway_bin" <<'PYTHON'
import json, os, re, shutil, subprocess, sys

bridge = sys.argv[1]
home = os.path.expanduser("~")

def parse(path):
    """name=url[|transport[|Header:$ENV_VAR ...]] — mirrors lib-mcp-parse.sh."""
    entries = []
    with open(path) as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            name, _, rest = line.partition("=")
            fields = rest.split("|")
            url = fields[0]
            transport = fields[1] if len(fields) > 1 and fields[1] else "sse"
            headers, skip = {}, False
            for field in fields[2:]:
                key, _, value = field.partition(":")
                for var in re.findall(r"\$([A-Za-z_][A-Za-z0-9_]*)", value):
                    resolved = os.environ.get(var)
                    if not resolved:
                        print(f"    WARNING: ${var} is unset - skipping MCP '{name}'", file=sys.stderr)
                        skip = True
                        break
                    value = value.replace(f"${var}", resolved)
                if skip:
                    break
                headers[key] = value
            if skip:
                continue
            entries.append({"name": name, "url": url, "transport": transport, "headers": headers})
    return entries

entries = parse("configs/mcp-servers.conf")
if not entries:
    print("    No MCP servers configured.")
    sys.exit(0)
print(f"    {len(entries)} server(s) configured: " + ", ".join(e["name"] for e in entries))

# ── Claude Code — user scope, through the CLI ────────────────────────────────
if shutil.which("claude"):
    for entry in entries:
        subprocess.run(["claude", "mcp", "remove", "-s", "user", entry["name"]],
                       capture_output=True)
        args = ["claude", "mcp", "add", "-s", "user", entry["name"],
                "--transport", entry["transport"], entry["url"]]
        for key, value in entry["headers"].items():
            args += ["--header", f"{key}: {value}"]
        result = subprocess.run(args, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"    WARNING: claude mcp add {entry['name']} failed: "
                  f"{result.stderr.strip()}", file=sys.stderr)
    print("    Claude: done")
else:
    print("    Claude: not found, skipping")

# ── OpenCode — ~/.config/opencode/opencode.json ──────────────────────────────
# The repository's own opencode.json already carries the local shadcn entry;
# remote servers are user-level so they follow you between projects.
config_path = os.path.join(home, ".config", "opencode", "opencode.json")
os.makedirs(os.path.dirname(config_path), exist_ok=True)
config = {}
if os.path.exists(config_path):
    try:
        with open(config_path) as handle:
            config = json.load(handle)
    except json.JSONDecodeError:
        print(f"    WARNING: {config_path} is not valid JSON; leaving it alone.", file=sys.stderr)
        config = None
if config is not None:
    servers = config.setdefault("mcp", {})
    for entry in entries:
        server = {"type": "remote", "url": entry["url"], "enabled": True}
        if entry["headers"]:
            server["oauth"] = False
            server["headers"] = entry["headers"]
        servers[entry["name"]] = server
    with open(config_path, "w") as handle:
        json.dump(config, handle, indent=2)
        handle.write("\n")
    print("    OpenCode: done")

# ── Codex — ~/.codex/config.toml, bridged by supergateway ────────────────────
if not shutil.which("codex"):
    print("    Codex: not found, skipping")
else:
    config_path = os.path.join(home, ".codex", "config.toml")
    os.makedirs(os.path.dirname(config_path), exist_ok=True)
    lines = []
    if os.path.exists(config_path):
        with open(config_path) as handle:
            lines = handle.readlines()
    names = {entry["name"] for entry in entries}
    kept, skipping = [], False
    for line in lines:
        match = re.match(r'^\[mcp_servers\.(?:"([^"]+)"|(\S+))\]', line)
        if match and (match.group(1) or match.group(2)) in names:
            skipping = True
            continue
        if skipping and line.startswith("["):
            skipping = False
        if not skipping:
            kept.append(line)
    content = "".join(kept).rstrip("\n")
    native, bridged, skipped = [], [], []
    for entry in entries:
        if entry["transport"] != "sse":
            # Native streamable HTTP: no bridge process involved.
            block = f'[mcp_servers.{entry["name"]}]\nurl = "{entry["url"]}"'
            if entry["headers"]:
                rendered = ", ".join(f'"{k}" = "{v}"' for k, v in entry["headers"].items())
                block += f"\nhttp_headers = {{ {rendered} }}"
            content = content.rstrip("\n") + "\n\n" + block + "\n"
            native.append(entry["name"])
        elif bridge:
            # Codex has no SSE transport; supergateway fronts it as stdio.
            args = ["--sse", entry["url"], "--logLevel", "none"]
            rendered = "[" + ", ".join(f'"{a}"' for a in args) + "]"
            content = (content.rstrip("\n") + f'\n\n[mcp_servers.{entry["name"]}]\n'
                       f'command = "{bridge}"\nargs = {rendered}\n')
            bridged.append(entry["name"])
        else:
            skipped.append(entry["name"])
    with open(config_path, "w") as handle:
        handle.write(content.lstrip("\n"))
    detail = []
    if native:
        detail.append(f"{len(native)} native ({', '.join(native)})")
    if bridged:
        detail.append(f"{len(bridged)} bridged ({', '.join(bridged)})")
    if skipped:
        detail.append(f"{len(skipped)} skipped, SSE without supergateway "
                      f"({', '.join(skipped)})")
    print("    Codex: " + ("; ".join(detail) if detail else "nothing to do"))
PYTHON
fi

# ── Summary ───────────────────────────────────────────────────────────────────
step "Summary"
if [ ${#warnings[@]} -eq 0 ]; then
  note "Local setup complete with no warnings."
else
  note "Local setup complete with ${#warnings[@]} warning(s):"
  for message in "${warnings[@]}"; do
    printf '      - %s\n' "$message"
  done
fi
note "Verify with: claude mcp list   |   codex mcp list   |   npx --no-install skills list"
