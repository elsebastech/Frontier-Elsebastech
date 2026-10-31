# Contexto del reto y plan — Frontier CDMX 26

Reto: **"Vende los datos sin vender a la gente"** · Equipo: elsebastech · Documento vivo, se actualiza durante el día.

> Este archivo va en el repo público: **no contiene datos personales del corpus**. Los ejemplos usan nombres inventados ("Ana Pérez").

---

## Resumen simplificado (léelo primero)

**El problema en una frase.** Kipu Pay, una fintech colombiana, quiere vender sus chats de soporte, documentos y tablas de clientes para que otra empresa entrene un bot. Tenemos que entregar una copia donde **nadie real pueda ser identificado**, pero que **siga sirviendo**: mismo texto, mismos números, mismas relaciones.

**Qué hacemos.** Cambiamos a cada persona por una identidad falsa (nombre, correo, celular, cédula, dirección…) y la usamos **siempre igual** en todas las fuentes y en todas las corridas.

**Por qué es difícil.**
- Los datos están escondidos: nombres en MAYÚSCULAS sin tildes, correos deletreados ("ana arroba gmail punto com"), cédulas con puntos, nombres dentro de nombres de archivo, metadatos de PDF y comentarios HTML.
- Hay gente que se llama casi igual (homónimos) y empleados que se llaman como clientes: no basta con comparar nombres.
- Pistas que juntas identifican a alguien ("fotógrafa, del barrio X, cliente desde 2025") se tienen que generalizar.
- A mitad del día llegan más datos: los viejos deben conservar exactamente su identidad falsa.

**Quién nos califica.** Un programa, de 0 a 100: que no se fugue nada (45), que la copia siga sirviendo (35) y que cada persona sea una sola de punta a punta (20). Solo tenemos **3 corridas** de evaluación en todo el día.

**Nuestro método, en 4 pasos.**
1. **Quién es quién:** armamos un registro de personas desde las tablas (cada una con un ID estable) y buscamos sus menciones en todo el texto.
2. **Paso A, real → ID:** cada mención se cambia por un marcador con el ID de la persona.
3. **Revisión:** comprobamos con la misma lupa del juez que no quedó ningún dato real.
4. **Paso B, ID → identidad falsa:** cada ID se convierte en su identidad falsa, guardada en un registro que solo crece.

Reglas para lo obvio, un modelo (Jev) solo para lo dudoso, una identidad fija por persona y una revisión final determinista.

**Dónde vamos.** ✅ Design entregado · ✅ Datos descargados y explorados · ✅ Extracción de los 3 tipos de fuente (pasa el validador) · ⏭️ Registro de anonimización · ⏭️ Reemplazo · ⏭️ Servicio desplegado · ⏭️ Corrida 1 antes de las 14:45.

---

## 1. El reto en detalle

### 1.1 Qué recibimos (API de fuentes)
Un servidor con raíz `/v1` y `Authorization: Bearer <token>`. Límite: 600 peticiones/minuto. Los JSON traen `ETag`.

| Fuente | Ruta | Formato | Volumen real |
|---|---|---|---|
| Chats | `/chats/channels`, `/chats/users`, `/chats/{canal}`, `/chats/{canal}/{fecha}` | Export estilo Slack | 6 canales, 142 fechas, 320 hilos, 2.028 mensajes |
| Documentos | `/docs`, `/docs/{id}` | 11 PDF, 6 HTML, 9 Markdown (2 en inglés) | 26 |
| Tablas | `/tables`, `/tables/{nombre}` | `clientes.csv` (Latin-1, `;`), `transacciones.csv` (UTF-8, `,`), `pqrs.xml`, `empleados.xml` | 149 + 6.030 + 28 + 36 = 6.243 filas |
| Índice | `/record_index` | Todos los ids que debe tener la salida | 8.297 |
| Tests públicos | `/tests/public` | 5 tests de ejemplo | |
| Muestra | `/sample.zip` | Dataset chico **con su salida ideal** | 13 tests |

Ids de registro: chats = `client_msg_id`; docs = `id` del índice; tablas = `<tabla>:<llave>` (`clientes:CL-…`, `transacciones:TX-…`, `pqrs:PQR-…`, `empleados:KP-…`).

### 1.2 Qué entregamos (API de nuestro servicio)
Servicio HTTP público, sin autenticación, raíz `/v1`.

| Ruta | Qué hace | Límite |
|---|---|---|
| `GET /health` | `{status:"ok", team, version, models}` | |
| `POST /run` | Recibe `{sources_url, token}` y regenera `output/` desde cero; devuelve `job_id` | 2 horas |
| `GET /run/{job_id}` | Estado (`queued`/`running`/`done`/`failed`), conteos, costo en tokens y segundos | |
| `GET /output/{archivo}` | `chats.jsonl`, `docs.jsonl`, `tables.jsonl`, `entities.json` | |
| `POST /anonymize` | Anonimiza registros nuevos con las mismas identidades (prueba en vivo) | 50 registros, 60 s |
| `GET /entities` | Diccionario completo (solo para el jurado) | |

`output/` es **uno a uno** con la entrada: cada registro una vez, mismo `id`, ninguna clave desaparece (si un PDF tenía `author`, sale con `author` seudonimizado).

`entities.json`: por persona `entity_id`, `type`, `originals` (todas las formas reales encontradas), `pseudonyms` (`name`, `email`, `phone`, `cedula`, `address`, `birth_iso`, `plate`, `handle`…), `records`; por organización/lugar/figura pública conservada, `kept: true` y `reason`.

Además: repo público con `run.sh`, `DECISIONS.md` (qué consideramos PII, qué conservamos y por qué, costo en tokens y tiempo) y una demo de 5 minutos.

### 1.3 Cómo se puntúa
| Dimensión | Puntos | Qué mide |
|---|---|---|
| Fuga | 45 | 35 por tests puntuales (un dato real sigue en su registro, en otro, en un metadato, en un nombre de archivo o como hash sin sal; una combinación barrio + ocupación + año sigue junta, también en la fila del maestro). 10 por un barrido global de todas las formas reales, que tolera confusables, separadores e invisibles |
| Utilidad | 35 | 10 parecido del texto no personal con la salida ideal · 9 falsos positivos intactos (bancos, marcas, lugares, figuras públicas) · 8 categoría del seudónimo (mismo género, formato válido, lejos del original) · 8 estructura (llaves entre tablas, registros por persona, quién habló con quién) |
| Consistencia | 20 | 8 misma persona = mismo seudónimo en todas las fuentes (× unicidad) · 5 homónimos separados · 4 relación "reporta a" entre empleados · 3 honestidad del diccionario |

Referencias del enunciado: salida ideal = 100; solución sólida por reglas sin modelos ≈ 88; hashear todo = 58; `[REDACTED]` = 56; un seudónimo por género = 70; cambiar una letra = 41; detectar solo el 70 % = 76.

### 1.4 Reglas que cambian el diseño
- Se permiten LLMs por API. **No** se permiten servicios ni librerías open source de anonimización de PII.
- Organizaciones, lugares, marcas y figuras públicas **se conservan**. Un apellido que también es lugar sigue siendo apellido cuando nombra a una persona.
- Reescribir el texto con un modelo pierde parecido: **se reemplaza, no se redacta de nuevo**.
- El desempate de homónimos **no** está junto al nombre: vive en otra fuente (radicado, fecha + monto, adjunto, fila del maestro).
- Si el servicio deja de responder durante una corrida, la corrida se gasta sin puntaje.

### 1.5 Corridas y el cambio de fuentes
- **3 corridas** al presionar VALIDAR ENTRYPOINT en `/evento/reto`: miden el 60 %, el 75 % y el 100 % de los tests ocultos. Antes de gastarla se comprueba `/health` y un `/anonymize`. Descargar datos **no** gasta corridas.
- En algún momento, sin aviso, **las fuentes crecen** (más fechas, canales, documentos y filas; nada viejo cambia).
- Puntaje final = 30 % la última corrida antes del cambio + 70 % la última después. Si no corrimos antes del cambio, ese 30 % es cero.
- Después del cambio, toda persona vieja debe conservar **exactamente** su seudónimo (se compara el `entities.json` de antes con el de después y multiplica la consistencia). Persona nueva = seudónimo nuevo; persona vieja con un identificador nuevo = misma persona; persona nueva que se llama como una vieja = otra persona.

---

## 2. Lo que aprendimos explorando
Detalle completo, con fuente y confianza de cada regla: [`knowledge/reglas.md`](knowledge/reglas.md).

### 2.1 Cómo quieren el seudónimo (de la salida ideal de la muestra)
- Nombre por nombre del mismo género; la identidad completa tiene nombre(s) + 2 apellidos.
- Cada forma se cambia por su equivalente: *nombre + 2 apellidos* → completo; *nombre + 1er apellido* → nombre(s) + 1er apellido; *solo el nombre* → nombre(s) del seudónimo.
- Correo de cliente `inicial+apellido@proveedor`; correo corporativo `nombre.apellido@kipupay.co`.
- Cédula: mismo largo, formato válido y lejos del original; en texto conserva los puntos. (La muestra **no** conserva el prefijo de forma consistente: 32390356 → 43062949. No perseguir el prefijo.)
- Nombre en archivo: `extracto_ana_perez_julio.pdf` → minúsculas, sin tildes, con `_`.
- El bot (Kipi) se conserva.

### 2.2 Cuasi-identificadores
- Las 149 combinaciones (ciudad, barrio, ocupación, año) del maestro son **únicas** → se generalizan siempre.
- En la tabla: ocupación → "profesional de …"; barrio → otro barrio de la misma ciudad; ciudad y fecha de vinculación intactas.
- En el texto: ocupación → sector, barrio → ciudad, año → "hace unos años" (reemplazo literal, aunque la gramática quede rara).

### 2.3 Dónde están las trampas en el corpus real
| Trampa | Qué encontramos |
|---|---|
| Homónimos | En `clientes.csv` nadie se llama exactamente igual, pero hay 6 pares con mismo nombre + 1er apellido. En `users.json` hay **8 nombres exactamente repetidos**: 4 empleado↔cliente (Empleado E1, E2, E3, E4 — nombres omitidos: PII) y 4 cliente↔cliente (Cliente C1, C2, C3, C4 — nombres omitidos: PII) → 149 clientes con 145 nombres únicos. El `uid` separa los chats sin ambigüedad; la ambigüedad cara está al ligar *nombre de `users.json` → fila del maestro* |
| Agente = cliente | Esos 4 empleados tienen el nombre completo **idéntico** a un cliente (no solo nombre + 1er apellido) |
| Liga chat → maestro | De 149 clientes en `users.json`: 77 se ligan por correo, 59 por nombre único, 13 sin liga directa |
| Bot | Dice el nombre completo del cliente en MAYÚSCULAS ("cuenta a nombre de …") y el del agente en el handoff ("Te atiende …") |
| Fuera del texto | Metadatos PDF (`Author`, `Title`, `Subject` con correo), `<meta name=author>`, comentarios HTML con correos, bloque HTML oculto, front matter con correos y `@usuario`, URL con nombre, nombres de archivo de docs y adjuntos, agente `nombre.apellido` en PQR, comentario XML con correo |
| Formatos | 8 correos deletreados, cédulas con puntos en 66 mensajes, placas (en texto y en nombre de archivo), 1 pasaporte, direcciones |
| Menciones | `<@UID>` en 8 uids (todos empleados) |
| Se conserva | Bancos, billeteras, comercios, entidades reguladoras; las descripciones de transacciones traen comercio + barrio |

---

## 3. La solución

### 3.1 Arquitectura: primero quién es quién, después cómo se llama
```
API de fuentes ─► 1 Fetch ─► 2 Extracción ─► 3 Registro de personas ─► 4 Detección y resolución
                                                                              │ (dudoso → Jev)
                                                                              ▼
 output/ ◄─ 8 Emitir ◄─ 7 Barrido final ◄─ 6 Paso B: ID → identidad ◄─ 5 Paso A: real → ID
                                                ▲                              + revisión
                                     registro de identidades                   + cuasi-identificadores
                                     (append-only, en disco)
```
Diagrama completo: [`design/architecture.png`](design/architecture.png) · Doc de diseño entregado: [`design/DESIGN.pdf`](design/DESIGN.pdf).

1. **Fetch:** baja todo respetando el límite y el charset real.
2. **Extracción** al esquema de salida (ver 3.2).
3. **Registro de personas** desde las tablas y `users.json`. Tres tablas:
   - `personas`: ID estable (`P0001…`), ancla (`CL-…`, `KP-…`, uid), tipo (cliente, empleado, tercero), género.
   - `identificadores`: valor original, normalizado y sus piezas (parte local del correo, solo dígitos, nombre y apellidos por separado).
   - `menciones`: registro, campo, texto exacto, persona asignada y **cómo se decidió**.
4. **Detección y resolución**, en cascada:
   1. identificador exacto (correo, cédula, celular, uid) → misma persona;
   2. nombre normalizado con un solo candidato → esa persona;
   3. con 2+ candidatos o nombre muy parecido → evidencia del registro (cédula dictada, número de cliente, radicado, monto y fecha, rol del autor) y, si no alcanza, **Jev**;
   4. sin coincidencia → persona nueva con el siguiente ID.
5. **Paso A, real → ID:** cada mención se cambia por `⟦P0042·forma⟧` (completo, nombre, correo, deletreado, cédula…). Luego:
   - barrido determinista con la función `contiene()` del validador: no puede quedar ninguna forma real;
   - Jev como segunda red: "¿este texto todavía identifica a alguien?" (lo que marque se revisa; nunca aprueba la salida);
   - generalización de cuasi-identificadores.
6. **Paso B, ID → identidad:** cada marcador se dibuja con la identidad falsa de esa persona, en la forma que guardó.
7. **Barrido final** con la lupa del juez.
8. **Emitir** los 4 archivos y un `entities.json` honesto.

### 3.2 Extracción por tipo de fuente (ya construida)
| Fuente | Método | Archivo |
|---|---|---|
| Chats | Mensaje → `id`, `thread_id` (`canal:ts del primer mensaje`), `author` (nombre de `users.json`), `ts`, `text`, `attachments`. Internamente guarda uid del autor, uids mencionados, reacciones y editor | `src/extract/index.ts` |
| PDF | Lector propio: descomprime, lee líneas con posición y tamaño; 16 → `#`, 13 → `##`; celdas por rectángulo → tabla markdown; líneas justificadas → párrafo; metadatos del `/Info` | `src/extract/pdf.ts` |
| HTML | A markdown conservando comentarios, enlaces con `mailto:` y bloques ocultos; `<meta>` → `metadata` | `src/extract/html.ts` |
| Markdown | Tal cual con front matter; claves del front matter → `metadata` | `src/extract/index.ts` |
| CSV | Lector propio con charset y separador declarados, comillas respetadas | `src/extract/texto.ts` |
| XML | Lector propio: atributos + hijos como columnas; atributos de hijos como `hijo_attr`; comentarios del archivo aparte | `src/extract/xml.ts` |

Verificación: la salida "espejo" (extraída y sin anonimizar) pasa el validador oficial con 2.028 + 26 + 6.243 registros.

### 3.3 Identidades persistentes
- Un **ID nunca se reasigna**. El registro de identidades solo crece: persona nueva = siguiente ID + identidad libre.
- Los **uids** también tienen identidad: uid real → persona → uid falso con el mismo formato (para reescribir `<@UID>`), fijo entre corridas.
- Respaldo si se pierde el disco: la identidad se puede recalcular desde el ancla (`CL-…`, `KP-…`, uid) con HMAC y una sal secreta.
- Los pools de nombres excluyen toda forma real del corpus (si no, el barrido global lo cuenta como fuga de otra persona) y no comparten palabras con el original.
- El registro (con originales) vive **solo** en el disco del servidor, nunca en el repo.

### 3.4 Dónde usamos Jev (TypeSafe)
Jev no genera texto: responde preguntas cerradas con probabilidad.
| Uso | Pregunta | Regla |
|---|---|---|
| ¿Misma persona? | `noul` con las dos menciones y su contexto | > 0,85 junta · < 0,15 separa · en medio = persona distinta (separar de más es más barato que fusionar) |
| ¿Qué es este nombre? | `choice`: persona / organización / lugar / marca / figura pública; y género | Solo para nombres que no están en ninguna tabla |
| Segunda red | `noul`: "¿este texto con IDs todavía identifica a alguien?" | Lo marcado se revisa; nunca aprueba |

Pendiente: `TYPESAFE_API_KEY` y costo. Se declara en `/health` (`models`) y en `DECISIONS.md`. Si Jev falla o tarda, se aplica la regla por defecto.

### 3.5 Decisiones y alternativas descartadas
| Decisión | Elegido | Descartado y por qué |
|---|---|---|
| Transformación | Dos pasos: real → ID → identidad | Reemplazo directo: no se puede verificar ni cambiar un seudónimo sin re-detectar |
| Identidad | Ancla estructurada + evidencia cruzada | Nombre como llave: fusiona homónimos |
| Persistencia | Registro append-only + respaldo HMAC | Aleatorio: rompe el 70 % post-cambio. Hash: es fuga |
| Modelo | Jev con umbrales solo en lo dudoso | LLM por registro: caro, no determinista; reglas solas ya dan ~88 |
| Texto | Reemplazo de pedazos, resto byte a byte | Reescritura con LLM: castiga utilidad |
| Stack | Node 26 + TypeScript sin build, lectores propios | Python: dos normalizaciones distintas a la del juez |
| Deploy | 1 proceso, Railway + volumen | Serverless o túnel: pierde estado; si cae, la corrida se gasta |

---

## 4. Plan para medir
| # | Métrica | Meta |
|---|---|---|
| M1 | Validador oficial sobre la muestra y el corpus | OK en cada deploy |
| M2 | Formas reales restantes tras el Paso A | 0 |
| M3 | Juez local en la muestra: recall de fuga contra el `entities.json` ideal, conservados intactos, parecido del texto | 100 % · 100 % · ≥ 0,98 |
| M4 | Entidades contra el ideal | 0 fusiones, 0 divisiones, homónimos separados, "reporta a" intacto |
| M5 | Persistencia: corrida sobre un subconjunto y luego sobre el total | 100 % de IDs e identidades viejas iguales |
| M6 | `/anonymize`: conocida / nueva / homónimos | misma / nueva / 2 distintas; p95 < 10 s |
| M7 | Costo y tiempo por corrida | < 10 min, cache hit ≥ 95 % en la 2.ª |

---

## 5. Plan de ejecución
| Bloque | Hora | Entregable | Estado |
|---|---|---|---|
| Design | → 12:00 | Doc de 1 página + diagrama | ✅ entregado |
| 0 · Arranque | 12:00–12:30 | Repo, `.gitignore`, hook de secretos, descarga, vigilante | ✅ |
| 1 · Aprender de la muestra | 12:30–13:15 | `knowledge/reglas.md` | ✅ |
| Extracción | | 3 tipos de fuente, salida espejo pasa el validador | ✅ |
| 2a · Registro + resolución | 13:10–14:15 | `P0001…` (185 base), homónimos y terceros con el porqué en `knowledge/resolucion.md` | ✅ registro + terceros; ⏭️ fusión de 9 uids pendientes |
| 2b · Paso A/B + barrido + cuasi-identificadores | 13:10–14:15 | 0 formas reales restantes, test "indirecta" en verde | ✅ barrido 0 fugas · muestra 13/13 |
| 2c · `entities.json` + juez local | 14:15–14:30 | reconciliación contra `sample/expected_output` | ✅ validador OK · 5/5 públicos · 13/13 muestra |
| 3 · Deploy + corrida 1 | → 14:45 | Servicio en Railway; **corrida 1 (60 %) antes de 14:45** | ⛔ bloqueado: no hay token de deploy |
| 4 · Mejorar con evidencia | 14:45–17:30 | Terceros (Jev), homónimos, metadatos, cuasi-identificadores, docs en inglés. Al llegar el cambio: reprocesar y comprobar persistencia | |
| 5 · Corrida 2 | ~17:30 | 75 %, solo tras confirmar el cambio (a más tardar 18:00) | |
| 6 · Corregir | 17:45–19:00 | Código congelado a las 19:00 | |
| 7 · Corrida 3 | 19:00–19:15 | 100 %, la que cuenta; no se toca el servicio después | |
| 8 · Entregables | 19:15–20:00 | README, `run.sh`, `DECISIONS.md`, transcripts de Pi, demo de 5 min | |

**Vigilante:** `scripts/vigilante.ts` en la laptop revisa `/record_index` cada 60 s con `If-None-Match` y anota en `vigilante.jsonl`; si cambia, alerta. Da la hora exacta del cambio para explicarlo.

**Tareas con criterio de aceptación:** ver [`PLAN-TAREAS.md`](PLAN-TAREAS.md) (T1–T10, ruta crítica y checklist antes de gastar cada corrida).

**Reglas de operación:** nunca probar el entrypoint desplegado mientras evalúan (estado compartido); secretos solo en `.env`; un force-push no borra el historial de GitHub.

---

## 6. Supuestos abiertos (se cierran con evidencia)
| # | Supuesto | Cómo se cierra |
|---|---|---|
| A1 | Formato markdown del texto de los PDF (la muestra no trae PDF) | Detalle de la corrida 1 |
| A2 | Nombres de columnas XML (`documento_tipo`) | ✅ cerrado: PQRS trae `radicado, cliente_id, cedula, ciudad, fecha, agente, tipo, estado, descripcion, respuesta`; el atributo `tipo` de `<documento>` sale como columna `tipo` |
| A3 | Claves de metadata PDF en minúscula (`author`, `title`, `creationdate`…) | ✅ cerrado: confirmado en los 11 PDF (`author, creationdate, creator, subject, title, keywords`) |
| A4 | `<@UID>` se reemplaza por un uid falso | Tests de fuga oculta |
| A5 | `title` de los MD (la muestra lo trae sin el año) | Comparar con más ejemplos |
| A6 | Costo y latencia de Jev | Prueba con una llave |

---

## 7. Cómo correr lo que hay
```bash
cp .env.example .env               # pegar FUENTES_URL y FUENTES_TOKEN (nunca al repo)
node scripts/fetch.ts              # baja todo a fuentes/ y la muestra a sample/
caffeinate -i node scripts/vigilante.ts   # en otra terminal, durante todo el reto

./run.sh                           # extracción + inventario + anonimización + validador + barrido + tests
./run.sh --muestra                 # mismo pipeline sobre sample/, con sus 13 tests
./run.sh --bajar                   # descarga primero

# piezas sueltas
node scripts/inventario.ts         # quién es quién y dónde está cada forma real
node scripts/anonimizar.ts         # escribe output/ y entities.json
node scripts/barrido.ts            # 0 formas reales (usa la contiene() del juez)
node scripts/juez-local.ts fuentes/tests_public.json output
node ../frontier-reto-1/validar.mjs output --public fuentes
```

| Carpeta | Contenido | ¿Al repo? |
|---|---|---|
| `src/extract/` | Lectores por tipo de fuente | sí |
| `src/registro/` | Registro de personas y detección de terceros | sí (sin datos) |
| `src/anon/` | Normalización del juez, identidades, motor A/B | sí |
| `scripts/` | Descarga, vigilante, espejo, exploración | sí (sin datos reales) |
| `knowledge/` | Reglas aprendidas, sin PII | sí |
| `design/` | Doc y diagrama entregados | sí |
| `fuentes/`, `sample/`, `output/`, `data/`, `registro/` | Datos reales y estado con originales | **nunca** |
