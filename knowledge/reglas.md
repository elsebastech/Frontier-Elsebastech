# Reglas aprendidas de la exploración (sin PII)

Fuente de cada regla: **[M]** = muestra (`sample/expected_output`), **[C]** = corpus real (`scripts/explorar*.py`), **[E]** = enunciado.
Confianza: *confirmado* (lo muestra la salida ideal) / *supuesto* (decisión nuestra, a validar con las corridas).

## Formato de salida
| # | Regla | Fuente | Confianza |
|---|---|---|---|
| F1 | `author` del chat = `real_name` de users.json, seudonimizado; el bot (`Kipi`) se conserva tal cual | M | confirmado |
| F2 | `thread_id` = `<canal>:<thread_ts o ts del primer mensaje>` | M, E | confirmado |
| F3 | `attachments` = `[{filename}]` con el nombre anonimizado como texto | M | confirmado |
| F4 | MD: `body` conserva el front matter; `metadata` = claves del front matter como texto | M | confirmado |
| F5 | MD: `title` = el título **sin el año** ("Memo cierre de julio 2026" → "Memo cierre de julio") | M | por entender: puede venir de otra regla |
| F6 | Tablas: `columns` con todas las columnas originales, valores como texto; `cliente_id` intacto | M | confirmado |
| F7 | XML (pqrs, empleados): columnas = atributos + hijos; el atributo `tipo` de `<documento>` → nombre de columna desconocido | C | supuesto |
| F8 | `<@UID>` en texto: se reemplaza por un uid seudónimo del mismo formato | C | supuesto |
| F9 | Entidades `kept` llevan `records: []` y `reason` | M | confirmado |

## Seudónimos (cómo se ve la salida ideal)
| # | Regla | Fuente |
|---|---|---|
| S1 | Nombre por nombre del mismo género; puede tener 2 nombres de pila. La identidad completa tiene nombre(s) + 2 apellidos | M |
| S2 | Formas en texto: *completo* (nombre + 2 apellidos) → completo; *nombre + 1er apellido* → nombre(s) + 1er apellido; *solo nombre* → nombre(s) de pila del seudónimo | M |
| S3 | Correo de cliente: `inicial+apellido@proveedor` (el proveedor puede cambiar); correo corporativo: `nombre.apellido@kipupay.co` | M |
| S4 | Cédula: mismo largo, conserva los primeros 2–4 dígitos (región), resto distinto; en texto conserva el formato con puntos | M |
| S5 | Celular: 10 dígitos que empiezan por 3 | M |
| S6 | Fecha de nacimiento y dirección: otras, mismo formato | M |
| S7 | Nombre en archivo: `extracto_<nombre_apellido>_julio.pdf` → minúsculas, sin tildes, `_` entre palabras | M |
| S8 | Empleado que solo aparece por nombre recibe solo `name` (+ `email` si su correo aparece) | M |

## Cuasi-identificadores
| # | Regla | Fuente |
|---|---|---|
| Q1 | En `clientes.csv`: `ocupacion` → sector ("profesional de …") **siempre**; `barrio` → otro barrio de la misma ciudad; `ciudad` y `fecha_vinculacion` intactas | M |
| Q2 | En texto: ocupación → sector, barrio → ciudad, año → "hace unos años", reemplazo literal sin arreglar gramática ("en hace unos años") | M |
| Q3 | Las 149 combinaciones (ciudad, barrio, ocupación, año) del corpus son únicas → generalizar siempre, no por umbral k | C |
| Q4 | El test "indirecta" revisa que los 3 componentes no co-ocurran en el registro **ni en la fila del maestro** (`join_records`) | M |

## Entidades y resolución
| # | Hallazgo | Fuente |
|---|---|---|
| R1 | No hay homónimos exactos en clientes.csv; sí 6 pares con mismo nombre + 1er apellido y distinto 2.º apellido | C |
| R2 | users.json: 149 clientes, 36 empleados, 1 bot, 1 borrado. Clientes ligables por correo 77, por nombre único 59, **13 sin liga directa** (users trae solo "nombre + 1er apellido" y sin correo; 10 son homónimos de 2 candidatos) | C |
| R3 | 4 empleados tienen el mismo nombre + 1er apellido que un cliente (la "agente que se llama igual que una clienta") | C |
| R4 | users.json recorta el nombre de algunos empleados frente a empleados.xml | C |
| R5 | `reporta_a` usa "nombre + 1er apellido" del jefe | C |
| R6 | Handles: `@nombre.apellido` en front matter y `agente="nombre.apellido"` en pqrs | C |
| R7 | Lo que nombra a una persona fuera del texto: metadata PDF (`Author`, `Title`, `Subject` con correo), `<meta name=author>`, comentarios HTML con correo, URL con nombre, nombres de archivo de docs y adjuntos | C |
| R8 | El bot dice el nombre del cliente en MAYÚSCULAS ("cuenta a nombre de …") y el del agente en el handoff ("Te atiende …") | C |
| R9 | Correos deletreados ("x arroba gmail punto com"): 8 mensajes; placas en texto y en nombre de adjunto; 1 pasaporte | C |
| R10 | Muchos apellidos compartidos (un mismo apellido en clientes y empleados) → nunca reemplazar un apellido suelto sin resolver a la persona | M, C |
| R11 | Las descripciones de transacciones traen comercio + barrio ("Compra <comercio> <barrio>") → organización/lugar, se conserva | C |
| R12 | PDF: generados por "Kipu Docs 1.4", 1 página, stream FlateDecode con `Tj` en Latin-1 → extractor propio viable | C |
