#!/usr/bin/env bash
# Pipeline completo, de cero a output/ verificado.
# Uso:
#   ./run.sh                 # usa fuentes/ ya descargadas
#   ./run.sh --bajar         # descarga de la API primero (necesita .env)
#   ./run.sh --muestra       # corre sobre sample/ y compara con la salida ideal
set -euo pipefail
cd "$(dirname "$0")"

VALIDADOR="${VALIDADOR:-../frontier-reto-1/validar.mjs}"

if [[ "${1:-}" == "--bajar" ]]; then
  echo "▸ descargando fuentes"
  node scripts/fetch.ts
fi

if [[ "${1:-}" == "--muestra" ]]; then
  echo "▸ muestra: extracción"
  DATA=sample-data node scripts/espejo.ts sample/input sample-esp >/dev/null
  echo "▸ muestra: anonimización"
  DATA=sample-data REGISTRO=sample-registro node scripts/anonimizar.ts sample-data sample-anon
  echo "▸ muestra: validador oficial"
  node "$VALIDADOR" sample-anon --public sample
  echo "▸ muestra: tests (13)"
  node scripts/juez-local.ts sample/tests_sample.json sample-anon --original sample-data/extraccion
  exit 0
fi

echo "▸ extracción"
DATA=data node scripts/espejo.ts fuentes output-esp >/dev/null
echo "▸ inventario"
node scripts/inventario.ts | tail -5
echo "▸ anonimización"
node scripts/anonimizar.ts
echo "▸ validador oficial"
node "$VALIDADOR" output --public fuentes
echo "▸ barrido de formas reales"
node scripts/barrido.ts
echo "▸ tests públicos"
node scripts/juez-local.ts fuentes/tests_public.json output
echo
echo "Listo: output/ verificado. Falta probar /health y /anonymize del servicio antes de gastar corrida."
