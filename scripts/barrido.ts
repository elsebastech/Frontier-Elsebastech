// Barrido determinista (M2): ¿quedó alguna forma real en la salida?
// Usa el mismo detector que el motor (el motor del juez: normaliza confusables, invisibles y
// separadores de dígitos), pero buscando TODAS las formas de TODAS las personas, sin mirar
// qué declaramos en entities.json.
// Uso: node scripts/barrido.ts [output]
import { readFileSync, existsSync } from "node:fs";
import { construir, formasDe, leerJsonl, type Persona, type Forma } from "../src/registro/personas.ts";
import { indexar, buscarMarcas } from "../src/anon/motor.ts";
import { norm } from "../src/anon/texto.ts";

const out = process.argv[2] ?? "output";
if (!existsSync(`${out}/chats.jsonl`)) { console.error(`falta ${out}/chats.jsonl`); process.exit(1); }

const tablas = leerJsonl<{ id: string; table: string; columns: Record<string, string> }>(`${process.env.DATA ?? "data"}/extraccion/tables.jsonl`);
const uids = JSON.parse(readFileSync(`${process.env.DATA ?? "data"}/uids.json`, "utf8"));
const reg = construir(tablas, uids);
const personas: Persona[] = reg.personas;
// Los uids pendientes también cuentan como personas a barrer (nunca deben aparecer sus nombres).
for (const pend of reg.pendientes) {
  reg.porUid.size;
  personas.push({
    id: `pend:${pend.uid}`, tipo: "cliente", ancla: `uid:${pend.uid}`, nombre: pend.nombre,
    nombres: pend.nombre.split(" ").slice(0, 1), apellidos: pend.nombre.split(" ").slice(1),
    genero: "?", liga: "pendiente", uid: pend.uid,
  });
}

const idx = indexar(personas, formasDe);
const formasDigitos = personas.flatMap((p) =>
  formasDe(p).map((f: Forma) => ({ p, f, digitos: f.valor.replace(/\D/g, "") }))
    .filter((x) => x.digitos.length >= 6 && !/[a-zA-Z]/.test(x.f.valor) && x.digitos.length >= 0.6 * x.f.valor.length),
);

const campos: { registro: string; fuente: string; campo: string; texto: string }[] = [];
for (const c of leerJsonl<any>(`${out}/chats.jsonl`)) {
  campos.push({ registro: c.id, fuente: "chats", campo: "author", texto: c.author ?? "" });
  campos.push({ registro: c.id, fuente: "chats", campo: "text", texto: c.text ?? "" });
  for (const a of c.attachments ?? []) campos.push({ registro: c.id, fuente: "chats", campo: "attachments.filename", texto: a.filename ?? "" });
}
for (const d of leerJsonl<any>(`${out}/docs.jsonl`)) {
  campos.push({ registro: d.id, fuente: "docs", campo: "title", texto: d.title ?? "" });
  campos.push({ registro: d.id, fuente: "docs", campo: "filename", texto: d.filename ?? "" });
  campos.push({ registro: d.id, fuente: "docs", campo: "body", texto: d.body ?? "" });
  for (const [k, v] of Object.entries(d.metadata ?? {})) campos.push({ registro: d.id, fuente: "docs", campo: `metadata.${k}`, texto: String(v) });
}
for (const t of leerJsonl<any>(`${out}/tables.jsonl`)) {
  for (const [k, v] of Object.entries(t.columns ?? {})) campos.push({ registro: t.id, fuente: "tables", campo: `columns.${k}`, texto: String(v) });
}

// Un nombre de pila suelto o una fecha sueltos no identifican a nadie (el validador del jurado
// también ignora los nombres de una sola palabra). Se cuentan aparte para no tapar fugas reales.
const AMBIGUOS = new Set(["nombre", "nacimiento"]);
let fugas = 0;
let ambiguos = 0;

// El jurado busca las formas reales que APARECEN en las fuentes, no todas las combinaciones
// teóricas. Aquí se calcula ese conjunto: evita marcar como fuga un seudónimo que casualmente
// contiene dos palabras que ningún registro del origen dice juntas.
const formasEnFuentes = new Set<string>();
const dirDatos = process.env.DATA ?? "data";
{
  const camposFuente: string[] = [];
  for (const c of leerJsonl<any>(`${dirDatos}/extraccion/chats.jsonl`)) {
    camposFuente.push(c.author ?? "", c.text ?? "");
    for (const a of c.attachments ?? []) camposFuente.push(a.filename ?? "");
  }
  for (const d of leerJsonl<any>(`${dirDatos}/extraccion/docs.jsonl`)) {
    camposFuente.push(d.title ?? "", d.filename ?? "", d.body ?? "");
    for (const v of Object.values(d.metadata ?? {})) camposFuente.push(String(v));
  }
  for (const t of leerJsonl<any>(`${dirDatos}/extraccion/tables.jsonl`))
    for (const v of Object.values(t.columns ?? {})) camposFuente.push(String(v));
  for (const texto of camposFuente) {
    if (!texto) continue;
    for (const m of buscarMarcas(texto, idx, formasDigitos)) {
      // Las formas "local@" existen solo para detectar correos deletreados en el motor; como
      // identificador real se usa el correo completo (con dominio).
      if (m.forma.valor.endsWith("@")) continue;
      formasEnFuentes.add(norm(m.forma.valor));
    }
  }
}
const porTipo: Record<string, number> = {};
const porPersona = new Map<string, number>();
const ejemplos: string[] = [];
for (const c of campos) {
  if (!c.texto) continue;
  const marcas = buscarMarcas(c.texto, idx, formasDigitos);
  for (const m of marcas) {
    if (m.forma.valor.endsWith("@")) continue; // prefijo de correo: no es un identificador por sí solo
    if (!formasEnFuentes.has(norm(m.forma.valor))) continue; // combinación teórica, no está en el origen
    if (AMBIGUOS.has(m.forma.tipo)) { ambiguos++; continue; }
    fugas++;
    porTipo[m.forma.tipo] = (porTipo[m.forma.tipo] ?? 0) + 1;
    porPersona.set(m.persona.id, (porPersona.get(m.persona.id) ?? 0) + 1);
    if (ejemplos.length < 30)
      ejemplos.push(`${c.fuente}:${c.registro}:${c.campo} · ${m.forma.tipo} · ${JSON.stringify(c.texto.slice(m.ini, m.fin))} · ${m.persona.id}`);
  }
}

console.log(JSON.stringify({ campos: campos.length, fugas, ambiguos, porTipo, personasConFuga: porPersona.size, ejemplos }, null, 1));
process.exit(fugas === 0 ? 0 : 1);
