// Protocolo de pruebas antes de cada corrida:
//   F1 replicación   — dos corridas sobre la misma fuente dan byte a byte lo mismo
//   F2 re-anonimizar — el proceso corre otra vez sobre SU PROPIA salida, sin romperse ni filtrar
//   F3 variantes     — datos "no exactamente iguales": confusables, invisibles, mayúsculas,
//                      homónimo nuevo en el maestro, PII solo en metadata, cédula en un filename
// Uso: node scripts/protocolo.ts   (escribe en pruebas/, no toca output/)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const RAIZ = process.cwd();
const PRUEBAS = "pruebas";
let fallos = 0;

function correr(script: string, env: Record<string, string>, args: string[] = []): string {
  return execFileSync("node", [script, ...args], {
    cwd: RAIZ, encoding: "utf8", stdio: "pipe", env: { ...process.env, ...env },
  });
}
function leerJsonl(ruta: string): any[] {
  return readFileSync(ruta, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}
function escribirJsonl(ruta: string, rs: any[]): void {
  mkdirSync(join(ruta, ".."), { recursive: true });
  writeFileSync(ruta, rs.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
const hash = (ruta: string) => createHash("sha256").update(readFileSync(ruta)).digest("hex").slice(0, 16);
function titulo(t: string) { console.log(`\n── ${t}`); }
function resultado(ok: boolean, msg: string) { console.log(`   ${ok ? "✓" : "✗"} ${msg}`); if (!ok) fallos++; }

rmSync(PRUEBAS, { recursive: true, force: true });
mkdirSync(PRUEBAS, { recursive: true });

// ─────────────────────────────────────────────────────────────────────
titulo("F1 · replicación: misma fuente, dos corridas");
correr("scripts/anonimizar.ts", { DATA: "data", REGISTRO: "registro" }, ["data/extraccion", `${PRUEBAS}/f1-a`]);
correr("scripts/anonimizar.ts", { DATA: "data", REGISTRO: "registro" }, ["data/extraccion", `${PRUEBAS}/f1-b`]);
const archivos = ["chats.jsonl", "docs.jsonl", "tables.jsonl", "entities.json"];
const iguales = archivos.every((f) => hash(`${PRUEBAS}/f1-a/${f}`) === hash(`${PRUEBAS}/f1-b/${f}`));
resultado(iguales, iguales ? "las 4 salidas son idénticas (idempotente)" : "LAS SALIDAS DIFIEREN entre corridas");

// ─────────────────────────────────────────────────────────────────────
titulo("F2 · re-anonimizar la propia salida");
const anon = {
  chats: leerJsonl(`${PRUEBAS}/f1-a/chats.jsonl`),
  docs: leerJsonl(`${PRUEBAS}/f1-a/docs.jsonl`),
  tables: leerJsonl(`${PRUEBAS}/f1-a/tables.jsonl`),
};
const internos = new Map(leerJsonl("data/extraccion/chats.jsonl").map((c) => [c.id, c]));
const uidPorAutor = new Map<string, string>();
let n = 0;
const chatsExtraidos = anon.chats.map((c) => {
  const orig: any = internos.get(c.id) ?? {};
  if (!uidPorAutor.has(c.author)) uidPorAutor.set(c.author, `UFAKE${String(++n).padStart(5, "0")}`);
  return {
    id: c.id, thread_id: c.thread_id, author: c.author, ts: c.ts, text: c.text,
    attachments: c.attachments ?? [],
    _canal: String(c.thread_id).split(":")[0], _uid: uidPorAutor.get(c.author), _bot: false,
    _menciones: [], _reacciones: [], _archivos: [], _editor: orig._editor,
  };
});
escribirJsonl(`${PRUEBAS}/f2-data/extraccion/chats.jsonl`, chatsExtraidos);
escribirJsonl(`${PRUEBAS}/f2-data/extraccion/docs.jsonl`, anon.docs);
escribirJsonl(`${PRUEBAS}/f2-data/extraccion/tables.jsonl`, anon.tables);
const nombresBot = new Set((JSON.parse(readFileSync("data/uids.json", "utf8")) as any[]).filter((u) => u.bot).map((u) => u.real_name));
writeFileSync(`${PRUEBAS}/f2-data/uids.json`, JSON.stringify(
  [...uidPorAutor].map(([autor, uid]) => ({
    uid, real_name: autor, display_name: autor, title: nombresBot.has(autor) ? "Asistente virtual" : "Cliente",
    email: "", phone: "", bot: nombresBot.has(autor), borrado: false, en_users: true, apariciones: { autor: 1 },
  })), null, 1));
writeFileSync(`${PRUEBAS}/f2-data/record_index.json`, JSON.stringify({
  chats: anon.chats.map((r) => r.id), docs: anon.docs.map((r) => r.id), tables: anon.tables.map((r) => r.id),
}, null, 1));

let f2ok = true;
try {
  correr("scripts/anonimizar.ts", { DATA: `${PRUEBAS}/f2-data`, REGISTRO: `${PRUEBAS}/f2-registro` }, [`${PRUEBAS}/f2-data/extraccion`, `${PRUEBAS}/f2-salida`]);
  const barrido = JSON.parse(correr("scripts/barrido.ts", { DATA: `${PRUEBAS}/f2-data` }, [`${PRUEBAS}/f2-salida`]));
  resultado(barrido.fugas === 0, `segunda pasada: ${barrido.fugas} fugas (esperado 0); ${barrido.campos} campos revisados`);
  const val = correr("../frontier-reto-1/validar.mjs", {}, [`${PRUEBAS}/f2-salida`, "--public", `${PRUEBAS}/f2-data`]);
  resultado(val.includes("OK"), `segunda pasada: validador ${val.trim().split("\n")[0]}`);
} catch (e: any) {
  f2ok = false;
  resultado(false, `segunda pasada falló: ${String(e.stderr || e.stdout || e.message).slice(0, 500)}`);
}

// ─────────────────────────────────────────────────────────────────────
titulo("F3 · variantes hostiles");
const mutado = structuredClone({
  chats: leerJsonl("data/extraccion/chats.jsonl"),
  docs: leerJsonl("data/extraccion/docs.jsonl"),
  tables: leerJsonl("data/extraccion/tables.jsonl"),
});
const confusables: Record<string, string> = { a: "\u0430", e: "\u0435", o: "\u043E", p: "\u0440", c: "\u0441" };
const confundir = (s: string) => s.replace(/[aeopc]/g, (ch) => confusables[ch] ?? ch);
const clientes = mutado.tables.filter((t: any) => t.table === "clientes");

// 3a. nombre con cirílicos, 3b. MAYÚSCULAS, 3c. espacio de ancho cero en una cédula
for (const c of clientes.slice(0, 3)) {
  const [nom, , ap1] = c.columns.nombre_completo.split(" ");
  const chat = mutado.chats.find((x: any) => x.text.includes(nom));
  if (!chat) continue;
  chat.text = chat.text.replace(nom, confundir(nom));
}
const algunaCedula = clientes[3]?.columns.num_doc;
const chatCedula = mutado.chats.find((x: any) => x.text.includes(algunaCedula));
if (chatCedula) chatCedula.text = chatCedula.text.replace(algunaCedula, algunaCedula.slice(0, 4) + "\u200b" + algunaCedula.slice(4));
const chatMayus = mutado.chats.find((x: any) => x.text.includes("Bancolombia"));
const clienteMayus = clientes[5]?.columns.nombre_completo;
if (chatMayus && clienteMayus) chatMayus.text = chatMayus.text + ` (titular: ${clienteMayus.toUpperCase()})`;

// 3d. fila nueva en el maestro con un nombre que ya existe (homónimo nuevo)
const filaBase = clientes[6];
if (filaBase) {
  mutado.tables.push({
    id: `clientes:CL-99999`, table: "clientes",
    columns: { ...filaBase.columns, cliente_id: "CL-99999", num_doc: "1099999999", correo: "homonimo.nuevo@gmail.com", celular: "3009998877", notas: "Cliente nuevo del cambio de fuentes." },
  });
}
// 3e. documento nuevo con PII solo en metadata y en el nombre de archivo
mutado.docs.push({
  id: "doc_99", format: "md", filename: `carta_a_${(clientes[7]?.columns.nombre_completo ?? "x y").toLowerCase().replace(/\s+/g, "_")}.md`,
  title: "Carta de bienvenida", body: "---\ntitle: Carta de bienvenida\nauthor: " + (clientes[7]?.columns.correo ?? "x@y.com") + "\n---\n# Carta de bienvenida\n\nEstimado cliente, bienvenido.\n",
  metadata: { title: "Carta de bienvenida", author: clientes[7]?.columns.correo ?? "x@y.com" },
});
// 3f. correo deletreado con espacios raros y NBSP
mutado.chats[0].text += " El bueno es " + (clientes[8]?.columns.correo ?? "x@y.com").split("@")[0].replace(".", " punto ") + "\u00a0arroba\u00a0" + (clientes[8]?.columns.correo ?? "x@y.com").split("@")[1].replace(".", " punto ");
// 3g. cédula con puntos dentro de un adjunto (sin pertenecer al autor)
mutado.chats[1].attachments = [{ filename: `extracto_${(clientes[9]?.columns.num_doc ?? "1").replace(/(\d{3})(\d{3})(\d{3})/, "$1.$2.$3")}.pdf` }];

for (const k of ["chats", "docs", "tables"] as const) escribirJsonl(`${PRUEBAS}/f3-data/extraccion/${k}.jsonl`, mutado[k]);
writeFileSync(`${PRUEBAS}/f3-data/uids.json`, readFileSync("data/uids.json"));
writeFileSync(`${PRUEBAS}/f3-data/record_index.json`, JSON.stringify({
  chats: mutado.chats.map((r: any) => r.id), docs: mutado.docs.map((r: any) => r.id), tables: mutado.tables.map((r: any) => r.id),
}, null, 1));

try {
  correr("scripts/anonimizar.ts", { DATA: `${PRUEBAS}/f3-data`, REGISTRO: `${PRUEBAS}/f3-registro` }, [`${PRUEBAS}/f3-data/extraccion`, `${PRUEBAS}/f3-salida`]);
  const barrido = JSON.parse(correr("scripts/barrido.ts", { DATA: `${PRUEBAS}/f3-data` }, [`${PRUEBAS}/f3-salida`]));
  resultado(barrido.fugas === 0, `variantes: ${barrido.fugas} fugas (esperado 0)`);
  const val = correr("../frontier-reto-1/validar.mjs", {}, [`${PRUEBAS}/f3-salida`, "--public", `${PRUEBAS}/f3-data`]);
  resultado(val.includes("OK"), `variantes: validador ${val.trim().split("\n")[0]}`);
  const filas3 = leerJsonl(`${PRUEBAS}/f3-salida/tables.jsonl`).filter((t: any) => t.table === "clientes");
  const nueva = filas3.find((f: any) => f.id === "clientes:CL-99999");
  const base3 = filas3.find((f: any) => f.id === filaBase?.id);
  const distintos = nueva && base3 && nueva.columns.nombre_completo !== base3.columns.nombre_completo;
  resultado(!!distintos, `variantes: homónimo nuevo con seudónimo propio (${nueva?.columns.nombre_completo} ≠ ${base3?.columns.nombre_completo})`);
  const doc99 = JSON.parse(readFileSync(`${PRUEBAS}/f3-salida/docs.jsonl`, "utf8").split("\n").filter(Boolean).pop()!);
  resultado(!doc99.filename.includes((clientes[7]?.columns.nombre_completo ?? "zz").split(" ")[0].toLowerCase()), `variantes: filename y metadata del doc nuevo anonimizados (${doc99.filename})`);
} catch (e: any) {
  resultado(false, `variantes falló: ${String(e.stderr || e.stdout || e.message).slice(0, 500)}`);
}

// ─────────────────────────────────────────────────────────────────────
titulo("F4 · cambio de fuentes: mismo humano con cliente_id nuevo");
// El cambio de fuentes puede dar a una persona ya conocida otra fila con otro cliente_id, y traer
// gente nueva. La identidad falsa NO debe moverse; las personas nuevas deben recibir IDs nuevos.
try {
  const extraccion = leerJsonl("data/extraccion/tables.jsonl");
  const uids = JSON.parse(readFileSync("data/uids.json", "utf8"));
  const chats4 = leerJsonl("data/extraccion/chats.jsonl");
  const docs4 = leerJsonl("data/extraccion/docs.jsonl");

  const clientes4 = extraccion.filter((t: any) => t.table === "clientes");
  const elegida = clientes4.find((c: any) => c.columns.num_doc && c.columns.nombre_completo.split(" ").length >= 3);
  const anclaVieja = elegida.columns.cliente_id;
  const anclaNueva = "CL-90001";
  const nombreElegido = elegida.columns.nombre_completo;

  // a) misma persona, cliente_id nuevo (en su fila y en sus PQRS)
  for (const t of extraccion) {
    if (t.table === "clientes" && t.columns.cliente_id === anclaVieja) {
      t.columns.cliente_id = anclaNueva;
      t.id = `clientes:${anclaNueva}`;
    } else if (t.table === "pqrs" && t.columns.cliente_id === anclaVieja) {
      t.columns.cliente_id = anclaNueva;
    }
  }
  // b) persona nueva de verdad (no estaba en el maestro anterior)
  extraccion.push({
    id: "clientes:CL-90002", table: "clientes",
    columns: { ...elegida.columns, cliente_id: "CL-90002", num_doc: "1088887777",
      nombre_completo: "Ana Lucía Bermúdez Quintero", correo: "ana.bermudez.q@gmail.com",
      celular: "3018887766", fecha_nacimiento: "1994-03-07", fecha_vinculacion: "2026-10-30",
      notas: "Ingresó con el cambio de fuentes." },
  });

  for (const k of ["chats", "docs", "tables"] as const)
    escribirJsonl(`${PRUEBAS}/f4-data/extraccion/${k}.jsonl`, k === "chats" ? chats4 : k === "docs" ? docs4 : extraccion);
  writeFileSync(`${PRUEBAS}/f4-data/uids.json`, JSON.stringify(uids));
  writeFileSync(`${PRUEBAS}/f4-data/record_index.json`, JSON.stringify({
    chats: chats4.map((r: any) => r.id), docs: docs4.map((r: any) => r.id), tables: extraccion.map((r: any) => r.id),
  }, null, 1));

  // Registro de partida: el que dejó la corrida oficial (copia, no el original).
  mkdirSync(`${PRUEBAS}/f4-registro`, { recursive: true });
  for (const f of ["personas.json", "identidades.json", "resolucion.json"])
    if (existsSync(`registro/${f}`)) writeFileSync(`${PRUEBAS}/f4-registro/${f}`, readFileSync(`registro/${f}`));

  correr("scripts/anonimizar.ts", { DATA: `${PRUEBAS}/f4-data`, REGISTRO: `${PRUEBAS}/f4-registro` },
    [`${PRUEBAS}/f4-data/extraccion`, `${PRUEBAS}/f4-salida`]);

  const entsAntes = JSON.parse(readFileSync("output/entities.json", "utf8")).entities;
  const entsDespues = JSON.parse(readFileSync(`${PRUEBAS}/f4-salida/entities.json`, "utf8")).entities;
  const buscar = (ents: any[], nombre: string) =>
    ents.find((e: any) => (e.originals ?? []).some((o: string) => o === nombre));
  const antes = buscar(entsAntes, nombreElegido);
  const despues = buscar(entsDespues, nombreElegido);
  const mismo = antes && despues && antes.pseudonyms?.name === despues.pseudonyms?.name;
  resultado(!!mismo, mismo
    ? `mismo humano con cliente_id nuevo → mismo seudónimo (${despues?.pseudonyms?.name})`
    : `EL SEUDÓNIMO CAMBIÓ: ${antes?.pseudonyms?.name} → ${despues?.pseudonyms?.name}`);

  const nuevaEnt = buscar(entsDespues, "Ana Lucía Bermúdez Quintero");
  const idsAntes = new Set(entsAntes.map((e: any) => e.entity_id));
  const colision = nuevaEnt && idsAntes.has(nuevaEnt.entity_id);
  resultado(!!nuevaEnt && !colision, nuevaEnt
    ? `persona nueva con ID propio (${nuevaEnt.entity_id}, seudónimo ${nuevaEnt.pseudonyms?.name})`
    : "la persona nueva no aparece en entities");

  const barrido = JSON.parse(correr("scripts/barrido.ts", { DATA: `${PRUEBAS}/f4-data` }, [`${PRUEBAS}/f4-salida`]));
  resultado(barrido.fugas === 0, `cambio de fuentes: ${barrido.fugas} fugas (esperado 0); ${barrido.campos} campos`);
  const val = correr("../frontier-reto-1/validar.mjs", {}, [`${PRUEBAS}/f4-salida`, "--public", `${PRUEBAS}/f4-data`]);
  resultado(val.includes("OK"), `cambio de fuentes: validador ${val.trim().split("\n")[0]}`);

  const persAntes = JSON.parse(readFileSync("registro/personas.json", "utf8")).personas;
  const persDespues = JSON.parse(readFileSync(`${PRUEBAS}/f4-registro/personas.json`, "utf8")).personas;
  const pAntes = persAntes.find((p: any) => p.nombre === nombreElegido);
  const pDespues = persDespues.find((p: any) => p.nombre === nombreElegido);
  const anclas = pDespues?.anclas ?? [];
  resultado(pAntes && pDespues && pAntes.id === pDespues.id && anclas.includes(anclaNueva),
    `el registro conserva el ID y anota el ancla nueva (${pDespues?.id}: ${anclas.join(", ")})`);
  const nuevos = persDespues.length - persAntes.length;
  resultado(nuevos >= 1, `el registro creció con la persona nueva (+${nuevos})`);
} catch (e: any) {
  resultado(false, `cambio de fuentes falló: ${String(e.stderr || e.stdout || e.message).slice(0, 600)}`);
}

console.log(`\n${fallos === 0 ? "PROTOCOLO OK" : `PROTOCOLO CON ${fallos} FALLO(S)`} — detalle en ${PRUEBAS}/`);
process.exit(fallos === 0 ? 0 : 1);
