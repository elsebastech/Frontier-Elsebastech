// Jev como último recurso: SOLO para los uids que las reglas no pudieron resolver con evidencia.
// Si las reglas ya decidieron con prueba (cédula, correo, número de cliente), este script no toca nada.
//
// Uso: node scripts/jev-resolver.ts [--aplicar]
//   sin --aplicar: muestra qué respondería Jev (no modifica nada)
//   con --aplicar: escribe registro/resolucion.json con las decisiones que superen el umbral
//
// Qué se le envía (esto es lo que preguntabas):
//   state = { mensajes: [lo que escribió esa cuenta], candidatos: { "CL-xxx": {perfil del maestro} } }
//   question tipo choice con una opción por candidato + "ninguno"
//   Se acepta solo si la probabilidad de la opción ganadora ≥ 0.85. Si duda, se queda como está.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { decidir, type PreguntaChoice } from "../src/jev/cliente.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const dirRegistro = process.env.REGISTRO ?? "registro";
const aplicar = process.argv.includes("--aplicar");
const UMBRAL = 0.85;

const reg = JSON.parse(readFileSync(`${dirRegistro}/personas.json`, "utf8")).personas as any[];
const chats = readFileSync("data/extraccion/chats.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const resolucionPath = `${dirRegistro}/resolucion.json`;
const resolucion = existsSync(resolucionPath) ? JSON.parse(readFileSync(resolucionPath, "utf8")) : { decisiones: [], conflictos: [] };

// Candidatos de Jev: decisiones que no son de confianza alta.
const pendientes = (resolucion.decisiones as any[]).filter((d) => d.confianza !== "alta");

const porAncla = new Map(reg.filter((p) => p.ancla?.startsWith("CL-")).map((p) => [p.ancla, p]));
const mensajesDe = (uid: string) =>
  chats.filter((c) => c._uid === uid).map((c) => String(c.text ?? "").slice(0, 400)).slice(0, 6);

// Índice del maestro por nombre: los candidatos de un uid son TODAS las filas con ese nombre.
const filas = readFileSync("data/extraccion/tables.jsonl", "utf8").split("\n").filter(Boolean)
  .map((l) => JSON.parse(l)).filter((t) => t.table === "clientes");
const norm = (s: string) => (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const porNombre = new Map<string, string[]>();
const porDos = new Map<string, string[]>();
for (const f of filas) {
  const n = norm(f.columns.nombre_completo ?? "");
  const dos = n.split(" ").slice(0, 2).join(" ");
  porNombre.set(n, [...(porNombre.get(n) ?? []), f.columns.cliente_id]);
  porDos.set(dos, [...(porDos.get(dos) ?? []), f.columns.cliente_id]);
}
const candidatosDe = (nombre: string): string[] => {
  const n = norm(nombre);
  const exactos = porNombre.get(n) ?? [];
  if (exactos.length) return exactos;
  return porDos.get(n.split(" ").slice(0, 2).join(" ")) ?? [];
};

const resultados: any[] = [];
for (const d of pendientes) {
  const candidatos: string[] = candidatosDe(d.nombre ?? "");
  if (candidatos.length < 2) {
    resultados.push({ uid: d.uid, decision: "sin candidatos suficientes para Jev", antes: d.ancla });
    continue;
  }
  const mensajes = mensajesDe(d.uid);
  const estado = {
    mensajes,
    candidatos: Object.fromEntries(candidatos.map((a) => {
      const p = porAncla.get(a);
      return [a, {
        nombre: p?.nombre, ciudad: p?.ciudad, ocupacion: p?.ocupacion,
        correo: p?.correo, cedula: p?.cedula, nacimiento: p?.nacimiento, barrio: p?.barrio,
      }];
    })),
  };
  const preguntas: Record<string, PreguntaChoice> = {
    titular: {
      type: "choice",
      instructions:
        "Las `mensajes` las escribió una sola cuenta de Slack. Decide cuál de los `candidatos` es esa persona, " +
        "usando solo lo que la persona dice de sí misma (cédula, correo, ocupación, ciudad, barrio, número de cliente). " +
        "Si los mensajes no alcanzan para distinguir entre los candidatos, elige `ninguno`.",
      criteria: {
        ...Object.fromEntries(candidatos.map((a) => [a, `La persona que escribe es la del maestro ${a}`])),
        ninguno: "Los mensajes no permiten distinguir entre los candidatos",
      },
    },
  };
  const r = await decidir(estado, preguntas);
  if (!r) {
    resultados.push({ uid: d.uid, decision: "Jev no disponible (sin red, timeout o sin clave)", antes: d.ancla });
    continue;
  }
  const a = r.respuestas.titular;
  const prob = a?.probabilities?.[a.choice] ?? a?.confidence ?? 0;
  const aceptado = !!a && a.choice !== "ninguno" && prob >= UMBRAL;
  resultados.push({
    uid: d.uid, antes: d.ancla, jev: a?.choice, probabilidad: Number(prob.toFixed(3)),
    aceptado, aplicado: false, de_cache: r.de_cache,
  });
  if (aceptado && aplicar) {
    d.ancla = a.choice;
    d.metodo = "jev";
    d.confianza = "alta";
    d.detalle = `Jev eligió ${a.choice} con p=${prob.toFixed(3)} sobre ${candidatos.length} candidatos`;
    resultados[resultados.length - 1].aplicado = true;
  }
}

if (aplicar) {
  writeFileSync(resolucionPath, JSON.stringify({ ...resolucion, jev: { generado: new Date().toISOString(), umbral: UMBRAL } }, null, 1));
}

console.log(JSON.stringify({
  modo: aplicar ? "aplicar" : "solo consulta",
  umbral: UMBRAL,
  pendientes: pendientes.length,
  decididas_por_jev: resultados.filter((r) => r.aceptado).length,
  resultados,
}, null, 1));
