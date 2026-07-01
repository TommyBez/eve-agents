#!/bin/bash
# SessionStart hook: make sure a fresh Claude Code session (web/remote or
# local) can run `pnpm verify` — Node 24, pnpm via corepack, deps installed.
#
# Contract: idempotent, fast when already set up, and NEVER exits non-zero
# (a failing hook would break session startup; we degrade with a message).

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

log() { echo "[session-start] $*"; }

# --- 1. Node >= 24 ---------------------------------------------------------
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

major="$(node_major)"
if [ -z "$major" ] || [ "$major" -lt 24 ] 2>/dev/null; then
  log "node >= 24 not active (found: ${major:-none}); trying nvm..."
  for nvm_sh in "${NVM_DIR:-$HOME/.nvm}/nvm.sh" /opt/nvm/nvm.sh; do
    if [ -s "$nvm_sh" ]; then
      # shellcheck disable=SC1090
      . "$nvm_sh" >/dev/null 2>&1
      nvm install 24 >/dev/null 2>&1 && nvm use 24 >/dev/null 2>&1
      break
    fi
  done
  major="$(node_major)"
  if [ -n "$major" ] && [ "$major" -ge 24 ] 2>/dev/null; then
    node_bin="$(dirname "$(command -v node)")"
    log "activated node $(node -v) via nvm ($node_bin)"
    # Persist for the rest of the session (nvm use only affects this subshell).
    if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
      echo "export PATH=\"$node_bin:\$PATH\"" >>"$CLAUDE_ENV_FILE"
    fi
  else
    log "WARNING: node >= 24 unavailable and nvm could not provide it." \
      "Install Node 24 (see .nvmrc) before running pnpm verify."
  fi
else
  log "node $(node -v) OK"
fi

# --- 2. pnpm (via corepack, best-effort) -----------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || true
fi
if command -v pnpm >/dev/null 2>&1; then
  log "pnpm $(pnpm -v 2>/dev/null || echo '(version unknown)') OK"
else
  log "WARNING: pnpm unavailable (corepack enable failed);" \
    "run 'corepack enable' manually before pnpm verify."
  exit 0
fi

# --- 3. Dependencies (only when missing) ------------------------------------
if [ -d "$REPO_ROOT/node_modules" ]; then
  log "node_modules present; skipping install"
else
  log "installing dependencies (pnpm install --frozen-lockfile)..."
  if (cd "$REPO_ROOT" && pnpm install --frozen-lockfile); then
    log "dependencies installed"
  else
    log "WARNING: pnpm install failed; run it manually before pnpm verify."
  fi
fi

exit 0
