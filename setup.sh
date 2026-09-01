#!/usr/bin/env bash
#
# setup.sh — one-command GLOBAL install of the provision-sitecore-ai-component
# skill and its guardrails.
#
# Per tool, three steps (all idempotent, all printed as they land):
#
#   1. Link skills/provision-sitecore-ai-component into the tool's user-level
#      skills directory, so the skill is available in every project (a native
#      directory junction on Windows, a symbolic link elsewhere):
#
#        Claude Code -> ~/.claude/skills/provision-sitecore-ai-component
#        Codex       -> ~/.codex/skills/provision-sitecore-ai-component
#        Cursor      -> ~/.cursor/skills/provision-sitecore-ai-component
#
#   2. Claude Code + Codex only: register the PreToolUse guard
#      (scripts/hooks/pretooluse-guard.cjs) in the tool's user hook config
#      (~/.claude/settings.json / ~/.codex/hooks.json) via
#      scripts/hooks/install.cjs. Cursor has no hook surface — its guardrails
#      remain the prose in SKILL.md.
#
#   3. Offer a one-time credential bootstrap for the Authoring API: writes
#      ~/.config/provision-sitecore-ai-component/.env (chmod 600, values never
#      echoed). Skippable; exported env vars and a per-repo ./.env override it
#      (see skills/provision-sitecore-ai-component/references/authoring-api.md).
#
# Usage (from anywhere; the script resolves its own repo location):
#
#   bash setup.sh [claude] [codex] [cursor] [--uninstall]
#
# With no tool args, wires every tool whose config dir already exists
# (~/.claude / ~/.codex / ~/.cursor). Re-running is safe: skill links and hook
# entries are updated in place. An ordinary file or directory already sitting
# where the link belongs aborts rather than being overwritten. --uninstall
# removes only links and hook entries that belong to this skill; the credential
# file is kept (path printed).
#
# The skill drives this clone's CLI and guard — keep the clone where you ran
# setup from (git pull updates everyone's copy).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd -P)"
SKILL_NAME="provision-sitecore-ai-component"
SKILL_SRC="$REPO_ROOT/skills/$SKILL_NAME"
CRED_DIR="$HOME/.config/provision-sitecore-ai-component"
CRED_FILE="$CRED_DIR/.env"

[ -f "$SKILL_SRC/SKILL.md" ] || { echo "error: $SKILL_SRC/SKILL.md not found (run from a full clone)" >&2; exit 1; }

UNINSTALL=0
TOOLS=()
CODEX_SELECTED=0
for a in "$@"; do
  case "$a" in
    --uninstall) UNINSTALL=1 ;;
    claude|codex|cursor) TOOLS+=("$a") ;;
    -*) echo "error: unknown flag \"$a\" (expected: --uninstall)" >&2; exit 2 ;;
    *) echo "error: unknown tool \"$a\" (expected: claude | codex | cursor)" >&2; exit 2 ;;
  esac
done

# No explicit tools: auto-detect installed tools by their user config dir.
if [ "${#TOOLS[@]}" -eq 0 ]; then
  [ -d "$HOME/.claude" ] && TOOLS+=(claude)
  [ -d "$HOME/.codex" ] && TOOLS+=(codex)
  [ -d "$HOME/.cursor" ] && TOOLS+=(cursor)
fi
if [ "${#TOOLS[@]}" -eq 0 ]; then
  echo "usage: bash setup.sh [claude] [codex] [cursor] [--uninstall]" >&2
  echo "  (no ~/.claude, ~/.codex, or ~/.cursor found to auto-detect — name at least one tool)" >&2
  exit 2
fi

skills_dir_for() {
  case "$1" in
    claude) echo "$HOME/.claude/skills" ;;
    codex) echo "$HOME/.codex/skills" ;;
    cursor) echo "$HOME/.cursor/skills" ;;
  esac
}

install_link() {
  local link="$1"
  node "$REPO_ROOT/scripts/install-skill-link.cjs" "$SKILL_SRC" "$link"
}

uninstall_link() {
  local link="$1"
  node "$REPO_ROOT/scripts/install-skill-link.cjs" --uninstall "$SKILL_SRC" "$link"
}

credential_bootstrap() {
  if [ -f "$CRED_FILE" ]; then
    echo "credentials: keeping existing $CRED_FILE"
    return 0
  fi
  if [ ! -t 0 ]; then
    echo "credentials: non-interactive shell — create $CRED_FILE from .env.example when ready."
    return 0
  fi
  printf "Configure SitecoreAI authoring credentials now (one per machine)? [y/N] "
  local reply="" ep="" cid="" csec="" turl="" aud=""
  read -r reply || reply=""
  if [ "$reply" != "y" ] && [ "$reply" != "Y" ]; then
    echo "  skipped. Later: re-run setup.sh, or create $CRED_FILE from .env.example."
    return 0
  fi
  printf "  SITECORE_AUTHORING_ENDPOINT: "
  read -r ep || ep=""
  printf "  SITECORE_AUTHORING_CLIENT_ID: "
  read -r cid || cid=""
  printf "  SITECORE_AUTHORING_CLIENT_SECRET (hidden): "
  read -rs csec || csec=""
  printf "\n"
  printf "  SITECORE_AUTHORING_TOKEN_URL (blank for default): "
  read -r turl || turl=""
  printf "  SITECORE_AUTHORING_AUDIENCE (blank for default): "
  read -r aud || aud=""
  umask 077
  mkdir -p "$CRED_DIR"
  {
    echo "# provision-sitecore-ai-component — Authoring API credentials (written by setup.sh)"
    echo "# Exported env vars and a per-repo ./.env override these (authoring-api.md)."
    echo "SITECORE_AUTHORING_ENDPOINT=$ep"
    echo "SITECORE_AUTHORING_CLIENT_ID=$cid"
    echo "SITECORE_AUTHORING_CLIENT_SECRET=$csec"
    if [ -n "$turl" ]; then echo "SITECORE_AUTHORING_TOKEN_URL=$turl"; fi
    if [ -n "$aud" ]; then echo "SITECORE_AUTHORING_AUDIENCE=$aud"; fi
  } > "$CRED_FILE"
  chmod 600 "$CRED_FILE"
  echo "  wrote $CRED_FILE (600). Values were not echoed."
}

for tool in "${TOOLS[@]}"; do
  if [ "$tool" = "codex" ]; then CODEX_SELECTED=1; fi
  dir="$(skills_dir_for "$tool")"
  echo "$tool:"
  if [ "$UNINSTALL" -eq 1 ]; then
    uninstall_link "$dir/$SKILL_NAME"
    case "$tool" in
      claude|codex) node "$REPO_ROOT/scripts/hooks/install.cjs" "$tool" --uninstall ;;
    esac
  else
    install_link "$dir/$SKILL_NAME"
    case "$tool" in
      claude|codex) node "$REPO_ROOT/scripts/hooks/install.cjs" "$tool" ;;
      cursor) echo "  note: Cursor has no hook surface — guardrails there remain prose-only (SKILL.md)." ;;
    esac
  fi
done

if [ "$UNINSTALL" -eq 1 ]; then
  echo "Done. The skill and its guard hooks are uninstalled; this clone is untouched."
  if [ -f "$CRED_FILE" ]; then
    echo "Credentials remain at $CRED_FILE — delete the file yourself if it is no longer needed."
  fi
else
  credential_bootstrap
  if [ "$CODEX_SELECTED" -eq 1 ]; then
    echo "Codex hooks: restart Codex or start a new task, then open /hooks to review and trust the installed definitions."
    echo "  Codex skips non-managed hooks until their exact current hash is trusted; repeat this review after hook updates."
  fi
  echo "Done. Restart the tool if it caches skills or hooks (hook configs snapshot at session start)."
  echo "The skill drives this clone's CLI — keep the clone in place (git pull to update everyone's copy)."
fi
