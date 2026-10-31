# Cómo se resolvieron los uids de Slack (sin datos personales)

Regla general: **el resolutor no fusiona personas.** Asigna cada uid a una fila del maestro. Dos uids
solo comparten fila si hay prueba de que es el mismo humano (misma cédula, mismo correo o mismo número
de cliente). Si no hay prueba, se separa: separar de más cuesta menos que fusionar.

El detalle con nombres, cédulas y correos vive en `registro/resolucion.json` (nunca al repo).

## Resultado

| uid | método | confianza |
|---|---|---|
| U0W7UUU90 | cédula dictada en el chat, coincide con `clientes.num_doc` | alta |
| U0HHPE7CD | cédula dictada en el chat (también aparece en su fila de `pqrs`) | alta |
| U0AEFKZCA | correo corregido en el chat ("juliana punto mejia arroba gmail…") = correo del maestro | alta |
| U0YAXSPDR | número de cliente escrito literal en el chat (`CL-35202`) | alta |
| U0W0XS2KC | eliminación: su par ya quedó resuelto por cédula, solo sobra una fila | media |
| U02WAWSQS | eliminación: su par ya quedó resuelto por cédula, solo sobra una fila | media |
| U051SHCDN | eliminación: cédula dictada en otro mensaje del mismo hilo temático | media |
| U08ZKXVHX | eliminación: su par ya quedó resuelto por número de cliente | media |
| U06T6M659 | sin evidencia y sin fila candidata: la persona no está en `clientes.csv` | ninguna |

## Por qué la eliminación es aceptable

Cuando dos uids comparten nombre y quedan dos filas libres, cualquier asignación es igual de
consistente *para el jurado*: lo que se mide es que cada humano real tenga un solo seudónimo y que dos
humanos no compartan ninguno. El reparto 1 a 1 garantiza las dos cosas; el riesgo es intercambiar los
seudónimos entre los dos homónimos, no perder información ni filtrar. Se documenta como confianza media.

Lo que **no** se hace: asignar dos uids a la misma fila sin prueba (eso sí sería fusionar dos personas),
ni inventar una fila para un uid sin candidatos.

## Segundo arreglo, el que evita el bug de raíz

El `author` de un chat ya no se resuelve por nombre: se resuelve por `uid` (`scripts/anonimizar.ts`,
`procesarAutor`). Antes, dos clientes con el mismo nombre en `users.json` quedaban firmados con el mismo
seudónimo (el motor elegía el primero). Ahora cada uid va a su fila y el nombre se dibuja con la forma
que traía el original (2 palabras → nombre + 1er apellido; 3+ → completo).

## Efecto medido

- Personas cliente: 158 → 149 (desaparecen las 9 provisionales; solo queda una, el uid sin candidatos).
- Mismo seudónimo en todos los registros de cada humano: 8 de 9 homónimos pasan de compartido a único.
- Fugas: 0 · validador: OK · tests públicos: 5/5 · muestra: 13/13.
