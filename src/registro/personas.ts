// Registro de personas: quién es quién, con un ID estable (P0001…) que nunca se reasigna.
// Fuente de verdad: las tablas (clientes.csv, empleados.xml) + users.json de Slack.
// Este módulo NO anonimiza: solo arma personas, las liga a sus uids y genera sus formas reales.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { norm, soloDigitos, palabras } from "../anon/texto.ts";

export type Tipo = "cliente" | "empleado" | "tercero" | "bot";
export type Genero = "f" | "m" | "?";

export interface Persona {
  id: string;
  tipo: Tipo;
  ancla: string;
  /** Todas las filas/anclas bajo las que se ha visto a esta persona (crece con las fuentes). */
  anclas?: string[]; // CL-…, KP-…, uid de Slack, o "texto:<slug>" para terceros
  nombre: string; // forma canónica (la más completa que conocemos)
  nombres: string[];
  apellidos: string[];
  genero: Genero;
  correo?: string;
  celular?: string;
  cedula?: string;
  direccion?: string;
  nacimiento?: string;
  ciudad?: string;
  barrio?: string;
  ocupacion?: string;
  cargo?: string;
  reporta_a?: string;
  uid?: string;
  /** Todos los uids de Slack de esta persona (una persona puede tener dos cuentas). */
  uids?: string[];
  liga: string; // cómo se ligó: correo | nombre | nombre+1apellido | ambiguo | sin_liga
  notas?: string;
}

export type TipoForma =
  | "nombre_completo" | "nombre_apellido" | "nombre" | "apellido"
  | "correo" | "celular" | "cedula" | "cedula_dots" | "direccion" | "nacimiento"
  | "handle" | "filename_token" | "uid";
export interface Forma { valor: string; tipo: TipoForma }

interface Tabla { id: string; table: string; columns: Record<string, string> }
interface InfoUid {
  uid: string; real_name: string; display_name: string; title: string; email: string; phone: string;
  bot: boolean; borrado: boolean; en_users: boolean; apariciones: Record<string, number>;
}

// ── Género ──────────────────────────────────────────────────────────────
const FEM_NO_A = ["carmen", "isabel", "pilar", "raquel", "soledad", "mercedes", "belen", "rocio", "amparo",
  "consuelo", "rosario", "milagros", "beatriz", "luz", "marisol", "yolanda", "irene", "ines", "ruth",
  "esther", "abigail", "judith", "elizabeth", "lourdes", "dolores", "trinidad", "concepcion", "ingrid",
  "mildred", "doris", "mabel", "nubia", "miriam", "myriam", "evelyn", "karen", "deisy", "nancy", "gladys",
  "lizeth", "liseth", "wendy", "sindy", "luz marina", "nohemi", "ivonne", "yvonne", "johanna", "vivian",
  "yeimi", "yenny", "yurani", "yurany", "gineth", "sara", "shirley", "nicol", "maria jose", "ana maria"];
const MAS_NO_O = ["ariel", "daniel", "gabriel", "miguel", "raul", "israel", "samuel", "emmanuel", "josue",
  "noe", "isaac", "jacob", "david", "edgar", "alexander", "javier", "nicolas", "andres", "julian",
  "sebastian", "adrian", "fabian", "german", "simon", "ramon", "martin", "agustin", "joaquin", "cristian",
  "jonathan", "brayan", "esteban", "ivan", "ruben", "wilson", "jhon", "john", "freddy", "jimmy", "alirio",
  "anibal", "leonel", "abel", "jeison", "yeison", "jair", "geovanny", "giovanny", "orlando", "harold",
  "juan esteban", "juan camilo", "luis fernando", "carlos andres", "diego armando",
];

function cargarExcepciones(ruta = "knowledge/genero-nombres.json"): Record<string, Genero> {
  if (!existsSync(ruta)) return {};
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch {
    return {};
  }
}

/** Género por nombre de pila. Heurística + excepciones; "?" cuando no hay evidencia. */
export function generoDe(nombres: string[], excepciones: Record<string, Genero> = {}): Genero {
  const pila = norm(nombres.join(" "))
    .replace(/^(juan|jose|maria|luis|carlos|diego|ana|pedro|jorge|miguel|francisco|jesus) /, (m) => m) // compuestos
    .trim();
  const primero = pila.split(" ")[0] ?? "";
  const dosPrimeros = palabras(pila).slice(0, 2).join(" ");
  for (const k of [dosPrimeros, primero]) {
    if (!k) continue;
    const ex = excepciones[k];
    if (ex) return ex;
    if (MAS_NO_O.includes(k)) return "m";
    if (FEM_NO_A.includes(k)) return "f";
  }
  if (!primero) return "?";
  // "María José", "Juan Camilo": manda el segundo solo si el primero es María/Juan/José.
  if (["maria", "jose", "juan", "ana", "luz"].includes(primero)) {
    const seg = palabras(pila)[1];
    if (seg) {
      if (MAS_NO_O.includes(seg) || seg.endsWith("o") || seg.endsWith("n") || seg.endsWith("r")) return "m";
      if (seg.endsWith("a") && !FEM_NO_A.includes(seg)) return primero === "maria" ? "f" : "m";
    }
  }
  if (primero.endsWith("a")) return "f";
  if (/[onsrlez]$/.test(primero)) return "m";
  return "?";
}

// ── Construcción ────────────────────────────────────────────────────────
export function leerJsonl<T>(ruta: string): T[] {
  return readFileSync(ruta, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as T);
}

function partirNombre(completo: string): { nombres: string[]; apellidos: string[] } {
  const p = completo.trim().split(/\s+/).filter(Boolean);
  if (p.length <= 2) return { nombres: p.slice(0, 1), apellidos: p.slice(1) };
  if (p.length === 3) return { nombres: p.slice(0, 1), apellidos: p.slice(1) };
  return { nombres: p.slice(0, 2), apellidos: p.slice(2) };
}

export interface Registro {
  personas: Persona[];
  porUid: Map<string, Persona>;
  pendientes: { uid: string; nombre: string; candidatos: string[] }[];
  avisos: string[];
}

export function construir(
  tablas: Tabla[],
  uids: InfoUid[],
  opciones: { genero?: Record<string, Genero>; desde?: string } = {},
): Registro {
  const avisos: string[] = [];
  const pendientes: { uid: string; nombre: string; candidatos: string[] }[] = [];
  const excepciones = opciones.genero ?? cargarExcepciones();
  const personas: Persona[] = [];
  const porUid = new Map<string, Persona>();
  let n = 0;
  const nuevoId = () => `P${String(++n).padStart(4, "0")}`;

  const clientes = tablas.filter((t) => t.table === "clientes").map((t) => t.columns);
  const empleados = tablas.filter((t) => t.table === "empleados").map((t) => t.columns);
  const bots = uids.filter((u) => u.bot);

  // 1. Empleados: correo corporativo idéntico en empleados.xml y users.json → liga exacta.
  const uidPorCorreo = new Map<string, InfoUid>();
  for (const u of uids) if (u.email) uidPorCorreo.set(u.email.toLowerCase(), u);
  for (const e of empleados) {
    const partes = partirNombre(e.nombre);
    const u = uidPorCorreo.get((e.correo ?? "").toLowerCase());
    const p: Persona = {
      id: nuevoId(), tipo: "empleado", ancla: e.id, nombre: e.nombre, ...partes,
      genero: generoDe(partes.nombres, excepciones), correo: e.correo, celular: e.celular,
      cedula: e.documento, nacimiento: e.fecha_nacimiento, cargo: e.cargo, ciudad: e.ciudad,
      reporta_a: e.reporta_a, uid: u?.uid, liga: u ? "correo" : "sin_liga",
    };
    if (!u) avisos.push(`empleado ${e.id} sin uid: ${e.nombre}`);
    personas.push(p);
    if (u) porUid.set(u.uid, p);
  }

  // 2. Clientes: correo propio (78 de 149) → liga exacta; resto, por nombre.
  const uidLibres = uids.filter((u) => !u.bot && !u.borrado && !porUid.has(u.uid));
  const porNombreExacto = new Map<string, Persona[]>();
  const porDosTokens = new Map<string, Persona[]>();
  for (const c of clientes) {
    const partes = partirNombre(c.nombre_completo);
    const clave = norm(c.nombre_completo);
    const dos = palabras(clave).slice(0, 2).join(" ");
    const p: Persona = {
      id: nuevoId(), tipo: "cliente", ancla: c.cliente_id, nombre: c.nombre_completo, ...partes,
      genero: generoDe(partes.nombres, excepciones), correo: c.correo, celular: c.celular,
      cedula: c.num_doc, direccion: c.direccion, nacimiento: c.fecha_nacimiento, ciudad: c.ciudad,
      barrio: c.barrio, ocupacion: c.ocupacion, liga: "sin_liga",
    };
    personas.push(p);
    for (const [mapa, k] of [[porNombreExacto, clave], [porDosTokens, dos]] as const) {
      const arr = mapa.get(k) ?? [];
      arr.push(p);
      mapa.set(k, arr);
    }
  }

  // 3. Liga cliente ↔ uid: correo > nombre exacto único > nombre + 1er apellido único.
  for (const u of uidLibres) {
    if (u.title !== "Cliente") continue;
    const correo = u.email.toLowerCase();
    let p = clientes.find((c) => c.correo?.toLowerCase() === correo)
      ? personas.find((x) => x.tipo === "cliente" && x.correo?.toLowerCase() === correo)
      : undefined;
    if (p) { p.uid = u.uid; p.liga = "correo"; porUid.set(u.uid, p); continue; }
    const exactos = porNombreExacto.get(norm(u.real_name)) ?? [];
    if (exactos.length === 1) { p = exactos[0]; p.uid = u.uid; p.liga = "nombre"; porUid.set(u.uid, p); continue; }
    const dos = porDosTokens.get(palabras(u.real_name).slice(0, 2).join(" ")) ?? [];
    if (dos.length === 1) { p = dos[0]; p.uid = u.uid; p.liga = "nombre+1apellido"; porUid.set(u.uid, p); continue; }
    // Ambiguo: el uid queda pendiente hasta resolver con evidencia del texto (T2 del plan).
    // Nunca se inventa una persona para un uid: eso duplicaría a un cliente real.
    pendientes.push({ uid: u.uid, nombre: u.real_name, candidatos: (dos.length ? dos : exactos).map((x) => x.ancla) });
  }

  // 4. El bot se conserva: sin ID, sin formas.
  for (const b of bots) avisos.push(`bot conservado: ${b.real_name || b.uid}`);
  return { personas, porUid, pendientes, avisos };
}

/** Formas reales de una persona, en el orden en que conviene reemplazarlas (largas primero). */
export function formasDe(p: Persona): Forma[] {
  const f: Forma[] = [];
  const nombres = p.nombres.join(" ");
  const [a1, a2] = p.apellidos;
  if (a1 && a2) f.push({ valor: `${nombres} ${a1} ${a2}`, tipo: "nombre_completo" });
  if (a1) f.push({ valor: `${nombres} ${a1}`, tipo: "nombre_apellido" });
  if (nombres) f.push({ valor: nombres, tipo: "nombre" });
  if (p.correo) {
    f.push({ valor: p.correo, tipo: "correo" });
    const local = p.correo.split("@")[0];
    if (local.length >= 4) f.push({ valor: `${local}@`, tipo: "correo" }); // correo deletreado con @
  }
  if (p.celular) f.push({ valor: p.celular, tipo: "celular" });
  if (p.cedula) {
    f.push({ valor: p.cedula, tipo: "cedula" });
    if (p.cedula.length >= 7) f.push({ valor: p.cedula.replace(/\B(?=(\d{3})+(?!\d))/g, "."), tipo: "cedula" });
  }
  if (p.direccion) f.push({ valor: p.direccion, tipo: "direccion" });
  if (p.nacimiento) f.push({ valor: p.nacimiento, tipo: "nacimiento" });
  if (p.correo && p.correo.includes("@kipupay.co")) f.push({ valor: p.correo.split("@")[0], tipo: "handle" });
  if (a1) {
    const token = `${norm(nombres).replace(/\s+/g, "_")}_${norm(a1).replace(/\s+/g, "_")}`;
    f.push({ valor: token, tipo: "filename_token" });
  }
  for (const u of p.uids ?? (p.uid ? [p.uid] : [])) f.push({ valor: u, tipo: "uid" });
  return f;
}

/** Índice de formas por primera palabra, para detectar menciones en una pasada. */
export function indexarFormas(personas: Persona[]): Map<string, { p: Persona; f: Forma }[]> {
  const idx = new Map<string, { p: Persona; f: Forma }[]>();
  for (const p of personas) {
    for (const f of formasDe(p)) {
      const w = palabras(f.valor)[0];
      if (!w) continue;
      const arr = idx.get(w) ?? [];
      arr.push({ p, f });
      idx.set(w, arr);
    }
  }
  return idx;
}

export function guardar(registro: Registro, ruta = `${process.env.REGISTRO ?? "registro"}/personas.json`): void {
  mkdirSync(ruta.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(ruta, JSON.stringify({
    generado: new Date().toISOString(),
    personas: registro.personas,
    pendientes: registro.pendientes,
    avisos: registro.avisos,
  }, null, 1));
}

export function cargar(ruta = `${process.env.REGISTRO ?? "registro"}/personas.json`): Registro | null {
  if (!existsSync(ruta)) return null;
  const j = JSON.parse(readFileSync(ruta, "utf8"));
  const personas: Persona[] = j.personas ?? [];
  const porUid = new Map<string, Persona>();
  for (const p of personas) if (p.uid) porUid.set(p.uid, p);
  return { personas, porUid, pendientes: j.pendientes ?? [], avisos: j.avisos ?? [] };
}

export { soloDigitos };
