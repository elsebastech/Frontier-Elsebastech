#!/usr/bin/env bash
# Panel local para probar sin tocar el registro de producción.
#   ./panel-pruebas.sh            → http://localhost:8080/panel
#   ./panel-pruebas.sh 9000       → otro puerto
#
# Copia registro/ a pruebas/registro-panel/ y arranca el servicio con REGISTRO apuntando ahí:
# las personas nuevas que inventes al probar se guardan en la copia, no en el registro oficial.
set -euo pipefail
cd "$(dirname "$0")"

PUERTO="${1:-8080}"
COPIA="pruebas/registro-panel"

if [[ ! -f registro/personas.json ]]; then
  echo "Falta registro/personas.json: corre antes ./run.sh para construir el registro." >&2
  exit 1
fi

mkdir -p "$COPIA"
cp registro/personas.json registro/identidades.json registro/terceros.json "$COPIA"/ 2>/dev/null || true
echo "▸ registro de pruebas: $COPIA (copia de registro/)"

REGISTRO="$COPIA" ./panel.sh "$PUERTO"
