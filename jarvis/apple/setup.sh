#!/usr/bin/env bash
# Generates Jarvis.xcodeproj. Run on your Mac:
#   JARVIS_TEAM_ID=ABCDE12345 ./setup.sh
# JARVIS_TEAM_ID is optional (you can pick your team in Xcode's Signing tab instead).
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null; then
  if command -v brew >/dev/null; then
    echo "Installing XcodeGen with Homebrew…"
    brew install xcodegen
  else
    echo "XcodeGen is required: install Homebrew (https://brew.sh) then run 'brew install xcodegen'." >&2
    exit 1
  fi
fi

user=$(whoami | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
export JARVIS_BUNDLE_PREFIX="${JARVIS_BUNDLE_PREFIX:-com.${user:-me}.personal}"
export JARVIS_TEAM_ID="${JARVIS_TEAM_ID:-}"

xcodegen generate
echo
echo "Bundle prefix: $JARVIS_BUNDLE_PREFIX"
echo "Done. Open Jarvis.xcodeproj, then follow the steps in README.md."
open Jarvis.xcodeproj 2>/dev/null || true
