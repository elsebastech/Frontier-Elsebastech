# Inventario de lo que hay que anonimizar

Generado por `node scripts/inventario.ts` el 31/10/2026, 17:1 (1 s).
Sin datos personales: solo conteos. El detalle con originales vive en `registro/inventario.json` (nunca al repo).

## Registros
chats 2999 · docs 34 · tablas 7823 · **total 10856**

## Personas
**245** personas con ID asignado: 203 clientes, 42 empleados, 0 terceros.
Género: 116 f · 128 m · 1 sin evidencia.

| Liga a Slack | Personas |
|---|---|
| correo | 138 |
| sin_liga | 30 |
| nombre | 72 |
| nombre+1apellido | 5 |

Personas sin ninguna mención fuera de su fila del maestro: **2** (igual llevan seudónimo).

## uids de Slack sin persona resuelta
**18** uids quedan pendientes de evidencia (2+ candidatos con el mismo nombre, o ninguno).
No se les inventa persona: se resuelven con la evidencia del texto (radicado, monto + fecha, cédula dictada).
- `U0YN91VJN` con 2 candidato(s) en el maestro
- `U0W0XS2KC` con 2 candidato(s) en el maestro
- `U0W7UUU90` con 2 candidato(s) en el maestro
- `U0HHPE7CD` con 2 candidato(s) en el maestro
- `U02WAWSQS` con 2 candidato(s) en el maestro
- `U0YDE69RK` con 2 candidato(s) en el maestro
- `U06T6M659` con 0 candidato(s) en el maestro
- `U051SHCDN` con 2 candidato(s) en el maestro
- `U0AEFKZCA` con 2 candidato(s) en el maestro
- `U08ZKXVHX` con 2 candidato(s) en el maestro
- `U0YAXSPDR` con 2 candidato(s) en el maestro
- `U0YJTCEFP` con 2 candidato(s) en el maestro
- `U0J5EDBNV` con 2 candidato(s) en el maestro
- `U05ZHY1T8` con 2 candidato(s) en el maestro
- `U0J3K13AD` con 2 candidato(s) en el maestro
- `U0W1Q801T` con 2 candidato(s) en el maestro
- `U00LJXJTA` con 2 candidato(s) en el maestro
- `U0NGQDXGW` con 2 candidato(s) en el maestro

## Formas reales encontradas
**5921** menciones en total.

| Tipo de forma | Menciones |
|---|---|
| nombre_completo | 2722 |
| nombre | 1013 |
| nombre_apellido | 685 |
| correo | 409 |
| cedula | 394 |
| celular | 345 |
| nacimiento | 271 |
| direccion | 65 |
| uid | 17 |

| Campo | Menciones |
|---|---|
| `chats.author` | 2796 |
| `chats.text` | 1306 |
| `tables.columns.correo` | 269 |
| `tables.columns.celular` | 269 |
| `tables.columns.fecha_nacimiento` | 269 |
| `tables.columns.num_doc` | 227 |
| `docs.body` | 205 |
| `tables.columns.nombre_completo` | 203 |
| `tables.columns.direccion` | 52 |
| `tables.columns.cedula` | 47 |
| `tables.columns.nombre` | 42 |
| `tables.columns.documento` | 42 |
| `tables.columns.reporta_a` | 41 |
| `tables.columns.agente` | 38 |
| `tables.comentarios` | 38 |
| `tables.columns.descripcion` | 28 |
| `chats.attachments.filename` | 17 |
| `docs.metadata.author` | 10 |
| `docs.metadata.asistentes` | 7 |
| `docs.filename` | 4 |
| `tables.columns.notas` | 3 |
| `docs.metadata.subject` | 2 |
| `docs.metadata.reportado_por` | 1 |
| `docs.title` | 1 |
| `docs.metadata.title` | 1 |
| `docs.metadata.revisado_por` | 1 |
| `docs.metadata.grabacion` | 1 |
| `docs.metadata.elaborada_por` | 1 |

Cobertura: **3159 de 10856** registros tienen al menos una mención.

## PII que no pertenece a ninguna persona del registro
correos 4 · celulares 0 · cédulas 6
Son candidatos a tercero (persona nueva con ID nuevo) o a falso positivo que hay que conservar.

## Formas que no viven en el maestro
| Tipo | Cuántas | Qué implica |
|---|---|---|
| placa en texto | 5 | seudónimo de placa por persona, mismo formato |
| pasaporte | 1 | seudónimo propio, fijo entre corridas |
| mensajes con dirección | 20 | otro inmueble, mismo formato |
| adjuntos con token de nombre | 39 | se reemplaza el token dentro del nombre de archivo |

## Nombres de pila compartidos
95 primeros nombres los usan 2+ personas → la forma "solo nombre" no se puede reemplazar a ciegas.
