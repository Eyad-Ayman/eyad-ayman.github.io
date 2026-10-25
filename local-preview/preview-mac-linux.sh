#!/bin/sh
# Preview the portfolio on http://localhost:8080 (needs Python 3).
cd "$(dirname "$0")/.." || exit 1
echo "Portfolio:   http://localhost:8080/"
( sleep 1; (open http://localhost:8080/ || xdg-open http://localhost:8080/) >/dev/null 2>&1 ) &
exec python3 -m http.server 8080
