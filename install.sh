#!/usr/bin/env bash
# Alexandria one-liner installer.
#   curl -fsSL https://raw.githubusercontent.com/JoshBong/alexandria/main/install.sh | bash
#
# Installs the `alexandria` CLI globally from GitHub via npm. Requires Node 18+ and the
# Claude Code CLI (`claude`) on your PATH — Alexandria spawns Keepers as `claude` sessions.
set -euo pipefail

REPO="github:JoshBong/alexandria"
GOLD='\033[33m'; DIM='\033[2m'; RED='\033[31m'; RESET='\033[0m'

say() { printf "${GOLD}⟡ %s${RESET}\n" "$1"; }
warn() { printf "${RED}⚠ %s${RESET}\n" "$1"; }

say "Installing Alexandria…"

# --- prerequisites -----------------------------------------------------------
if ! command -v node >/dev/null 2>&1; then
  warn "Node.js not found. Install Node 18+ first: https://nodejs.org"
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  warn "Node 18+ required (found $(node -v)). Please upgrade."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  warn "npm not found. It ships with Node.js — reinstall Node."
  exit 1
fi

# --- install -----------------------------------------------------------------
say "npm i -g $REPO"
npm i -g "$REPO"

# --- claude check (non-fatal) ------------------------------------------------
if ! command -v claude >/dev/null 2>&1; then
  printf "${DIM}"
  warn "Claude Code CLI (\`claude\`) not found on PATH."
  echo "  Alexandria needs it to run Keepers. Install + log in:"
  echo "    https://docs.anthropic.com/en/docs/claude-code"
  printf "${RESET}"
fi

say "Installed. Start it with:  alexandria"
echo "   run a goal as a self-driving loop:  alexandria-loop \"<goal>\""
