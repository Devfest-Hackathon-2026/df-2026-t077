#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
profile="${1:-frontend}"
case "$profile" in frontend|backend|full) ;; *) echo 'Choose frontend, backend or full' >&2; exit 2;; esac
if command -v volta >/dev/null 2>&1; then
  volta run --node 24.22.2 --npm 11.19.1 npm run setup -- "$profile"
else
  npm run setup -- "$profile"
fi
