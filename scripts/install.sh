#!/usr/bin/env bash
set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "\n${CYAN}🚀 Installing codebuddy-hud...${NC}\n"

# 1. Check Node.js
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}✖ Node.js is not found in PATH. Please install Node.js >= 18.0.0 first: https://nodejs.org${NC}" >&2
  exit 1
fi

NODE_VERSION=$(node -v | tr -d 'v')
MAJOR_VERSION=$(echo "$NODE_VERSION" | cut -d'.' -f1)

if [ "$MAJOR_VERSION" -lt 18 ]; then
  echo -e "${RED}✖ Node.js version v${NODE_VERSION} is too old. codebuddy-hud requires Node.js >= 18.0.0.${NC}" >&2
  exit 1
fi

echo -e "${GREEN}✔ Found Node.js v${NODE_VERSION}${NC}"

# 2. Download and run bootstrap.js
TMP_BOOTSTRAP=$(mktemp /tmp/codebuddy-hud-bootstrap.XXXXXX 2>/dev/null || mktemp -t codebuddy-hud-bootstrap 2>/dev/null || mktemp)
BOOTSTRAP_URL="${CODEBUDDY_HUD_BOOTSTRAP_URL:-}"
if [ -z "$BOOTSTRAP_URL" ] && [ -n "${CODEBUDDY_HUD_MIRROR:-}" ]; then
  BOOTSTRAP_URL="${CODEBUDDY_HUD_MIRROR%/}/https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/bootstrap.js"
fi
BOOTSTRAP_URL="${BOOTSTRAP_URL:-https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/bootstrap.js}"

cleanup() {
  rm -f "$TMP_BOOTSTRAP"
}
trap cleanup EXIT

echo -e "  Downloading bootstrap installer..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$BOOTSTRAP_URL" -o "$TMP_BOOTSTRAP"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "$TMP_BOOTSTRAP" "$BOOTSTRAP_URL"
else
  echo -e "${RED}✖ Neither curl nor wget found in PATH.${NC}" >&2
  exit 1
fi

node "$TMP_BOOTSTRAP"

# 3. Auto-register PATH via symlink (skip with CODEBUDDY_HUD_NO_PATH=1)
if [ "${CODEBUDDY_HUD_NO_PATH:-}" != "1" ]; then
  CODEBUDDY_HOME="${CODEBUDDY_HOME:-$HOME/.codebuddy}"
  HUD_BIN="$CODEBUDDY_HOME/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js"
  LOCAL_BIN="$HOME/.local/bin"

  if [ -f "$HUD_BIN" ]; then
    # Try ~/.local/bin symlink
    if echo "$PATH" | tr ':' '\n' | grep -qx "$LOCAL_BIN" 2>/dev/null; then
      mkdir -p "$LOCAL_BIN"
      ln -sf "$HUD_BIN" "$LOCAL_BIN/codebuddy-hud"
      chmod +x "$HUD_BIN"
      echo -e "${GREEN}✔ Linked codebuddy-hud → $LOCAL_BIN/codebuddy-hud${NC}"
      echo -e "  The 'codebuddy-hud' command is now available in your terminal."
    else
      chmod +x "$HUD_BIN"
      echo ""
      echo -e "  ${CYAN}Tip:${NC} To use 'codebuddy-hud' as a global command, add to your shell profile:"
      echo -e "    export PATH=\"\$HOME/.local/bin:\$PATH\""
      echo -e "    mkdir -p ~/.local/bin && ln -sf \"$HUD_BIN\" ~/.local/bin/codebuddy-hud"
    fi
  fi
fi
