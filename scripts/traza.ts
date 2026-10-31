// Traza: muestra qué le pasó a UN registro, paso por paso (para revisar a mano).
// Uso: node scripts/traza.ts <id-de-registro>
// Imprime: original → Paso A (marcadores) → Paso B (identidad) + la identidad de cada persona tocada.
import { readFileSync, existsSync } from "node:fs";
import { norm } from "../src/anon/texto.ts";
import { construir, formasDe, leerJsonl, type Persona } from "../src/registro/personas.ts";
import { buscarCandidatos, aPersona, cedulasHuerfanas } from "../src/registro/terceros.ts";
import { resolverUids, formaDeAutor } from "../src/registro/resolver.ts";
import { indexar, buscarMarcas, marcar, dibujarTexto } from "../src/anon/motor.ts";
import { generarIdentidad, cargarIdentidades, type Identidad } from "../src/anon/identidades.ts";

const id = process.argv[2];
if (!id) { console.error("uso: node scripts/traza.ts <id-de-registro>"); process.exit(2); }
const SAL = process.env.HMAC_SAL ?? "frontier-elsebastech-2026-sal";

const chats = leerJsonl<any>("data/extraccion/chats.jsonl");
const docs = leerJsonl<any>("data/extraccion/docs.jsonl");
const tablas = leerJsonl<any>("data/extraccion/tables.jsonl");
const uids = JSON.parse(readFileSync("data/uids.json", "utf8"));

const reg = construir(tablas, uids);
const personas = reg.personas;
const clientes = personas.filter((p) => p.tipo === "cliente" && !p.ancla.startsWith("uid:"));
const res = resolverUids(chats, clientes, reg.pendientes, tablas.filter((t) => t.table === "pqrs").map((t) => t.columns));
for (const [uid, p] of res.uidAPersona) { p.uids = [...(p.uids ?? []), uid]; p.uid ??= uid; reg.porUid.set(uid, p); }
const sinResolver = new Set(res.decisiones.filter((d) => d.ancla === null).map((d) => d.uid));
for (const pend of reg.pendientes) {
  if (!sinResolver.has(pend.uid)) continue;
  const p = { id: `P${String(personas.length + 1).padStart(4, "0")}`, tipo: "cliente", ancla: `uid:${pend.uid}`,
    nombre: pend.nombre, nombres: pend.nombre.split(" ").slice(0, 1), apellidos: pend.nombre.split(" ").slice(1),
    genero: "?", uid: pend.uid, liga: "pendiente" } as Persona;
  personas.push(p); reg.porUid.set(pend.uid, p);
}
const yaConocidas = new Set<string>(); const yaCorreos = new Set<string>();
for (const p of personas) { yaConocidas.add(norm(p.nombre)); for (const f of formasDe(p)) if (f.tipo.startsWith("nombre")) yaConocidas.add(norm(f.valor)); if (p.correo) yaCorreos.add(p.correo.toLowerCase()); }
const camposTerceros: { registro: string; campo: string; texto: string }[] = [];
for (const c of chats) { camposTerceros.push({ registro: c.id, campo: "text", texto: c.text }); for (const a of c.attachments) camposTerceros.push({ registro: c.id, campo: "attachments.filename", texto: a.filename }); }
for (const d of docs) { camposTerceros.push({ registro: d.id, campo: "body", texto: d.body }); for (const [k, v] of Object.entries(d.metadata)) camposTerceros.push({ registro: d.id, campo: k, texto: v }); }
for (const t of tablas) for (const [k, v] of Object.entries(t.columns)) camposTerceros.push({ registro: t.id, campo: k, texto: v as string });
const base = personas.length;
const terceros = [
  ...buscarCandidatos(camposTerceros, yaConocidas, yaCorreos),
  ...cedulasHuerfanas(camposTerceros, new Set(personas.map((p) => p.cedula).filter(Boolean) as string[])),
].map((c, k) => aPersona(c, `P${String(base + 1 + k).padStart(4, "0")}`, (n) => "?"));
personas.push(...terceros);

const prohibidas = personas.flatMap((p) => formasDe(p).map((f) => f.valor)).filter((v) => v.length >= 4);
const idents = cargarIdentidades();
for (const p of personas) if (!idents.has(p.id)) idents.set(p.id, generarIdentidad(p, { sal: SAL, prohibidas }));
const idx = indexar(personas, formasDe);
const formasDigitos = personas.flatMap((p) => formasDe(p).map((f) => ({ p, f, digitos: f.valor.replace(/\D/g, "") }))
  .filter((x) => x.digitos.length >= 6 && !/[a-zA-Z]/.test(x.f.valor) && x.digitos.length >= 0.6 * x.f.valor.length));

const rec = [...chats, ...docs, ...tablas].find((r) => r.id === id);
if (!rec) { console.error(`no existe el registro ${id}`); process.exit(1); }

const tocadas = new Map<string, Persona>();
function paso(campo: string, texto: string) {
  if (!texto) return;
  const marcas = buscarMarcas(texto, idx, formasDigitos);
  if (!marcas.length) { console.log(`  ${campo}: sin datos personales`); return; }
  const conMarcas = marcar(texto, marcas);
  const final = dibujarTexto(conMarcas, idents);
  for (const m of marcas) tocadas.set(m.persona.id, m.persona);
  console.log(`  ┌ ${campo}`);
  console.log(`  │ original : ${texto}`);
  console.log(`  │ Paso A   : ${conMarcas}`);
  console.log(`  └ Paso B   : ${final}`);
}
const apariciones = new Map<string, boolean>();
for (const m of buscarMarcas(rec.text ?? rec.body ?? "", idx, formasDigitos)) if (m.forma.tipo === "cedula") apariciones.set(m.persona.id, true);

console.log(`\n=== REGISTRO ${id} (${rec.table ? "tabla " + rec.table : rec.format ? "doc " + rec.format : "chat"}) ===`);
if (rec.author) {
  const p = rec._uid ? reg.porUid.get(rec._uid) : undefined;
  if (p) {
    const tipo = formaDeAutor(rec.author);
    tocadas.set(p.id, p);
    console.log(`  ┌ author (por uid ${rec._uid} → ${p.ancla})`);
    console.log(`  │ original : ${rec.author}`);
    console.log(`  │ Paso A   : ⟦${p.id}·${tipo}⟧`);
    console.log(`  └ Paso B   : ${dibujarTexto(`⟦${p.id}·${tipo}⟧`, idents)}`);
  } else paso("author", rec.author);
}
if (rec.text) paso("text", rec.text);
if (rec.title) paso("title", rec.title);
if (rec.filename) paso("filename", rec.filename);
if (rec.body) paso("body", rec.body.length > 700 ? rec.body.slice(0, 700) + " …" : rec.body);
if (rec.attachments) for (const a of rec.attachments) paso("attachments.filename", a.filename);
if (rec.metadata) for (const [k, v] of Object.entries(rec.metadata)) paso(`metadata.${k}`, v as string);
if (rec.columns) for (const [k, v] of Object.entries(rec.columns)) paso(`columns.${k}`, v as string);

console.log(`\n=== PERSONAS TOCADAS (${tocadas.size}) ===`);
for (const p of tocadas.values()) {
  const i = idents.get(p.id)!;
  console.log(`  ${p.id}  ${p.tipo.padEnd(8)} ancla ${p.ancla.padEnd(12)} liga ${p.liga}`);
  console.log(`        real : ${p.nombre}${p.cedula ? ` · CC ${p.cedula}` : ""}${p.correo ? ` · ${p.correo}` : ""}`);
  console.log(`        falsa: ${i.nombre_completo}${i.cedula ? ` · CC ${i.cedula}` : ""}${i.correo ? ` · ${i.correo}` : ""}`);
  console.log(`        campos: ${p.cargo ? p.cargo + " · " : ""}${p.ciudad ?? ""}${p.reporta_a ? " · reporta a " + p.reporta_a : ""}`);
}
console.log(`\nfichero de identidades: registro/identidades.json (${idents.size} personas con identidad fija)`);
if (!existsSync("registro/identidades.json")) console.log("  (no existe todavía: corre node scripts/anonimizar.ts)");
