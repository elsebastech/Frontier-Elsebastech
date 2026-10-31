# Plan de tareas — de aquí a la corrida 3

Estado verificado a las **15:30** — corrida 1 ya gastada (ENTRYPOINT VALIDADO 14:52):

```
corrida 1      job 04427736 · 25.7 s · 8.297 registros · congelada en registro/foto-previa/oficial-corrida-1/
validador      OK · barrido 0 fugas en 55.114 campos · tests públicos 5/5 · muestra 13/13 (27/27)
protocolo      F1 replicación · F2 re-anonimizar · F3 variantes · F4 cambio de fuentes → PROTOCOLO OK
diccionario    202 entidades (190 personas + 3 conservadas + 9 identificadores huérfanos)
```

Hecho desde la corrida 1:

| Tarea | Estado |
|---|---|
| Identidad por `ancla` (no por `entity_id`) | ✅ el ID puede moverse sin cambiar el seudónimo |
| Reconciliación con el registro anterior (cédula/correo/nombre antes que orden de fila) | ✅ F4: mismo humano con `cliente_id` nuevo conserva seudónimo |
| Identificadores huérfanos (4 placas, 1 pasaporte, direcciones, celular/cédula con contexto) | ✅ 9 reemplazos, entidades `identifier` en el diccionario |
| Autor por `uid` en vez de por nombre | ✅ homónimos dejan de compartir firma |
| Jev (`typesafe/jev-1.14`, endpoint `/api/alpha/decisions`) | ✅ cliente con caché; veto de organizaciones activo; sin uso hoy porque las reglas cubren este corpus |

Pendiente antes de la corrida 2: fusión de 2 uids que resulten el mismo humano, cuasi-identificador "año",
formato de fuente nuevo, y migrar el servicio a cloud.

Estado verificado a las **13:09** (no es de memoria):

```
node ../frontier-reto-1/validar.mjs output --public fuentes  →  "OK: la salida pasa el validador"
data/extraccion  2028 chats · 26 docs · 6243 tablas = 8297 registros (= record_index)
```

Lo que falta es **todo el núcleo de anonimización**: no existe `src/registro/`, ni Paso A/B, ni barrido, ni `entities.json` (hoy es `{"entities": []}`), ni servicio HTTP.

---

## Correcciones al CONTEXTO.md (ya aplicadas)

1. **§2.3 Homónimos.** Los chats se resuelven por `uid`, no por nombre. Hay **8 nombres exactamente repetidos** en `users.json`: 4 empleado↔cliente (Empleado E1, E2, E3, E4 — nombres omitidos: PII) y 4 cliente↔cliente (Cliente C1, C2, C3, C4 — nombres omitidos: PII). 149 clientes → **145 nombres únicos**. La ambigüedad cara no está en el chat: está al ligar *nombre de users.json → fila del maestro*.
2. **§2.1 cédula.** El "conserva los primeros dígitos" no se cumple de forma consistente en la muestra (43062949 → 43062949/63222250, 32390356 → 43062949: no conserva prefijo). Lo que puntúa es **mismo largo + formato válido + lejos del original**. No perseguir el prefijo.
3. **Regla dura del validador (no estaba escrita):** cada clave de `pseudonyms` **debe aparecer literalmente en algún registro de esa persona** (`validar.mjs:356`). Si declaras `phone` y nunca lo dibujas, es error. → `pseudonyms` = solo lo que se emite.
4. **A2 y A3 se cierran con evidencia:** XML de PQRS trae columnas `radicado, cliente_id, cedula, ciudad, fecha, agente, tipo, estado, descripcion, respuesta` (el atributo `tipo` sale como columna `tipo`); la metadata de PDF viene en **minúsculas** (`author, creationdate, creator, subject, title, keywords`).

---

## Decisiones que hay que tomar antes de escribir código (5 min)

| # | Decisión | Propuesta |
|---|---|---|
| D1 | Llave de Jev | Si a las **14:00** no hay `TYPESAFE_API_KEY`, se despliega **reglas solas** (~88) y Jev entra después. No bloquea la corrida 1. |
| D2 | Autor `" 5"` (5 mensajes, uid de usuario borrado) | Seudónimo genérico estable `Persona 5` como persona propia; nunca dejar el original. |
| D3 | Empleados solo en organigrama (37 en el HTML vs 36 en `empleados.xml`) | Recibir identidad aunque no estén en la tabla; su relación `reporta_a` vale 4 pts. |
| D4 | Terceros que solo viven en texto (`Martín Jiménez` doc_18, `Esteban Darío Mejía` doc_26) | Persona nueva sin ancla estructurada, ID nuevo, revisión manual de la lista corta. |

---

## Tareas, en orden de ruta crítica

Dos pistas en paralelo. La pista A no puede empezar sin el registro (T1): si T1 se atora, la pista B sigue con el barrido y los cuasi-identificadores.

### Pista A — identidad

**T1 · Registro de personas** `13:10–13:35`
- Objetivo: `src/registro/{personas,identificadores,menciones}.ts` + `registro/` en disco (append-only, fuera del repo).
- Entrada: `data/extraccion/tables.jsonl` (clientes `CL-…`, empleados `KP-…`), `data/uids.json`, PQRS (`agente`, `cliente_id`, `cedula`).
- Salida: `P0001…` con ancla, tipo (cliente/empleado/tercero), género, y sus identificadores normalizados (correo, celular, cédula, uid, nombre y apellidos por separado).
- Aceptación: 149 clientes + 36 empleados = **185 personas** con ID; correr dos veces devuelve los mismos IDs byte a byte; el bot `Kipi` nunca recibe ID.

**T2 · Detección y resolución en cascada** `13:35–14:00`
- Orden: (1) `uid` → persona; (2) correo/cédula/celular exactos (con `digitosCompactos` del validador); (3) nombre normalizado con candidato único; (4) 2+ candidatos → evidencia cruzada (radicado, monto+fecha, cédula dictada, adjunto, rol); (5) sin coincidencia → persona nueva.
- Aceptación: las 8 colisiones de `users.json` resueltas **con el porqué escrito** en `knowledge/resolucion.md`; los 13 clientes sin liga directa resueltos por evidencia o declarados "sin liga" con su ID; 0 fusiones entre empleado y cliente homónimo.

**T3 · Terceros y homónimos del texto** `14:00–14:15`
- Nombres que aparecen en chats/docs y no están en ninguna tabla → candidatos persona/organización/lugar/marca → ID nuevo o `kept`.
- Aceptación: lista revisada a mano (≈20 nombres) ≤ 15 min, cada uno con decisión y razón; bancos/billeteras/comercios/reguladores con `kept: true`.

### Pista B — texto

**T4 · Paso A y Paso B (motor de reemplazo)** `13:10–13:40`
- Objetivo: `⟦P0042·forma⟧` y render por forma exacta (completo / nombre+1er apellido / solo nombre / correo / correo deletreado / cédula con puntos / celular / dirección / `nombre_apellido` en adjuntos / `@handle` / `<@UID>` → uid falso del mismo formato).
- Aceptación: reemplazo **quirúrgico** (todo lo demás byte a byte); los 5 mensajes del usuario borrado, los PDF y los nombres de archivo (`carta_mora_luis_santander.pdf`, `carta_cobro_juridico_esteban_dario_mejia.pdf`) incluidos; 0 tildes/separadores alterados fuera de las formas reemplazadas.

**T5 · Barrido determinista (M2)** `13:40–13:55`
- Objetivo: `scripts/barrido.ts` importa `contiene()` real del validador sobre **todas** las formas de **todas** las personas, en los 4 archivos.
- Aceptación: `0 formas reales restantes`; y además 0 pseudónimos que colisionen con formas reales de otra persona (el barrido global lo cuenta como fuga).

**T6 · Cuasi-identificadores (Q1–Q4)** `13:55–14:15`
- Tabla: `ocupacion` → "profesional de …", `barrio` → otro barrio de la misma ciudad, `ciudad`/`fecha_vinculacion` intactas. Texto: ocupación → sector, barrio → ciudad, año → "hace unos años".
- Aceptación: ningún registro (ni su fila del maestro) conserva la combinación original ciudad+barrio+ocupación+año; el test `indirecta` de la muestra pasa.

**T7 · `entities.json` honesto + juez local sobre la muestra** `14:15–14:30`
- Correr el pipeline completo sobre `sample/input` y **reconciliar contra `sample/expected_output`**: nº de entidades, mapeo de `records`, lista de `kept`, `originals` completos.
- Aceptación: 0 fusiones, 0 divisiones, homónimos separados, conservados intactos, similitud de texto ≥ 0,98, y el validador oficial en verde sobre la muestra **y** sobre el corpus.

### Cierre del bloque

**T8 · Servicio HTTP + deploy** `14:30–14:45` (si se pasa de 14:45 se quema el 30 %)
- `GET /health` (con `models`), `POST /run` (job async), `GET /run/{id}`, `GET /output/{archivo}`, `POST /anonymize`, `GET /entities`; 1 proceso Node 26, volumen persistente para `registro/`, `run.sh`.
- Aceptación: `/health` ok desde fuera; `/anonymize` con 3 casos (conocida → misma identidad, nueva → nueva, homónimos → 2 distintas) en < 10 s; `/output` sirve los 4 archivos; **nada de probar el entrypoint desplegado después**.

**T9 · Corrida 1 (60 %)** `antes de 14:45`
- Antes de gastarla: `/health` + `/anonymize` (quema corrida si el servicio no responde).
- Al terminar: copiar `entities.json` a `registro/foto-previa.json` (es la referencia del 70 % post-cambio) y confirmar que `vigilante.jsonl` sigue anotando `igual`.

**T10 · Prueba de persistencia (M5)** `al terminar la corrida 1`
- Correr sobre un subconjunto y luego sobre el total; comparar IDs e identidades viejas.
- Aceptación: 100 % iguales. Vale 70 % del puntaje y cuesta 10 minutos: no dejarla para el bloque 4.

---

## Qué NO hacer hoy

- Jev afinado, docs en inglés, `DECISIONS.md` largo, demo de 5 min: todo después de la corrida 1.
- Reescribir texto con LLM: castiga utilidad 10 pts.
- Tocar `src/extract/`: ya pasa el validador; cualquier cambio ahí pone en riesgo los 8.297 registros.

## Checklist para gastar una corrida

1. `validar.mjs` en verde sobre corpus y muestra.
2. Barrido: 0 formas reales.
3. `entities.json`: sin claves `pseudonyms` que no se dibujen; `kept` con `originals` + `reason`.
4. `/health` y `/anonymize` respondiendo **desde fuera**.
5. `registro/` persistido en volumen y copia local de `entities.json`.
