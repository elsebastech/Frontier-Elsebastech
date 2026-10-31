import { formaDelConjunto, guardarFirmaColumnas } from "../src/jev/preflight.ts";
// Anonimización completa: Paso A (real → ⟦P·forma⟧) y Paso B (→ identidad falsa), más
// cuasi-identificadores, entities.json y los 4 archivos de output/.
// Uso: node scripts/anonimizar.ts [data/extraccion] [output]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { norm, palabras } from "../src/anon/texto.ts";
import { construir, formasDe, guardar, generoDe, leerJsonl, type Persona, type Forma, type TipoForma } from "../src/registro/personas.ts";
import { buscarCandidatos, aPersona, cedulasHuerfanas } from "../src/registro/terceros.ts";
import { resolverUids, formaDeAutor } from "../src/registro/resolver.ts";
import { reconciliar } from "../src/registro/reconciliar.ts";
import { cargar as cargarRegistro } from "../src/registro/personas.ts";
import { generarIdentidad, cargarIdentidades, guardarIdentidades, type Identidad } from "../src/anon/identidades.ts";
import { indexar, buscarMarcas, marcar, dibujarTexto, dibujarArchivo, type FormaIndexada } from "../src/anon/motor.ts";
import { buscarHuerfanos, reemplazarHuerfanos, type Huerfano } from "../src/anon/huerfanos.ts";

const argsLibres = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dir = process.env.DATA ? `${process.env.DATA}/extraccion` : (argsLibres[0] ?? "data/extraccion");
const out = argsLibres[1] ?? "output";
const t0 = Date.now();
const SAL = process.env.HMAC_SAL ?? "frontier-elsebastech-2026-sal";

interface Chat { id: string; thread_id: string; author: string; ts: string; text: string; attachments: { filename: string }[]; _canal?: string; _uid?: string; _archivos?: { name: string; title?: string }[] }
interface Doc { id: string; format: string; filename: string; title: string; body: string; metadata: Record<string, string> }
interface Tabla { id: string; table: string; columns: Record<string, string>; _comentarios?: string[] }
interface InfoUid { uid: string; real_name: string; display_name: string; title: string; email: string; phone: string; bot: boolean; borrado: boolean; en_users: boolean }

const chats = leerJsonl<Chat>(`${dir}/chats.jsonl`);
const docs = leerJsonl<Doc>(`${dir}/docs.jsonl`);
const tablas = leerJsonl<Tabla>(`${dir}/tables.jsonl`);
const uids = JSON.parse(readFileSync(`${dir}/../uids.json`, "utf8")) as InfoUid[];

// ── 1. Registro ────────────────────────────────────────────────────────
const reg = construir(tablas, uids);
const personas = reg.personas;

// ── 1a. Resolución uid → fila del maestro (sin fusionar personas) ──────
const clientes = personas.filter((p) => p.tipo === "cliente" && !p.ancla.startsWith("uid:"));
const pqrs = tablas.filter((t) => t.table === "pqrs").map((t) => t.columns);
const res = resolverUids(chats, clientes, reg.pendientes, pqrs);
for (const [uid, p] of res.uidAPersona) {
  p.uids = [...(p.uids ?? []), uid];
  p.uid ??= uid;
  reg.porUid.set(uid, p);
}
// Contador de IDs: parte del mayor ID ya asignado (reconciliación incluida), nunca reinicia.
// Nunca puede repetirse un ID, aunque la reconciliación haya traído IDs altos del registro previo.
const siguienteId = () => {
  const usados = new Set(personas.map((p) => p.id));
  let n = maxId;
  do { n++; } while (usados.has(`P${String(n).padStart(4, "0")}`));
  maxId = n;
  return `P${String(n).padStart(4, "0")}`;
};

// Solo los que no se pudieron resolver conservan persona provisional (nunca queda un nombre suelto).
let maxId = personas.reduce((mx, p) => Math.max(mx, Number(String(p.id).replace(/\D/g, "")) || 0), 0);
const sinResolver = new Set(res.decisiones.filter((d) => d.ancla === null).map((d) => d.uid));
for (const pend of reg.pendientes) {
  if (!sinResolver.has(pend.uid)) continue;
  const u = uids.find((x) => x.uid === pend.uid);
  const p: Persona = {
    id: siguienteId(),
    tipo: u?.title === "Cliente" ? "cliente" : "tercero",
    ancla: `uid:${pend.uid}`, nombre: pend.nombre,
    nombres: pend.nombre.split(" ").slice(0, 1), apellidos: pend.nombre.split(" ").slice(1),
    genero: "?", uid: pend.uid, liga: "pendiente", notas: `${pend.candidatos.length} candidatos`,
  };
  personas.push(p);
  reg.porUid.set(pend.uid, p);
}
const dirReg = process.env.REGISTRO ?? "registro";
mkdirSync(dirReg, { recursive: true });
writeFileSync(`${dirReg}/resolucion.json`, JSON.stringify({ decisiones: res.decisiones, conflictos: res.conflictos }, null, 1));

// ── 1a-bis. Reconciliación con el registro anterior ────────────────────
// El registro solo crece: si esta persona ya existía (aunque venga con otro cliente_id) conserva
// su ID y su ancla, y por lo tanto su seudónimo.
const previo = cargarRegistro();
let reconciliacion = null;
if (previo && previo.personas.length) {
  const r = reconciliar(previo.personas, personas);
  reconciliacion = { reutilizadas: r.reutilizadas, nuevas: r.nuevas, retiradas: r.retiradas, detalle: r.detalle };
  personas.length = 0;
  personas.push(...r.personas);
  for (const uid of [...reg.porUid.keys()]) {
    const re = personas.find((x) => (x.uids ?? []).includes(uid) || x.uid === uid);
    if (re) reg.porUid.set(uid, re);
  }
}

// ── 1b. Terceros: personas que solo viven en el texto o en un correo suelto ──
const yaConocidas = new Set<string>();
const yaConocidosCorreos = new Set<string>();
for (const p of personas) {
  yaConocidas.add(norm(p.nombre));
  for (const f of formasDe(p)) if (f.tipo === "nombre_completo" || f.tipo === "nombre_apellido") yaConocidas.add(norm(f.valor));
  if (p.correo) yaConocidosCorreos.add(p.correo.toLowerCase());
}
const camposTerceros: { registro: string; campo: string; texto: string }[] = [];
for (const c of chats) {
  camposTerceros.push({ registro: c.id, campo: "text", texto: c.text });
  for (const a of c.attachments) camposTerceros.push({ registro: c.id, campo: "attachments.filename", texto: a.filename });
}
for (const d of docs) {
  camposTerceros.push({ registro: d.id, campo: "body", texto: d.body });
  camposTerceros.push({ registro: d.id, campo: "title", texto: d.title });
  camposTerceros.push({ registro: d.id, campo: "filename", texto: d.filename });
  for (const [k, v] of Object.entries(d.metadata)) camposTerceros.push({ registro: d.id, campo: k, texto: v });
}
for (const t of tablas) for (const [k, v] of Object.entries(t.columns)) camposTerceros.push({ registro: t.id, campo: k, texto: v });

const cedulasConocidas = new Set(personas.map((p) => p.cedula).filter(Boolean) as string[]);
const candidatos = [
  ...buscarCandidatos(camposTerceros, yaConocidas, yaConocidosCorreos),
  ...cedulasHuerfanas(camposTerceros, cedulasConocidas),
];
// Veto de Jev: si el modelo (con probabilidad ≥ 0,85 y ya en caché) dice que la cadena no es una
// persona, no se crea tercero. Nunca se llama a la red aquí: solo se lee registro/jev-decisiones.json.
const jevCadenas: Record<string, string> = (() => {
  const f = `${process.env.REGISTRO ?? "registro"}/jev-decisiones.json`;
  if (!existsSync(f)) return {};
  try { return JSON.parse(readFileSync(f, "utf8")).cadenas ?? {}; } catch { return {}; }
})();
const vetadosJev = candidatos.filter((c) => c.nombre && (jevCadenas[c.nombre] === "organizacion" || jevCadenas[c.nombre] === "lugar"));
const candidatosVivos = candidatos.filter((c) => !vetadosJev.includes(c));
const excepcionesGenero = (nombres: string[]) => generoDe(nombres);
const nuevosTerceros = candidatosVivos.map((c) => aPersona(c, siguienteId(), excepcionesGenero));
personas.push(...nuevosTerceros);
const dirRegistro = process.env.REGISTRO ?? "registro";
mkdirSync(dirRegistro, { recursive: true });
writeFileSync(`${dirRegistro}/terceros.json`, JSON.stringify({ candidatos: candidatos.length, terceros: nuevosTerceros }, null, 1));

// ── 2. Identidades (append-only) ───────────────────────────────────────
const prohibidas: string[] = [];
for (const p of personas) for (const f of formasDe(p)) if (f.valor.length >= 4) prohibidas.push(f.valor);
const regenerar = process.argv.includes("--regenerar-identidades");
const idents = regenerar ? new Map<string, Identidad>() : cargarIdentidades();
const usados = new Set<string>();
const anotarUsados = (i: Identidad) => {
  for (const v of [i.nombre_completo, i.nombre_apellido, i.correo, i.cedula, i.celular, i.nacimiento, i.direccion, i.placa])
    usados.add(v.toLowerCase());
};
for (const i of idents.values()) anotarUsados(i);
for (const p of personas) {
  const existente = idents.get(p.ancla);
  if (existente) { anotarUsados(existente); continue; }
  const i = generarIdentidad(p, { sal: SAL, prohibidas, usados });
  idents.set(p.ancla, i);
  anotarUsados(i);
}
// ── 2b. Ajuste mínimo de identidades que chocan con formas NUEVAS ─────────────
// Las fuentes crecen y pueden traer un nombre/correo que coincida con un seudónimo ya asignado.
// Cambiar la identidad entera rompería la consistencia, así que se corrige SOLO el campo que
// choca (correo, celular o cédula) y se deja constancia en registro/ajustes-identidad.json.
const ajustesIdentidad: { ancla: string; campo: string; antes: string; despues: string }[] = [];
const normalizadas = new Map<string, string>();

// ── 2b-1. Colisión de NOMBRE: una fuente nueva trae un nombre que coincide con un seudónimo ya
// asignado (total o parcialmente). Se redibuja la identidad con otra semilla, conservando género,
// tipo y documento, porque un seudónimo que reproduce un nombre real deja de ser seudónimo.
{
  const reales = [...new Set(prohibidas.map((v) => norm(v)))].filter((v) => v.split(" ").length >= 2 && v.length >= 7);
  const yaNombres = new Set([...idents.values()].map((i) => norm(i.nombre_completo)));
  const chocaNombre = (nombre: string) => {
    const n = norm(nombre);
    return reales.some((r) => n === r || n.startsWith(r + " ") || r.startsWith(n + " "));
  };
  for (const p of personas) {
    const i = idents.get(p.ancla);
    if (!i || !chocaNombre(i.nombre_completo)) continue;
    for (let variante = 1; variante <= 40; variante++) {
      const cand = generarIdentidad(p, { sal: `${SAL}#r${variante}`, prohibidas, usados: yaNombres });
      if (chocaNombre(cand.nombre_completo)) continue;
      if (yaNombres.has(norm(cand.nombre_completo))) continue;
      if (normalizadas.has(norm(cand.correo))) continue;
      ajustesIdentidad.push({ ancla: p.ancla, campo: "nombre_completo", antes: i.nombre_completo, despues: cand.nombre_completo });
      Object.assign(i, {
        nombre_completo: cand.nombre_completo, nombre_apellido: cand.nombre_apellido, nombre: cand.nombre,
        correo: cand.correo, handle: cand.handle, filename_token: cand.filename_token,
      });
      yaNombres.add(norm(cand.nombre_completo));
      break;
    }
  }
}

{
  for (const v of prohibidas) normalizadas.set(norm(v), v);
  const yaUsados = new Set<string>();
  for (const i of idents.values()) for (const c of [i.correo, i.celular, i.cedula]) if (c) yaUsados.add(norm(c));
  for (const p of personas) {
    const i = idents.get(p.ancla);
    if (!i) continue;
    for (const campo of ["correo", "celular", "cedula"] as const) {
      const valor = i[campo];
      if (!valor) continue;
      if (!normalizadas.has(norm(valor))) continue; // no choca con ninguna forma real
      let nuevo = valor;
      for (let intento = 1; intento <= 50 && (normalizadas.has(norm(nuevo)) || yaUsados.has(norm(nuevo))); intento++) {
        if (campo === "correo") {
          const [local, dominio] = valor.split("@");
          nuevo = `${local}${intento}@${dominio}`;
        } else {
          const d = valor.replace(/\D/g, "");
          nuevo = d.slice(0, -1) + String((Number(d.slice(-1)) + intento) % 10);
          if (nuevo === d) nuevo = d.slice(0, -2) + String((Number(d.slice(-2)) + intento) % 100).padStart(2, "0");
        }
      }
      if (nuevo !== valor) {
        yaUsados.delete(norm(valor));
        yaUsados.add(norm(nuevo));
        i[campo] = nuevo;
        ajustesIdentidad.push({ ancla: p.ancla, campo, antes: valor, despues: nuevo });
      }
    }
  }
  if (ajustesIdentidad.length) {
    mkdirSync(process.env.REGISTRO ?? "registro", { recursive: true });
    writeFileSync(`${process.env.REGISTRO ?? "registro"}/ajustes-identidad.json`,
      JSON.stringify({ generado: new Date().toISOString(), ajustes: ajustesIdentidad }, null, 1));
  }
}

// Los marcadores llevan el ID de persona; el dibujo busca por id.
const identPorId = new Map<string, Identidad>();
for (const p of personas) {
  const i = idents.get(p.ancla);
  if (i) identPorId.set(p.id, { ...i, entity_id: p.id });
}
// Identidades cuya ancla dejó de ser principal (personas fusionadas por la misma cédula): se podan
// para que el registro no crezca con seudónimos que ya nadie usa. La persona conserva el suyo.
let podadas = 0;
{
  const principales = new Set(personas.map((p) => p.ancla));
  for (const ancla of [...idents.keys()]) if (!principales.has(ancla)) { idents.delete(ancla); podadas++; }
}
guardarIdentidades(idents);
guardar(reg);

// ── 3. Índices de detección ────────────────────────────────────────────
const idx = indexar(personas, formasDe);
const formasDigitos = personas.flatMap((p) =>
  formasDe(p)
    .map((f) => ({ p, f, digitos: f.valor.replace(/\D/g, "") }))
    .filter((x) => x.digitos.length >= 6 && !/[a-zA-Z]/.test(x.f.valor) && x.digitos.length >= 0.6 * x.f.valor.length),
);

// ── 4. Cuasi-identificadores ───────────────────────────────────────────
const SECTORES: [RegExp, string][] = [
  [/medic|enferm|salud|odont|fisioter|psicolog|nutri|veterinar|m[ée]dic/i, "la salud"],
  [/abogad|jur[ií]dic|notari|legal/i, "lo legal"],
  [/docente|profesor|maestr|educaci|pedagog/i, "la educación"],
  [/ingenier|software|sistema|program|desarroll|tecnolog|datos|analista de datos|soporte t/i, "la tecnología"],
  [/conductor|transport|taxi|repart|domicili|mensajer/i, "el transporte"],
  [/construc|obra|arquitect|electric|plomer|maestro/i, "la construcción"],
  [/fabrica|manufactur|operari|producci|industrial/i, "la manufactura"],
  [/contad|contadora|financ|banc|tesorer|auditor/i, "las finanzas"],
  [/comerci|vended|tendero|mercanc|distribuid|almac/i, "el comercio"],
  [/disen|dise[ñn]|fot[óo]graf|artis|creativ|musico|m[úu]sic|publicist|marketing|comunicac|periodist/i, "las industrias creativas"],
  [/turism|hotel|restaurant|gastronom|cocin|meser/i, "el turismo"],
  [/agro|agricult|ganad|camp/i, "el agro"],
];
const sectorDe = (ocupacion: string): string => {
  for (const [rx, s] of SECTORES) if (rx.test(ocupacion)) return s;
  return "los servicios";
};
const ocupaciones = new Map<string, string>(); // original → "profesional de …"
for (const t of tablas) {
  if (t.table !== "clientes") continue;
  const o = t.columns.ocupacion ?? "";
  if (o && !ocupaciones.has(o) && !/^profesional de\b/i.test(o)) ocupaciones.set(o, `profesional de ${sectorDe(o)}`);
}
// barrio → otro barrio de la misma ciudad (del propio corpus)
const barriosPorCiudad = new Map<string, string[]>();
for (const t of tablas) {
  if (t.table !== "clientes") continue;
  const c = t.columns.ciudad, b = t.columns.barrio;
  if (!c || !b) continue;
  const arr = barriosPorCiudad.get(c) ?? [];
  if (!arr.includes(b)) arr.push(b);
  barriosPorCiudad.set(c, arr);
}
const otroBarrio = (ciudad: string, barrio: string): string => {
  const arr = (barriosPorCiudad.get(ciudad) ?? []).filter((b) => b !== barrio);
  return arr.length ? arr[Math.abs(hash(barrio)) % arr.length] : "otro barrio";
};
const hash = (s: string): number => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
};
// ocupación y barrio en texto libre
const ocupRx = [...ocupaciones.keys()].sort((a, b) => b.length - a.length).map((o) => ({
  original: o, rx: new RegExp(`(?<![\\p{L}])${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "giu"), sector: ocupaciones.get(o)!,
}));
const todosBarrios = [...new Set([...barriosPorCiudad.values()].flat())].sort((a, b) => b.length - a.length);
const ciudadDeBarrio = new Map<string, string>();
for (const [c, bs] of barriosPorCiudad) for (const b of bs) if (!ciudadDeBarrio.has(b)) ciudadDeBarrio.set(b, c);
const barrioRx = todosBarrios.map((b) => ({ b, rx: new RegExp(`(?<![\\p{L}])${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "giu"), ciudad: ciudadDeBarrio.get(b) ?? "" }));

// El año solo se generaliza cuando es parte de la combinación que identifica (vinculación).
// Un año suelto en una transacción o en un documento no se toca: eso es utilidad.
const RX_ANIO_VINCULACION = /\b((?:cliente|vinculad[oa]|socio|usuari[oa]|con nosotros|en la entidad|llevo)\b[^\d]{0,28}?)((?:19|20)\d{2})\b/gi;
function cuasiTexto(texto: string): string {
  let s = texto;
  for (const { rx, sector } of ocupRx) s = s.replace(rx, `profesional de ${sector}`);
  for (const { rx, ciudad } of barrioRx) s = s.replace(rx, ciudad);
  s = s.replace(RX_ANIO_VINCULACION, (_m, antes: string) => `${antes}hace unos años`);
  return s;
}

// ── 4b. Identificadores huérfanos (placa, pasaporte, dirección, celular/cédula con contexto) ──
const valoresFalsos = new Set<string>();
for (const i of identPorId.values())
  for (const v of [i.nombre_completo, i.nombre_apellido, i.nombre, i.correo, i.celular, i.cedula, i.direccion, i.placa, i.handle])
    if (v) valoresFalsos.add(norm(v));
const realesNorm = new Set(prohibidas.map((v) => norm(v)));
const yaCubierto = (v: string) => valoresFalsos.has(norm(v)) || realesNorm.has(norm(v));
const huerfanos = new Map<string, { tipo: string; original: string; reemplazo: string; registros: Set<string> }>();

function limpiarHuerfanos(texto: string, registro: string): string {
  if (!texto) return texto;
  const hs: Huerfano[] = buscarHuerfanos(texto, SAL, yaCubierto);
  if (!hs.length) return texto;
  for (const h of hs) {
    const clave = `${h.tipo}|${norm(h.original)}`;
    const prev = huerfanos.get(clave);
    if (prev) prev.registros.add(registro);
    else huerfanos.set(clave, { tipo: h.tipo, original: h.original, reemplazo: h.reemplazo, registros: new Set([registro]) });
  }
  return reemplazarHuerfanos(texto, hs);
}

// ── 5. Marcado y dibujo ────────────────────────────────────────────────
interface Aparicion { tipos: Set<TipoForma>; originales: Set<string>; nombreDibujado?: string }
const apariciones = new Map<string, Aparicion>(); // por persona
const registrosPorPersona = new Map<string, Set<string>>();
const mencionados = new Set<string>();
let marcasTotal = 0;

function anotar(p: Persona, tipo: TipoForma, original: string, registro: string, dotted = false) {
  let a = apariciones.get(p.id);
  if (!a) { a = { tipos: new Set(), originales: new Set() }; apariciones.set(p.id, a); }
  a.tipos.add(tipo);
  if (original.length >= 3) a.originales.add(original);
  // El `name` del diccionario tiene que ser una forma que de verdad se dibujó en algún registro.
  if (tipo === "nombre_completo" || tipo === "nombre_apellido" || tipo === "nombre") {
    const i = idents.get(p.id);
    const dibujo = tipo === "nombre_completo" ? i?.nombre_completo : tipo === "nombre_apellido" ? i?.nombre_apellido : i?.nombre;
    if (dibujo && (!a.nombreDibujado || dibujo.length > a.nombreDibujado.length)) a.nombreDibujado = dibujo;
  }
  const s = registrosPorPersona.get(p.id) ?? new Set();
  s.add(registro);
  registrosPorPersona.set(p.id, s);
  mencionados.add(p.id);
}

/** El autor se resuelve por uid (exacto), no por nombre: los homónimos dejan de confundirse. */
function procesarAutor(c: Chat): string {
  const p = c._uid ? reg.porUid.get(c._uid) : undefined;
  if (!p) return procesar(c.author, c.id);
  const tipo = formaDeAutor(c.author);
  anotar(p, tipo, c.author, c.id);
  marcasTotal++;
  return dibujarTexto(`⟦${p.id}·${tipo}⟧`, identPorId);
}

/** Igual que procesar(), pero dibujando lo que va dentro de un nombre de archivo. */
function procesarArchivo(texto: string, registro: string): string {
  if (!texto) return texto;
  const marcas = buscarMarcas(texto, idx, formasDigitos);
  if (!marcas.length) return texto;
  marcasTotal += marcas.length;
  for (const m of marcas) anotar(m.persona, m.forma.tipo, texto.slice(m.ini, m.fin), registro);
  return dibujarArchivo(marcar(texto, marcas), identPorId);
}

function procesar(texto: string, registro: string): string {
  if (!texto) return texto;
  const marcas = buscarMarcas(texto, idx, formasDigitos);
  if (marcas.length) {
    marcasTotal += marcas.length;
    for (const m of marcas) anotar(m.persona, m.forma.tipo, texto.slice(m.ini, m.fin), registro);
    return dibujarTexto(marcar(texto, marcas), identPorId);
  }
  return texto;
}

// ── 6. Registros ───────────────────────────────────────────────────────
mkdirSync(out, { recursive: true });
const jsonl = (rs: object[]) => rs.map((r) => JSON.stringify(r)).join("\n") + "\n";

const chatsOut = chats.map((c) => ({
  id: c.id, thread_id: c.thread_id,
  author: procesarAutor(c),
  ts: c.ts,
  text: limpiarHuerfanos(cuasiTexto(procesar(c.text, c.id)), c.id),
  attachments: c.attachments.map((a) => ({ filename: limpiarHuerfanos(procesarArchivo(a.filename, c.id), c.id) })),
}));

const docsOut = docs.map((d) => ({
  id: d.id, format: d.format,
  filename: limpiarHuerfanos(procesarArchivo(d.filename, d.id), d.id),
  title: limpiarHuerfanos(procesar(d.title, d.id), d.id),
  body: limpiarHuerfanos(cuasiTexto(procesar(d.body, d.id)), d.id),
  metadata: Object.fromEntries(Object.entries(d.metadata).map(([k, v]) => [k, limpiarHuerfanos(procesar(v, d.id), d.id)])),
}));

// Una fila del maestro es de SU persona (ancla = id de la fila), no de quien se llame igual.
// Si el valor de la columna es exactamente el atributo de esa persona, se dibuja su identidad;
// si no coincide (una nota, un tercero, un valor raro), se cae al reemplazo por texto.
const personaDeFila = new Map(personas.map((p) => [p.ancla, p]));
const soloNum = (s: string) => s.replace(/\D/g, "");

function valorDirecto(p: Persona, col: string, valor: string, registro: string): string | null {
  const k = col.toLowerCase();
  let tipo: TipoForma | null = null;
  if (/^(nombre_completo|nombre)$/.test(k)) {
    if (norm(valor) === norm(p.nombre)) tipo = palabras(valor).length >= 3 ? "nombre_completo" : "nombre_apellido";
  } else if (/^(num_doc|documento|cedula)$/.test(k)) {
    if (p.cedula && soloNum(valor) === soloNum(p.cedula) && soloNum(valor).length >= 6)
      tipo = /[^\d]/.test(valor) ? "cedula_dots" : "cedula";
  } else if (k === "correo") {
    if (p.correo && valor.toLowerCase() === p.correo.toLowerCase()) tipo = "correo";
  } else if (k === "celular") {
    if (p.celular && soloNum(valor) === soloNum(p.celular)) tipo = "celular";
  } else if (k === "direccion") {
    if (p.direccion && norm(valor) === norm(p.direccion)) tipo = "direccion";
  } else if (k === "fecha_nacimiento") {
    if (p.nacimiento && valor.trim() === p.nacimiento) tipo = "nacimiento";
  }
  if (!tipo) return null;
  anotar(p, tipo, valor, registro);
  marcasTotal++;
  return dibujarTexto(`⟦${p.id}·${tipo}⟧`, identPorId);
}

const tablasOut = tablas.map((t) => {
  const propia = personaDeFila.get(t.id.slice(t.table.length + 1)); // id = "<tabla>:<ancla>"
  const columns: Record<string, string> = {};
  for (const [k, v] of Object.entries(t.columns)) {
    let valor = procesar(v, t.id);
    if (propia) { const directo = valorDirecto(propia, k, v, t.id); if (directo !== null) valor = directo; }
    if (t.table === "clientes" && k === "ocupacion" && ocupaciones.has(v)) valor = ocupaciones.get(v)!;
    if (t.table === "clientes" && k === "barrio") valor = otroBarrio(t.columns.ciudad, v);
    columns[k] = limpiarHuerfanos(valor, t.id);
  }
  return { id: t.id, table: t.table, columns };
});

// ── 7. entities.json ───────────────────────────────────────────────────
const CONSERVADAS: { id: string; nombres: string[]; tipo: string }[] = [
  { id: "kept_001", tipo: "organization_or_place", nombres: ["Bancolombia", "Nequi", "Daviplata", "Davivienda", "Banco de Bogotá", "BBVA", "Banco Popular", "Banco Caja Social", "Scotiabank Colpatria", "Bancoomeva", "Banco Pichincha", "Itaú", "Lulo Bank", "Nu"] },
  { id: "kept_002", tipo: "organization_or_place", nombres: ["Superfinanciera", "Superintendencia Financiera", "UIAF", "DIAN", "Banco de la República", "Fogafín"] },
  { id: "kept_003", tipo: "organization_or_place", nombres: ["PSE", "Transfiya", "Éxito", "Carulla", "Jumbo", "Olímpica", "D1", "Ara", "Rappi", "Uber", "DiDi", "Kipu Pay", "Kipi"] },
];
// Salida ya construida, indexada por id: sirve para comprobar qué seudónimo aparece de verdad.
const registroPorId = new Map<string, any>();
for (const r of [...chatsOut, ...docsOut, ...tablasOut] as any[]) registroPorId.set(r.id, r);

const entities: object[] = [];
for (const p of personas) {
  if (!mencionados.has(p.id)) continue;
  const a = apariciones.get(p.id)!;
  const i = idents.get(p.ancla)!;
  const pseud: Record<string, string> = {};
  const valorPorTipo: Partial<Record<TipoForma, string>> = {
    nombre_completo: i.nombre_completo, nombre_apellido: i.nombre_apellido, nombre: i.nombre,
    correo: i.correo, celular: i.celular, cedula: i.cedula, direccion: i.direccion,
    nacimiento: i.nacimiento, uid: i.uid, handle: i.handle, filename_token: i.filename_token, cedula_dots: i.cedula,
  };
  for (const tipo of a.tipos) {
    const esNombre = tipo === "nombre_completo" || tipo === "nombre_apellido" || tipo === "nombre";
    if (esNombre) {
      // Por defecto se conserva la forma más larga dibujada (así el diccionario es estable entre
      // corridas). Solo si esa forma no aparece en ningún registro se baja a una que sí aparezca,
      // porque el validador exige que cada seudónimo esté en alguno de sus records.
      const preferida = a.nombreDibujado ?? i.nombre_completo;
      const textos = [...(registrosPorPersona.get(p.id) ?? [])].map((rid) => {
        const r = registroPorId.get(rid);
        return r ? JSON.stringify(r) : "";
      });
      const aparece = (v: string | undefined) => !!v && textos.some((t) => t.includes(v));
      pseud.name = aparece(preferida)
        ? preferida
        : [i.nombre_apellido, i.nombre_completo, i.nombre].find((v) => aparece(v)) ?? preferida;
      continue;
    }
    const v = valorPorTipo[tipo];
    if (!v) continue;
    pseud[tipo] = v;
  }
  entities.push({
    entity_id: p.id, type: "person", originals: [...a.originales].sort(),
    pseudonyms: pseud, records: [...(registrosPorPersona.get(p.id) ?? [])].sort(),
  });
}
// Cada identificador huérfano reemplazado entra al diccionario (honestidad del diccionario).
let nIdf = 0;
for (const h of huerfanos.values()) {
  entities.push({
    entity_id: `idf_${String(++nIdf).padStart(4, "0")}`,
    type: "identifier",
    originals: [h.original],
    pseudonyms: { [h.tipo]: h.reemplazo },
    records: [...h.registros].sort(),
  });
}

for (const k of CONSERVADAS) {
  const presentes = k.nombres.filter((n) => [...chats, ...docs, ...tablas].some((r) =>
    ("text" in r && typeof r.text === "string" && r.text.includes(n)) ||
    ("body" in r && typeof r.body === "string" && r.body.includes(n)) ||
    ("columns" in r && Object.values(r.columns).some((v) => v.includes(n)))));
  if (!presentes.length) continue;
  entities.push({
    entity_id: k.id, type: k.tipo, originals: presentes, pseudonyms: {},
    kept: true, reason: "organización, lugar, marca o figura pública; no es persona natural", records: [],
  });
}

writeFileSync(`${out}/chats.jsonl`, jsonl(chatsOut));
writeFileSync(`${out}/docs.jsonl`, jsonl(docsOut));
writeFileSync(`${out}/tables.jsonl`, jsonl(tablasOut));
writeFileSync(`${out}/entities.json`, JSON.stringify({ entities }, null, 1));

const sinPersona = [...registrosPorPersona.keys()].length;
console.log(JSON.stringify({
  segundos: Math.round(((Date.now() - t0) / 100) / 10),
  registros: { chats: chatsOut.length, docs: docsOut.length, tablas: tablasOut.length },
  personas: personas.length, entidades_emitidas: entities.length,
  marcas: marcasTotal, personas_mencionadas: sinPersona,
  pendientes_sin_resolver: reg.pendientes.length,
  reconciliacion,
  huerfanos: huerfanos.size,
  jev: { veto_organizacion_o_lugar: vetadosJev.length },
  identidades_ajustadas: ajustesIdentidad.length,
}, null, 1));

// Firma del esquema aceptado: la próxima corrida compara contra esto para avisar de columnas nuevas.
try {
  guardarFirmaColumnas(formaDelConjunto(process.env.DATA ?? "data"));
} catch { /* la firma es informativa: su fallo no tumba la salida */ }
