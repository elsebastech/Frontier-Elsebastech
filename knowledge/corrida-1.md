# Corrida 1 — qué va a pasar, en orden

## Antes de gastarla (checklist de 8 minutos)

1. **Servicio arriba en local**: `node src/servicio/server.ts` (ya corre en :8080).
2. **URL pública**: `cloudflared tunnel --url http://localhost:8080` (sin cuenta) o `ngrok http 8080`.
   Comprobarla **desde fuera**: `curl https://<url>/health` → `{"status":"ok",...}`.
   Si no responde desde fuera, no se gasta corrida.
3. **Prueba en vivo de `/anonymize`** con los tres casos (conocida → misma identidad, nueva → nueva,
   homónima → otra): 2 segundos, no gasta corrida.
4. **Copia del estado**: `cp -r registro registro-previa` (es la referencia del 70 % post-cambio).
5. **Vigilante** corriendo y en `igual`; **nadie** más probando el entrypoint.

## Qué gasta y qué no

- Descargar datos: no gasta.
- `POST /run` (nuestro servicio): **no** gasta corrida; es solo nuestro pipeline.
- Pulsar **VALIDAR ENTRYPOINT** en `/evento/reto`: **eso** gasta. Hay 3 en todo el día.

Por eso el orden: nosotros disparamos `/run`, verificamos la salida, y solo entonces el jurado pulsa.

## Secuencia

```
1  POST /run {sources_url, token}      → job_id
2  GET  /run/{job_id}                  → queued → running → done (~30 s: descarga 26 s + pipeline 2 s)
3  revisar counts: chats 2.028 · docs 26 · tables 6.243
4  GET  /output/entities.json          → ~190 personas + conservados
5  copiar a registro/foto-previa.json  → referencia de consistencia
6  VALIDAR ENTRYPOINT (60 %)           → 1 de 3 corridas
```

## Criterio de "no la gastes si…"

- `/health` no responde desde fuera, o responde sin `models`.
- `/anonymize` tarda más de 10 s o devuelve el nombre real.
- El barrido del job deja `fugas > 0`.
- El vigilante dice que las fuentes cambiaron y todavía no re-procesamos.

## Después de la corrida 1, antes de la 2 (esto es el 70 %)

| Tarea | Por qué |
|---|---|
| Migrar el mapa de identidades de `entity_id` a `ancla` | si el cambio de fuentes reordena filas, un ID desplazado recibiría la identidad de otra persona y se cae la consistencia |
| Ligar persona vieja ↔ identificador nuevo por cédula/celular/uid antes que por nombre | regla explícita del cambio de fuentes |
| Placas, pasaporte y direcciones sin dueño → identificador del autor | hoy quedan literales |
| Jev (`typesafe/jev-1.14` vía OpenRouter) en las 3 preguntas cerradas | desempatar homónimos nuevos y segunda red; nunca bloquea |
| Re-procesar tras el cambio y comparar `registro/foto-previa.json` | M5, vale el 70 % |

## Riesgo aceptado

Un túnel desde la laptop cae si la máquina duerme, cambia de red o se cierra la terminal: si eso pasa
durante una evaluación, la corrida se gasta sin puntaje. Mitigación: `caffeinate -i`, túnel en su
propia terminal, y migrar el mismo `server.ts` a cloud en cuanto esté (el código no cambia, solo el host).
