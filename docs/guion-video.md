# Guion del video (2 minutos)

Grabación sobre el panel. En local: `./panel.sh` y la URL que imprime.
En el servidor: `https://hermes-server.tail50aa65.ts.net/panel` (el token va en el campo de arriba
a la derecha; sin él, la corrida responde 401).

Regla de oro: la cámara no se mueve de la tabla de cambios mientras se explica. Es la prueba.

| Tiempo | Qué se ve | Qué se dice |
|---|---|---|
| 0:00–0:12 | El panel entero, sin tocar nada | "Ocho mil doscientos noventa y siete registros: conversaciones, documentos y tablas. La misma persona aparece en los tres." |
| 0:12–0:25 | Bloque 1 | "Este servicio devuelve el mismo corpus con identidades falsas, y la misma persona recibe siempre el mismo seudónimo." |
| 0:25–0:40 | Desplegable de ejemplos, elegir **Chat con un tercero mencionado y su celular**, pulsar *Anonimizar* | "Uso un mensaje real del corpus. Aquí hay tres personas: el autor, alguien que solo se menciona y el celular de ese alguien." |
| 0:40–1:00 | Comparativo con tramos resaltados y la tabla de tramos | "El autor, el tercero y el número, cada uno con su reemplazo. El prefijo +57 y el formato se conservan." |
| 1:00–1:15 | Elegir **Empleado con jefe en el organigrama**, *Anonimizar* | "Una fila de tabla: nombre, documento, correo, celular… y su jefe, que es otra persona. Cinco tramos." |
| 1:15–1:32 | Elegir **Chat + fila del mismo cliente** | "La misma persona en dos fuentes: mismo seudónimo en las dos. Eso es lo que mide el jurado cuando cambian los datos: 192 de 193 seudónimos intactos." |
| 1:32–1:48 | Bloque 2: *Correr pipeline*, pasos encendiéndose | "El pipeline completo: descarga, extracción, compuerta de entrada, anonimización, verificación. La compuerta decide antes de gastar la corrida." |
| 1:48–2:00 | Bloque 3: consideraciones | "Y aquí está lo que puede fallar: números deletreados, documentos escaneados, formatos nuevos. Declararlo es parte del trabajo." |

## Dos frases que valen todo el video

- "El nombre no es la llave; la llave es el identificador de origen." (explica por qué no se fusionan homónimos)
- "La compuerta decide antes de gastar la corrida." (explica el preflight con Jev)

## Antes de grabar

```bash
./panel.sh                 # panel local, con token incluido en la URL
# o el servidor: https://hermes-server.tail50aa65.ts.net/panel
node scripts/demo.ts       # opcional: los 5 casos en terminal, para el corte de homónimos
```

Los ejemplos reales del desplegable solo aparecen en local: se generan con `node scripts/ejemplos.ts`
y no se publican en el servidor. Si el panel se abre sin token, escríbelo en el campo de arriba a la
derecha; sin él, la corrida y el comparativo responden 401.
