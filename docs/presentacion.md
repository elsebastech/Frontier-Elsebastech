# Presentación — 8 slides

Texto listo para pegar. Cada slide: título, tres líneas y el dato que la sostiene.

## 1. Título
**Anonimización determinista con identidades estables**
Servicio que transforma un corpus con PII y devuelve el mismo corpus sin una sola persona real,
conservando la utilidad analítica.

> Repo público: github.com/elsebastech/Frontier-Elsebastech

## 2. El problema
- 8.297 registros: 2.999 mensajes, 34 documentos, 7.823 filas de tablas.
- La misma persona aparece en los tres, con nombre, cédula, correo y celular.
- A mitad del reto las fuentes cambian y el jurado compara el diccionario de identidades
  *antes* contra el de *después*.

> Si un seudónimo cambia, el trabajo se pierde. Ese es el juego.

## 3. Cómo funciona
1. Descarga y extracción: CSV latin-1 con `;`, XML, PDF, HTML, MD.
2. Personas: una por fila, anclada a su identificador de origen — **no al nombre**.
3. Reconciliación con el registro previo por cédula, correo, número de cliente.
4. Identidad falsa determinista: `HMAC(sal, ancla)` → nombre, correo, cédula, dirección, nacimiento.
5. Dos pasos: real → `⟦P00xx·tipo⟧` → identidad falsa.
6. Verificación independiente del motor.

## 4. Las cuatro decisiones que lo sostienen
- **Identidad por ancla:** si las fuentes reordenan o cambian el id, la persona conserva su seudónimo.
- **Homónimos no se fusionan sin evidencia:** cédula dictada, correo corregido, número de cliente,
  eliminación uno a uno.
- **Registro append-only:** quien desaparece conserva su identidad por si vuelve. Y dos filas con la
  misma cédula **y** el mismo contacto son el mismo humano: se colapsan conservando el seudónimo
  más antiguo.
- **Reparaciones documentadas:** si un seudónimo coincide con un nombre real que llegó después, se
  redibuja y queda en `registro/ajustes-identidad.json`.

## 5. Verificación (lo que se puede auditar)
| Comprobación | Resultado |
|---|---|
| Validador oficial del reto | OK |
| Barrido normalizado (tildes, confusables cirílicos, invisibles) | 0 fugas en 70.072 campos |
| Verificación literal con severidad | 0 fugas críticas · 6 colaterales (nombres de pila) |
| Tests públicos | 5/5 · 8/8 de peso |
| Consistencia contra la corrida 1 | 192/193 seudónimos intactos · 1 reparación explicada |
| Idempotencia | byte a byte entre corridas sobre la misma fuente |

> Las colaterales están separadas a propósito: "Sandra" suelto no identifica a nadie; "Sandra
> Peláez" con su cédula, sí.

## 6. Jev: verificación opcional
- El proceso es determinista; **Jev no decide datos**.
- Se usa como **compuerta de entrada**: antes de anonimizar se le manda *solo la forma* del conjunto
  (tablas, columnas, tipos, conteos, formatos — nunca un valor) y responde si el anonimizador aplica.
- Reglas primero: si falta nombres, identificador único o texto, el veredicto es `no` sin llamar al
  modelo.
- Sin Jev, o sin clave, el servicio corre igual. Su valor es evitar quemar una corrida sobre datos
  que no encajan.

## 7. Edge cases conocidos (y cómo se comportan)
- Números o correos **deletreados** ("siete dos dos"): los dictados con punto/arroba se sustituyen;
  los dígitos en palabras no se detectan.
- **Terceros sin nombre** ("la cuenta de él"): no hay dato que sustituir.
- **Documentos escaneados** sin capa de texto: el nombre en la imagen no se lee.
- **Formatos nuevos** (xlsx, docx, imágenes): no hay lector; el validador lo reporta como faltante.
- **Cuasi-identificadores** (barrio + ocupación + edad): el pipeline los generaliza; la vista en vivo
  del panel no.
- **Cédula compartida con contacto distinto:** se conservan separadas; el dato es ambiguo por origen.

> Declararlos es parte de la entrega: un sistema que dice dónde falla es más confiable que uno que
> promete no fallar.

## 8. Cierre
- Repo público con README, pipeline y panel: `github.com/elsebastech/Frontier-Elsebastech`.
- Panel de verificación en un comando: `./panel.sh`.
- Servicio público con `/health`, `/run`, `/anonymize`, `/output`, `/entities`.
- Todo el proceso determinista y reproducible: la misma fuente da la misma salida, byte a byte.
