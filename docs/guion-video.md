# Guion del video (2 minutos)

Grabación de pantalla sobre el panel: `https://hermes-server.tail50aa65.ts.net/panel`
(para local: `./panel.sh` e ir a la URL que imprime).

Regla de oro: no cortar nunca la vista de la tabla de cambios. Es lo que prueba el punto.

| Tiempo | Qué se ve | Qué se dice |
|---|---|---|
| 0:00–0:15 | El panel completo, sin scroll | "Ocho mil doscientos noventa y siete registros: conversaciones, documentos y tablas. La misma persona aparece en los tres, con nombre, cédula, correo y celular." |
| 0:15–0:30 | Zoom al bloque 1 | "Este servicio devuelve el mismo corpus con identidades falsas, y la misma persona recibe siempre el mismo seudónimo." |
| 0:30–0:50 | Pegar el registro de ejemplo y pulsar *Anonimizar* | "Pego un registro suelto: nombre, cédula, celular, correo y el nombre dentro del adjunto. Un clic." |
| 0:50–1:05 | Comparativo con los tramos resaltados y la tabla campo por campo | "Arriba el original, abajo el anonimizado con cada reemplazo marcado. Abajo, campo por campo: autor, texto, adjunto." |
| 1:05–1:20 | *Anonimizar* otra vez con el mismo texto, y luego con una persona inventada | "El mismo texto otra vez devuelve el mismo seudónimo. Una persona que no existe en el maestro recibe una identidad nueva, y esa identidad queda registrada." |
| 1:20–1:40 | Terminal: `node scripts/demo.ts`, caso 4 | "Dos personas distintas que se llaman igual reciben seudónimos distintos. El nombre no es la llave: la llave es el identificador de origen." |
| 1:40–2:00 | *Correr pipeline*, pasos encendiéndose, conteos y comparativo | "El pipeline completo: descarga, extracción, compuerta de entrada, anonimización y verificación. La compuerta pregunta primero si este conjunto se puede anonimizar; si no, no corre." |
| 2:00 | Cierre en el panel | "Cuando las fuentes cambian, las personas conocidas conservan su seudónimo: 192 de 193. La única que cambió fue reparada porque su seudónimo coincidía con el nombre real de un cliente nuevo." |

## Dos frases que valen todo el video

- "El nombre no es la llave; la llave es el identificador de origen." (explica por qué no se fusionan homónimos)
- "La compuerta decide antes de gastar la corrida." (explica el preflight con Jev)

## Antes de grabar

```bash
./panel.sh                 # local, con token incluido en la URL
# o el servidor: https://hermes-server.tail50aa65.ts.net/panel
node scripts/demo.ts       # dejar la terminal lista con los 5 casos
```

Si el panel se abre sin token, escríbelo en el campo de arriba a la derecha: sin él, la corrida y el
comparativo responden 401.
