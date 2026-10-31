# Compuerta de entrada (preflight con Jev)

Antes de anonimizar, el servicio pregunta: **¿este conjunto se puede anonimizar con este proceso?**
Si la respuesta es no, el `/run` falla con un motivo legible en vez de producir una salida a medias.

## Qué se le manda al modelo

Solo la **forma** de los datos, nunca un valor:

```
forma:       tablas → filas + [columna:tipo]        tipos: digitos|correo|fecha|url|texto_corto|texto_largo|vacio
             documentos → total + conteo por formato
             conversaciones → mensajes + autores con nombre
             índice de registros → sí/no
requisitos:  lo que las reglas ya comprobaron (5 banderas)
```

Por eso puede correr sobre datos reales sin filtrar PII: el estado es un resumen de esquema.

## Quién decide qué

1. **Las reglas primero** (`evaluarRequisitos`). Si falta algo indispensable —nombres de personas,
   identificador único por fila, o texto que anonimizar— el veredicto es `no` y no se llama al modelo.
   Ese caso se resuelve en 0,1 s y sin costo.
2. **Jev después**, solo cuando las reglas están completas o dudosas. Pregunta binaria:
   «¿se puede anonimizar el conjunto completo?». Con las reglas completas, `p(si) ≥ 0,5` confirma
   (`si`); por debajo, se corre igual pero con aviso (`con_riesgo`).

## Zonas de decisión

| Veredicto | Cuándo | Efecto |
|---|---|---|
| `no` | las reglas no encuentran nombres, identificador o texto | el `/run` falla, no se gasta corrida |
| `con_riesgo` | reglas completas pero el modelo no acompaña | corre con aviso en el job |
| `si` | reglas completas y el modelo acompaña | corre limpio |

El umbral alto (0,85) solo se usa para bloquear un `no` que venga del modelo sin evidencia: un `no`
con p < 0,85 no frena el servicio, se registra y se corre.

## Requisitos que evalúa

| Bandera | Cómo se comprueba |
|---|---|
| `tabla_con_nombres` | alguna tabla tiene columna con `nombre\|name\|apellido` y tipo `texto_corto` |
| `autores_con_nombre` | ≥40 % de los autores distintos del chat parecen nombre propio (2-3 palabras capitalizadas) |
| `identificador_unico` | alguna columna tiene `unicos ≥ 90 % de filas` y es dígitos, correo o texto corto |
| `texto_extraible` | ≥50 % de los documentos en formato con texto (md/html/pdf con texto), o hay autores con nombre |
| `indice_registros` | existe `record_index.json` en la raíz, en el job o en su carpeta `fuentes/` |

`indice_registros` es aviso, no bloqueo: sin índice puede faltar un registro y el validador lo notará,
pero el conjunto sigue siendo anonimizable.

## Dónde vive

- `src/jev/preflight.ts` — forma del conjunto, requisitos, veredicto.
- `scripts/preflight.ts` — CLI: `node scripts/preflight.ts [--dir data] [--json]`, código 0 si corre, 2 si no.
- `src/servicio/server.ts` — paso `preflight` entre extracción y anonimización; el veredicto viaja en
  `/run/{id}` y el panel lo pinta.

## Casos probados

| Conjunto | Veredicto | Origen |
|---|---|---|
| Fuentes reales (203 clientes, 2.999 chats, 34 docs) | `si`, p=0,82 | jev, reglas completas |
| Sintético sin nombres, sin identificador, docs vacíos (`pruebas/preflight-malo`) | `no`, rc=2 | reglas |

## Cuándo NO usar la compuerta

Para decidir si dos registros son la misma persona. Ahí el modelo no ve los datos y no aporta:
eso se resuelve por cédula, correo, número de cliente o eliminación 1 a 1 (`src/registro/resolver.ts`).
