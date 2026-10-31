#!/usr/bin/env bash
# Panel de verificación en local, en un solo comando.
#   ./panel.sh            → http://localhost:8080/panel
#   ./panel.sh 9000       → otro puerto
#
# Genera un token interno si no hay ANON_TOKEN en .env, y lo imprime dentro de la URL para que el
# panel pueda ver los originales y disparar corridas con las credenciales del .env.
set -euo pipefail
cd "$(dirname "$0")"

PUERTO="${1:-8080}"

# Node 22.18+ (usa process.loadEnvFile, fetch nativo y type stripping).
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Se necesita Node 22.18 o superior (tienes $(node -v 2>/dev/null || echo 'nada'))." >&2
  exit 1
fi

TOKEN="${ANON_TOKEN:-}"
if [[ -z "$TOKEN" && -f .env ]]; then
  TOKEN="$(grep -m1 '^ANON_TOKEN=' .env | cut -d= -f2- || true)"
fi
if [[ -z "$TOKEN" ]]; then
  TOKEN="$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')"
  echo "Token interno generado para esta sesión."
fi

[[ -d registro ]] || mkdir -p registro
[[ -d trabajos ]] || mkdir -p trabajos

echo "▸ servicio en http://localhost:${PUERTO}"
echo "▸ panel:      http://localhost:${PUERTO}/panel?k=${TOKEN}"
echo "  (Ctrl+C para parar)"
echo

PORT="$PUERTO" ANON_TOKEN="$TOKEN" node src/servicio/server.ts &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' INT TERM EXIT
wait "$PID"
