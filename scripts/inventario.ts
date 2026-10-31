// Inventario: todo lo que hay que anonimizar, antes de tocar una sola letra.
// Construye el registro de personas, busca sus formas reales en todos los campos que se emiten,
// cuenta lo que aparece y lo que NO tiene dueño (posibles terceros), y deja dos reportes:
//   registro/inventario.json  (con PII, nunca al repo)
//   knowledge/inventario.md   (solo conteos, va al repo)
// Uso: node scripts/inventario.ts [fuentes/]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { norm, palabras, contiene, soloDigitos, digitosCompactos } from "../src/anon/texto.ts";
import { construir, formasDe, indexarFormas, guardar, leerJsonl, type Persona, type Forma } from "../src/registro/personas.ts";

interface Chat { id: string; thread_id: string; author: string; ts: string; text: string; attachments: { filename: string }[]; _uid?: string; _archivos?: { name: string; title?: string }[]; _menciones?: string[] }
interface Doc { id: string; format: string; filename: string; title: string; body: string; metadata: Record<string, string> }
interface Tabla { id: string; table: string; columns: Record<string, string>; _comentarios?: string[] }
interface InfoUid { uid: string; real_name: string; display_name: string; title: string; email: string; phone: string; bot: boolean; borrado: boolean; en_users: boolean; apariciones: Record<string, number> }

const dir = process.argv[2] ?? "data/extraccion";
const t0 = Date.now();
if (!existsSync(`${dir}/chats.jsonl`)) {
  console.error(`falta ${dir}/chats.jsonl — corre antes: node scripts/espejo.ts`);
  process.exit(1);
}
const chats = leerJsonl<Chat>(`${dir}/chats.jsonl`);
const docs = leerJsonl<Doc>(`${dir}/docs.jsonl`);
const tablas = leerJsonl<Tabla>(`${dir}/tables.jsonl`);
const uids = JSON.parse(readFileSync(`${dir}/../uids.json`, "utf8")) as InfoUid[];

// ── 1. Registro ────────────────────────────────────────────────────────
const reg = construir(tablas, uids);
guardar(reg);
const personas = reg.personas;
const idx = indexarFormas(personas);

// Formas que no son de texto (dígitos) van por otra vía: compactamos el haystack una sola vez.
const formasDigitos: { p: Persona; f: Forma; digitos: string }[] = [];
for (const p of personas) {
  for (const f of formasDe(p)) {
    const d = soloDigitos(f.valor);
    if (d && d.length >= 6 && !/[a-zA-Z]/.test(f.valor) && d.length >= 0.6 * f.valor.length)
      formasDigitos.push({ p, f, digitos: d });
  }
}

// ── 2. Campos que se emiten ────────────────────────────────────────────
type Campo = { registro: string; fuente: string; campo: string; texto: string };
const campos: Campo[] = [];
for (const c of chats) {
  campos.push({ registro: c.id, fuente: "chats", campo: "author", texto: c.author });
  campos.push({ registro: c.id, fuente: "chats", campo: "text", texto: c.text });
  for (const a of c.attachments) campos.push({ registro: c.id, fuente: "chats", campo: "attachments.filename", texto: a.filename });
}
for (const d of docs) {
  campos.push({ registro: d.id, fuente: "docs", campo: "title", texto: d.title });
  campos.push({ registro: d.id, fuente: "docs", campo: "filename", texto: d.filename });
  campos.push({ registro: d.id, fuente: "docs", campo: "body", texto: d.body });
  for (const [k, v] of Object.entries(d.metadata)) campos.push({ registro: d.id, fuente: "docs", campo: `metadata.${k}`, texto: v });
}
for (const t of tablas) {
  for (const [k, v] of Object.entries(t.columns)) campos.push({ registro: t.id, fuente: "tables", campo: `columns.${k}`, texto: v });
  for (const c of t._comentarios ?? []) campos.push({ registro: t.id, fuente: "tables", campo: "comentarios", texto: c });
}

// ── 3. Detección ───────────────────────────────────────────────────────
/** Correos deletreados: "ana arroba gmail punto com" → "ana@gmail.com" (solo para detectar). */
function desDeletrear(s: string): string {
  return norm(s)
    .replace(/\b(arroba|at)\b/g, "@")
    .replace(/\b(punto|dot)\b/g, ".")
    .replace(/\b(guion bajo|subrayado|underscore)\b/g, "_")
    .replace(/\b(guion|guion medio|minus)\b/g, "-")
    .replace(/\s*@\s*/g, "@").replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ");
}

interface Hit { persona: Persona; forma: Forma; campo: string; registro: string; fuente: string }
const hits: Hit[] = [];
const hitsPorCampo: Record<string, number> = {};
const hitsPorTipo: Record<string, number> = {};
const registrosConHit = new Set<string>();
const personasConHit = new Set<string>();
const ejemploPorTipo: Record<string, string> = {};
const vistos = new Set<string>();

function anotar(h: Hit) {
  // Un mismo campo puede contener dos formas de la misma persona ("Ana Pérez" y "Ana"):
  // para el inventario cuenta una vez; el motor las reemplaza todas.
  const clave = `${h.registro}|${h.campo}|${h.persona.id}|${h.forma.tipo}`;
  if (vistos.has(clave)) return;
  vistos.add(clave);
  hits.push(h);
  hitsPorCampo[`${h.fuente}.${h.campo}`] = (hitsPorCampo[`${h.fuente}.${h.campo}`] ?? 0) + 1;
  hitsPorTipo[h.forma.tipo] = (hitsPorTipo[h.forma.tipo] ?? 0) + 1;
  registrosConHit.add(h.registro);
  personasConHit.add(h.persona.id);
  ejemploPorTipo[h.forma.tipo] ??= `${h.fuente}:${h.registro}:${h.campo}`;
}

for (const c of campos) {
  if (!c.texto) continue;
  // a) formas de texto: n-gramas 4..1 palabras buscados en el índice
  const ws = palabras(c.texto);
  const usados = new Set<number>();
  for (let i = 0; i < ws.length; i++) {
    for (let n = 4; n >= 1; n--) {
      if (i + n > ws.length) continue;
      const clave = ws[i];
      const cands = idx.get(clave);
      if (!cands) { if (n === 1) i += 0; continue; }
      let hubo = false;
      for (const { p, f } of cands) {
        const fw = palabras(f.valor);
        if (fw.length !== n) continue;
        let ok = true;
        for (let k = 0; k < n; k++) if (ws[i + k] !== fw[k]) { ok = false; break; }
        if (!ok) continue;
        let solapa = false;
        for (let k = 0; k < n; k++) if (usados.has(i + k)) { solapa = true; break; }
        if (solapa) continue;
        for (let k = 0; k < n; k++) usados.add(i + k);
        anotar({ persona: p, forma: f, campo: c.campo, registro: c.registro, fuente: c.fuente });
        hubo = true;
      }
      if (hubo) break;
    }
  }
  // b) correos deletreados
  const deletreado = desDeletrear(c.texto);
  if (deletreado.includes("@")) {
    for (const p of personas) {
      if (!p.correo) continue;
      if (deletreado.includes(p.correo.toLowerCase()))
        anotar({ persona: p, forma: { valor: p.correo, tipo: "correo" }, campo: c.campo, registro: c.registro, fuente: c.fuente });
    }
  }
  // c) dígitos (cédula, celular, placa numérica) con los separadores del juez
  const compacto = digitosCompactos(c.texto);
  if (/\d{6}/.test(compacto)) {
    for (const { p, f, digitos } of formasDigitos) {
      if (!compacto.includes(digitos) && !compacto.includes(`57${digitos}`)) continue;
      if (contiene(c.texto, f.valor)) anotar({ persona: p, forma: f, campo: c.campo, registro: c.registro, fuente: c.fuente });
    }
  }
}

// ── 4. PII sin dueño en el registro ────────────────────────────────────
// Solo cuenta lo que tiene forma de dato personal Y contexto: un número de 8 dígitos dentro de
// "PSE-…" es una referencia de pago, no una cédula; "84.000.000" es un monto. Esos se descartan.
const conocidos = new Set(personas.flatMap((p) => [p.correo, p.celular, p.cedula, p.uid].filter(Boolean) as string[]));
const RX_CORREO = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
const RX_CEL = /(?<!\d)(3\d{9})(?!\d)/g;
const RX_CED_CTX = /(?:\b(?:cc|c\.c\.|cedula|cédula|identificacion|identificación|documento)\b[^\d]{0,14})(\d{2}[.\s]?\d{3}[.\s]?\d{3,4})/gi;
const RX_CED_COLUMNA = /^(cedula|num_doc|documento)$/i;
const sinDueno = { correos: new Set<string>(), celulares: new Set<string>(), cedulas: new Set<string>() };
const cedEnContexto = (texto: string): string[] =>
  [...texto.matchAll(RX_CED_CTX)].map((m) => soloDigitos(m[1])).filter((d) => d.length >= 7 && d.length <= 11);
for (const c of campos) {
  if (!c.texto) continue;
  for (const m of c.texto.matchAll(RX_CORREO)) {
    const v = m[0].toLowerCase();
    if (!conocidos.has(v) && /\.(com|co|net|org|edu|gov|info|io|es|se)$/.test(v)) sinDueno.correos.add(v);
  }
  for (const m of desDeletrear(c.texto).matchAll(RX_CORREO)) {
    const v = m[0];
    if (!conocidos.has(v) && /\.(com|co|net|org|edu|gov|info|io|es|se)$/.test(v)) sinDueno.correos.add(v);
  }
  for (const m of digitosCompactos(c.texto).matchAll(RX_CEL)) if (!conocidos.has(m[1]) && /\b(?:cel|celular|whatsapp|tel|telefono|teléfono)\b/i.test(c.texto)) sinDueno.celulares.add(m[1]);
  const ceds = RX_CED_COLUMNA.test(c.campo.replace(/^columns\./, "")) ? [soloDigitos(c.texto)] : cedEnContexto(c.texto);
  for (const d of ceds) if (d && !conocidos.has(d)) sinDueno.cedulas.add(d);
}

// ── 4b. Formas que no viven en el maestro: placa, pasaporte, dirección, adjunto ──
const RX_PLACA = /\b[A-Z]{3}[ -]?\d{3}\b/g;
const RX_PASAPORTE = /\bpasaporte\b[^\w]{0,10}([A-Z]{1,2}\d{6,9}|\d{7,9})/gi;
const RX_DIRECCION = /\b(?:calle|carrera|cra|cl|avenida|av|diagonal|dg|transversal|tv)\.?\s+\d{1,3}[a-z]?\s*(?:bis\s*)?#?\s*\d/gi;
const extras: Record<string, { registro: string; campo: string; valor: string; autor?: string }[]> = {
  placa: [], pasaporte: [], direccion_en_texto: [], adjunto_con_token: [],
};
for (const c of chats) {
  for (const m of c.text.matchAll(RX_PLACA)) extras.placa.push({ registro: c.id, campo: "text", valor: m[0], autor: c.author });
  for (const m of c.text.matchAll(RX_PASAPORTE)) extras.pasaporte.push({ registro: c.id, campo: "text", valor: m[1], autor: c.author });
  if (RX_DIRECCION.test(c.text)) extras.direccion_en_texto.push({ registro: c.id, campo: "text", valor: "(dirección)", autor: c.author });
  for (const a of c.attachments) if (/[a-z]+[_-][a-z]+/i.test(a.filename)) extras.adjunto_con_token.push({ registro: c.id, campo: "attachments.filename", valor: a.filename, autor: c.author });
}
for (const d of docs) {
  for (const m of d.body.matchAll(RX_PASAPORTE)) extras.pasaporte.push({ registro: d.id, campo: "body", valor: m[1] });
}

// ── 5. Nombres de pila compartidos (deciden si "solo nombre" es reemplazable) ──
const porPila = new Map<string, number>();
for (const p of personas) {
  const k = norm(p.nombres[0] ?? "");
  if (k) porPila.set(k, (porPila.get(k) ?? 0) + 1);
}
const pilaCompartido = [...porPila.entries()].filter(([, v]) => v > 1);

// ── 6. Cobertura ───────────────────────────────────────────────────────
const ligas: Record<string, number> = {};
for (const p of personas) ligas[p.liga] = (ligas[p.liga] ?? 0) + 1;
const porTipoPersona: Record<string, number> = {};
for (const p of personas) porTipoPersona[p.tipo] = (porTipoPersona[p.tipo] ?? 0) + 1;
const registrosPorPersona = new Map<string, Set<string>>();
for (const h of hits) {
  const s = registrosPorPersona.get(h.persona.id) ?? new Set();
  s.add(h.registro);
  registrosPorPersona.set(h.persona.id, s);
}
// "Fuera del maestro" = aparece en algún registro que no es su propia fila/ancla.
const sinMenciones = personas.filter((p) =>
  !hits.some((h) => h.persona.id === p.id && !h.registro.endsWith(p.ancla)));

// ── 7. Salidas ─────────────────────────────────────────────────────────
const resumen = {
  segundos: Math.round(((Date.now() - t0) / 100) / 10),
  registros: { chats: chats.length, docs: docs.length, tables: tablas.length, total: chats.length + docs.length + tablas.length },
  personas: { total: personas.length, porTipo: porTipoPersona, ligas, sinMenciones: sinMenciones.length, genero: Object.fromEntries(["f", "m", "?"].map((g) => [g, personas.filter((p) => p.genero === g).length])) },
  pendientes: reg.pendientes,
  formas: { total: personas.reduce((a, p) => a + formasDe(p).length, 0), hits: hits.length, porTipo: hitsPorTipo, porCampo: hitsPorCampo, ejemploPorTipo },
  cobertura: { registrosConHit: registrosConHit.size, de: chats.length + docs.length + tablas.length },
  sinDueno: { correos: [...sinDueno.correos], celulares: [...sinDueno.celulares], cedulas: [...sinDueno.cedulas] },
  extras: Object.fromEntries(Object.entries(extras).map(([k, v]) => [k, { total: v.length, muestra: v.slice(0, 3) }])),
  pilaCompartido: pilaCompartido.map(([k, v]) => `${k}×${v}`),
};
mkdirSync("registro", { recursive: true });
writeFileSync("registro/inventario.json", JSON.stringify({ resumen, personas, hits, extras }, null, 1));
console.log(JSON.stringify({
  registros: resumen.registros.total,
  personas: `${personas.length} (${Object.entries(porTipoPersona).map(([k, v]) => `${k} ${v}`).join(", ")})`,
  ligas, genero: resumen.personas.genero,
  pendientes: reg.pendientes.length,
  sinMenciones: sinMenciones.length,
  hits: hits.length, porTipo: hitsPorTipo,
  sinDueno: { correos: sinDueno.correos.size, celulares: sinDueno.celulares.size, cedulas: sinDueno.cedulas.size },
  extras: Object.fromEntries(Object.entries(extras).map(([k, v]) => [k, v.length])),
  cobertura: `${registrosConHit.size}/${resumen.registros.total}`,
  segundos: resumen.segundos,
}, null, 1));

// Reporte sin PII para el repo
const top = Object.entries(hitsPorCampo).sort((a, b) => b[1] - a[1]);
const md = [
  "# Inventario de lo que hay que anonimizar",
  "",
  `Generado por \`node scripts/inventario.ts\` el ${new Date().toLocaleString("es-MX", { hour12: false }).slice(0, 16)} (${resumen.segundos} s).`,
  "Sin datos personales: solo conteos. El detalle con originales vive en `registro/inventario.json` (nunca al repo).",
  "",
  "## Registros",
  `chats ${chats.length} · docs ${docs.length} · tablas ${tablas.length} · **total ${resumen.registros.total}**`,
  "",
  "## Personas",
  `**${personas.length}** personas con ID asignado: ${porTipoPersona.cliente ?? 0} clientes, ${porTipoPersona.empleado ?? 0} empleados, ${porTipoPersona.tercero ?? 0} terceros.`,
  `Género: ${resumen.personas.genero.f} f · ${resumen.personas.genero.m} m · ${resumen.personas.genero["?"]} sin evidencia.`,
  "",
  "| Liga a Slack | Personas |",
  "|---|---|",
  ...Object.entries(ligas).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  `Personas sin ninguna mención fuera de su fila del maestro: **${sinMenciones.length}** (igual llevan seudónimo).`,
  "",
  "## uids de Slack sin persona resuelta",
  `**${reg.pendientes.length}** uids quedan pendientes de evidencia (2+ candidatos con el mismo nombre, o ninguno).`,
  "No se les inventa persona: se resuelven con la evidencia del texto (radicado, monto + fecha, cédula dictada).",
  ...reg.pendientes.slice(0, 20).map((p) => `- \`${p.uid}\` con ${p.candidatos.length} candidato(s) en el maestro`),
  "",
  "## Formas reales encontradas",
  `**${hits.length}** menciones en total.`,
  "",
  "| Tipo de forma | Menciones |",
  "|---|---|",
  ...Object.entries(hitsPorTipo).sort((a, b) => b[1] - a[1]).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "| Campo | Menciones |",
  "|---|---|",
  ...top.map(([k, v]) => `| \`${k}\` | ${v} |`),
  "",
  `Cobertura: **${registrosConHit.size} de ${resumen.registros.total}** registros tienen al menos una mención.`,
  "",
  "## PII que no pertenece a ninguna persona del registro",
  `correos ${sinDueno.correos.size} · celulares ${sinDueno.celulares.size} · cédulas ${sinDueno.cedulas.size}`,
  "Son candidatos a tercero (persona nueva con ID nuevo) o a falso positivo que hay que conservar.",
  "",
  "## Formas que no viven en el maestro",
  "| Tipo | Cuántas | Qué implica |",
  "|---|---|---|",
  `| placa en texto | ${extras.placa.length} | seudónimo de placa por persona, mismo formato |`,
  `| pasaporte | ${extras.pasaporte.length} | seudónimo propio, fijo entre corridas |`,
  `| mensajes con dirección | ${extras.direccion_en_texto.length} | otro inmueble, mismo formato |`,
  `| adjuntos con token de nombre | ${extras.adjunto_con_token.length} | se reemplaza el token dentro del nombre de archivo |`,
  "",
  "## Nombres de pila compartidos",
  `${pilaCompartido.length} primeros nombres los usan 2+ personas → la forma "solo nombre" no se puede reemplazar a ciegas.`,
  "",
].join("\n");
writeFileSync("knowledge/inventario.md", md);
