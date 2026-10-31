# Casos borde y cambios de reglas

Qué pasa hoy, qué se arregló y qué queda abierto. Sin datos personales.

## Encontrados por el protocolo de pruebas (ya arreglados)

| Escenario | Síntoma | Arreglo |
|---|---|---|
| Emoji o cualquier carácter fuera del BMP dentro del texto | el mapa de posiciones se desalineaba y el reemplazo caía un carácter corrido (`ldiaz` → se reemplazaba `diaz`), corrompiendo el texto y dejando la forma real pegada | `analizar()` registra una entrada del mapa por unidad UTF-16 del carácter normalizado |
| Cédula con puntos en la fila del maestro | la identidad falsa se generaba de 13 dígitos porque se medía el largo de la cadena, no de los dígitos | el largo se mide sobre `\D` quitados |
| Formato de cédula | si una persona aparecía con puntos en un chat, TODAS sus cédulas salían con puntos, incluso la columna `num_doc` que venía sin ellos | el formato se decide por aparición, no por persona (`cedula` vs `cedula_dots`) |
| Fecha de nacimiento falsa igual a la fecha real de otra persona | el barrido del jurado la cuenta como fuga de la primera | las fechas reales entran en `prohibidas` y las fechas falsas en el set de usados |
| Fila nueva en el maestro con un nombre que ya existe | la fila se quedaba con el seudónimo del homónimo viejo | cada fila se ancla a su propia persona (`personaDeFila`); el texto se usa solo si el valor no coincide |
| Autor de un chat con nombre repetido | los dos homónimos quedaban firmados igual | el autor se resuelve por `uid`, no por nombre |
| Placa, pasaporte, dirección, celular o cédula que no pertenecen a nadie del registro | quedaban literales en la salida | pasada de "huérfanos": reemplazo determinista por HMAC que conserva el formato, y entidad `identifier` en el diccionario |
| Persona vieja con otro `cliente_id` tras el cambio de fuentes | se habría creado una persona nueva y el seudónimo habría cambiado (70 %) | reconciliación con el registro anterior por ancla → cédula → correo → nombre completo único; el ancla original manda |
| Identidad guardada por `entity_id` | si el orden de filas cambiaba, un ID desplazado recibía la identidad de otra persona | el mapa de identidades se indexa por `ancla` (migración automática de archivos viejos) |

## Abiertos (decididos, pendientes de código)

| Escenario | Riesgo | Qué hacer |
|---|---|---|
| Dos uids con la misma cédula dictada | hoy el resolutor lo marca como conflicto y deja uno pendiente | permitir 2 uids → 1 persona cuando hay prueba (misma cédula o mismo correo) |
| Apellido suelto en el texto ("Mejía") | no se reemplaza (a propósito: un apellido suelto no identifica y suele ser lugar) | si el jurado lo exige, se resuelve solo cuando el apellido coincide con el de la persona del registro de ese mensaje |
| Cuasi-identificador "año" en el texto | "cliente desde 2025" quedaba literal | ✅ arreglado: se generaliza a "hace unos años" solo con palabra de vinculación delante (cliente, vinculado, llevo…); los años de una transacción no se tocan |
| Formato de fuente nuevo (xlsx, docx, imagen) | la extracción no lo conoce → faltarían registros y el validador falla | un lector genérico que vuelque el contenido a texto y lo pase por el mismo motor |

## Si cambian las reglas del juego

El diseño aguanta cambios porque casi todo sale de los datos, no de listas fijas:

| Cambio posible | Qué se toca |
|---|---|
| Conservar fechas u otro campo que hoy se anonimiza | una línea en `formasDe()` |
| Anonimizar bancos/marcas (hoy conservadas) | mover entradas de `CONSERVADAS` a personas/terceros |
| Exigir seudónimos "lejos" por distancia de edición | el generador ya evita colisiones; añadir una distancia mínima es una condición más en el bucle |
| Nuevo campo obligatorio en la salida | el extractor (`src/extract`) y el emisor (`scripts/anonimizar.ts`) están separados: un cambio en cada lado |
| Nuevo tipo de identificador (pasaporte, placa, IP) | `Identidad` ya tiene el campo; falta declararlo en `formasDe()` y en el dibujo |
| Otro límite para `/anonymize` | es el mismo pipeline por lote, no un camino aparte |
| Que el índice de registros cambie de forma | el emisor usa el `id` de origen tal cual |
| Que prohíban Jev/OpenRouter | el motor funciona 100 % por reglas; Jev solo desempata |
