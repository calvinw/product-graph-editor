#!/usr/bin/env bash
set -euo pipefail

# .agents/skills is the repository's canonical skill directory. Codex and
# OpenCode discover it directly; Claude Code requires compatibility symlinks.

canonical_dir=".agents/skills"
claude_dir=".claude/skills"

if [ ! -d "$canonical_dir" ]; then
  echo "Missing canonical skill directory: $canonical_dir" >&2
  exit 1
fi

mkdir -p "$claude_dir"

# Remove compatibility links created by this script when their canonical skill
# has since been renamed or deleted. Leave unrelated Claude skills untouched.
for link_path in "$claude_dir"/*; do
  [ -L "$link_path" ] || continue

  link_target="$(readlink "$link_path")"
  case "$link_target" in
    ../../.agents/skills/*)
      if [ ! -e "$link_path" ]; then
        echo "Removing stale Claude skill link: $link_path"
        unlink "$link_path"
      fi
      ;;
  esac
done

for skill_dir in "$canonical_dir"/*; do
  [ -d "$skill_dir" ] || continue
  [ -f "$skill_dir/SKILL.md" ] || continue

  skill_name="${skill_dir##*/}"
  link_path="$claude_dir/$skill_name"
  link_target="../../.agents/skills/$skill_name"

  if [ -e "$link_path" ] && [ ! -L "$link_path" ]; then
    echo "Refusing to replace non-symlink Claude skill: $link_path" >&2
    exit 1
  fi

  ln -sfn "$link_target" "$link_path"
done

npx --no-install skills list >/dev/null
echo "Agent skills ready: .agents/skills is canonical; Claude links refreshed."
