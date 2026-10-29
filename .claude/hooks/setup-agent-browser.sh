#!/bin/bash
# Instala o CLI do agent-browser nas sessões na nuvem (container temporário)
# e aponta para o Chromium já instalado, evitando baixar outro navegador.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0

command -v agent-browser >/dev/null 2>&1 || npm i -g agent-browser >/dev/null 2>&1

CHROME=$(find /opt/pw-browsers -type f -path '*chrome-linux*' -name chrome 2>/dev/null | head -1)
if [ -n "$CHROME" ] && [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export AGENT_BROWSER_EXECUTABLE_PATH=\"$CHROME\"" >> "$CLAUDE_ENV_FILE"
fi
