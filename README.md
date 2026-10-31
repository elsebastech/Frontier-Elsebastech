# Anonimización determinista de un corpus con PII

Servicio y pipeline que toman conversaciones, documentos y tablas con datos personales y devuelven
el mismo corpus con **identidades falsas estables**: la misma persona recibe siempre el mismo
seudónimo, aunque las fuentes crezcan o la persona llegue con otro identificador.

Todo el proceso es determinista y auditable desde el panel: no hay nada que dependa de la suerte ni
de un modelo para decidir un dato.

## Arranque rápido

```bash
# Node 22.18 o superior
cp .env.example .env        # pega FUENTES_URL y FUENTES_TOKEN (nunca al repo)

./panel.sh                  # panel de verificación en http://localhost:8080/panel
./run.sh                    # pipeline completo sobre fuentes/ ya descargadas
./run.sh --bajar            # descarga las fuentes de la API y después procesa
./panel.sh 9000             # otro puerto
```

`panel.sh` genera un token interno si no hay `ANON_TOKEN` en `.env` y lo imprime dentro de la URL,
para que el panel pueda ver los originales y disparar corridas con las credenciales del `.env`.

## Qué hace el panel

Cuatro bloques, de arriba abajo:

1. **Probar un registro suelto** — pegas JSON (un objeto `{"records":[…]}`, un array o `{"chats":[…]}`
   y pulsa *Anonimizar*. Devuelve el antes y el después lado a lado, con los tramos reemplazados
   resaltados y una tabla campo por campo. No gasta ninguna corrida oficial.
2. **Correr el pipeline completo** — dispara el proceso real sobre las fuentes: descarga,
   extracción, compuerta de entrada (preflight), anonimización y verificación. Muestra el avance paso
   por paso, los conteos, los enlaces a los cuatro archivos de salida y un comparativo de registros
   reales contra su versión anonimizada.
3. **Compuerta de entrada** — el veredicto de Jev sobre la *forma* de los datos: ¿este conjunto se
   puede anonimizar? Solo se le manda esquema (tablas, columnas, tipos, conteos), nunca un valor.
4. **Token interno** — sin él, las rutas que muestran originales o que gastan credenciales
   responden 401.

## Cómo se anonimiza

```
fuentes de la API
      │  fetch + extracción (CSV latin-1 y separador ";", XML, PDF, HTML, MD)
      ▼
data/extraccion/*.jsonl          textos y tablas normalizados, sin tocar
      │  1. personas: una por fila, anclada a su identificador de origen (no al nombre)
      │  2. reconciliación con el registro previo (cédula, correo, nombre único)
      │  3. identidades: HMAC(sal, ancla) → nombre, correo, cédula, dirección… falsos
      │  4. dos pasos: real → ⟦P00xx·tipo⟧ → identidad falsa
      ▼
output/{chats,docs,tables}.jsonl + entities.json
```

Decisiones que sostienen el resultado:

- **La identidad va por ancla, no por id de fila.** Si el origen reordena o cambia de id, la persona
  conserva su seudónimo.
- **Dos personas con el mismo nombre no se fusionan** salvo evidencia determinista. Se resuelven por
  cédula dictada, correo corregido, número de cliente o eliminación uno a uno.
- **Dos filas con la misma cédula y el mismo contacto son el mismo humano**: se colapsan y conservan
  el seudónimo más antiguo.
- **El registro solo crece.** Una persona que desaparece de las fuentes conserva su identidad por si
  reaparece.
- **Seudónimo que coincide con un nombre real se redibuja**, y la reparación queda registrada en
  `registro/ajustes-identidad.json`.
- **Tres verificaciones independientes**: `barrido` (normalizado), `verificar` (literal, con
  severidad) y el validador oficial del reto.

## Endpoints del servicio

| Ruta | Qué hace |
|---|---|
| `GET /health` | estado, modelo activo, si hay registro |
| `POST /run` | corre el pipeline (`{sources_url, token}`; `"env"` usa las del servidor, requiere token interno) |
| `GET /run/{id}` | estado del trabajo, conteos, veredicto del preflight |
| `GET /run/{id}/muestra` | comparativo original/anonimizado (requiere token interno) |
| `POST /anonymize` | anonimiza registros sueltos con las identidades del registro |
| `GET /output/{archivo}` | las cuatro salidas de la última corrida |
| `GET /entities` | diccionario de identidades falsas |
| `GET /panel` | panel de verificación |

## Comandos útiles

```bash
node scripts/demo.ts                 # demostración: conocida, repetida, nueva y homónimos
node scripts/preflight.ts            # ¿se puede anonimizar este conjunto? (rc=2 si no)
node scripts/revisar-cambio.ts       # qué llegó en las fuentes y qué no
node scripts/vigilante.ts            # vigila la API: conteos y firma de esquema
node scripts/traza.ts <id-registro>  # original → marcador → identidad falsa
node scripts/inventario.ts           # quién aparece, con qué formas y qué PII no tiene dueño
node scripts/protocolo.ts            # F1 replicación, F2 re-anonimizar, F3 variantes, F4 cambio
```

## Datos que nunca salen del servidor

`registro/` (mapa real→falsa), `data/`, `output/`, `trabajos/` y `pruebas/` están en `.gitignore`:
contienen datos derivados de PII. El servicio público solo expone lo anonimizado.
