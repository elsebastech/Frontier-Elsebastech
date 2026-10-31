#!/usr/bin/env bash
# Prueba del entrypoint como lo verá el jurado, desde fuera.
# Uso:  ./scripts/prueba-entrypoint.sh https://xxxx.trycloudflare.com
# No gasta corrida: /run es nuestro, no la validación de la plataforma.
# Sale con código 0 solo si TODAS las comprobaciones pasan.
set -uo pipefail

U="${1:-}"
if [ -z "$U" ]; then
  echo "Falta la URL. Uso: $0 https://xxxx.trycloudflare.com" >&2
  exit 2
fi
U="${U%/}"

cd "$(dirname "$0")/.." || exit 2

# Credenciales de las fuentes, sin imprimirlas.
if [ -f .env ]; then set -a; . ./.env; set +a; fi
: "${FUENTES_URL:?falta FUENTES_URL en .env}"
: "${FUENTES_TOKEN:?falta FUENTES_TOKEN en .env}"

fallos=0
ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
ko() { printf '  \033[31m✗\033[0m %s\n' "$1"; fallos=$((fallos + 1)); }
paso() { printf '\n── %s\n' "$1"; }

paso "1 · /health desde fuera"
H=$(curl -s -m 15 "$U/health")
echo "     $H" | head -c 300; echo
if echo "$H" | grep -q '"status":"ok"'; then ok "/health responde ok"; else ko "/health no responde ok"; fi
if echo "$H" | grep -q '"registro":true'; then ok "el registro persistente está cargado"; else ko "registro ausente"; fi

paso "2 · /anonymize en vivo con datos reales del registro"
if python3 scripts/prueba-anonymize.py "$U"; then :; else fallos=$((fallos + 1)); fi

paso "3 · /run (descarga real de las fuentes)"
R=$(curl -s -m 30 -X POST "$U/run" -H 'content-type: application/json' \
  -d "{\"sources_url\":\"$FUENTES_URL\",\"token\":\"$FUENTES_TOKEN\"}")
echo "     $R"
JOB=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('job_id',''))" 2>/dev/null)
if [ -z "$JOB" ]; then
  ko "no devolvió job_id"
else
  ok "job_id $JOB"
  EST=""
  for i in $(seq 1 40); do
    sleep 4
    S=$(curl -s -m 15 "$U/run/$JOB")
    EST=$(echo "$S" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
    printf '     %ss %s\n' "$((i * 4))" "$(echo "$S" | head -c 200)"
    case "$EST" in done|failed) break;; esac
  done
  if [ "$EST" = "done" ]; then ok "/run terminó en done"; else ko "/run terminó en '$EST'"; fi
fi

paso "4 · /output y /entities"
for f in chats.jsonl docs.jsonl tables.jsonl entities.json; do
  N=$(curl -s -m 25 "$U/output/$f" | wc -c | tr -d ' ')
  if [ "${N:-0}" -gt 100 ]; then ok "/output/$f ($N bytes)"; else ko "/output/$f vacío o ausente ($N bytes)"; fi
done
E=$(curl -s -m 25 "$U/entities")
NE=$(echo "$E" | python3 -c "import json,sys; d=json.load(sys.stdin); e=d.get('entities',d); print(len(e))" 2>/dev/null)
if [ "${NE:-0}" -gt 100 ]; then ok "/entities devuelve $NE entidades"; else ko "/entities devolvió '$NE'"; fi

paso "5 · ruta inexistente debe dar 404"
C404=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$U/nada")
if [ "$C404" = "404" ]; then ok "404 en ruta inválida"; else ko "ruta inválida devolvió $C404"; fi

echo
if [ "$fallos" -eq 0 ]; then
  printf '\033[32mENTRYPOINT OK — listo para pulsar VALIDAR\033[0m\n'
  exit 0
else
  printf '\033[31mENTRYPOINT CON %d FALLO(S) — no pulsar VALIDAR todavía\033[0m\n' "$fallos"
  exit 1
fi
