// /anonymize en vivo: recibe registros nuevos (JSON por stdin) y los anonimiza con las MISMAS
// identidades del registro. Persona conocida → su seudónimo de siempre; persona nueva → ID y
// identidad nuevos, persistidos (el registro solo crece).
// Uso: echo '{"chats":[...]}' | node scripts/anonymize-lote.ts
import { readFileSync, existsSync } from "node:fs";
import { norm } from "../src/anon/texto.ts";
import { formasDe, guardar, cargar, generoDe, type Persona, type TipoForma } from "../src/registro/personas.ts";
import { aPersona } from "../src/registro/terceros.ts";
import { generarIdentidad, cargarIdentidades, guardarIdentidades } from "../src/anon/identidades.ts";
import { indexar, buscarMarcas, marcar, dibujarTexto, dibujarArchivo } from "../src/anon/motor.ts";
import { buscarHuerfanos, reemplazarHuerfanos } from "../src/anon/huerfanos.ts";

const SAL = process.env.HMAC_SAL ?? "frontier-elsebastech-2026-sal";
const entrada = JSON.parse(readFileSync(0, "utf8"));
const reg = cargar();
if (!reg) { console.error("no existe registro/personas.json: corre antes node scripts/anonimizar.ts"); process.exit(2); }
const personas = reg.personas;
const idents = cargarIdentidades(); // indexado por ANCLA
let cachePorId: Map<string, any> | null = null;
const porId = (): Map<string, any> => {
  if (!cachePorId) {
    cachePorId = new Map();
    for (const p of personas) {
      const i = idents.get(p.ancla);
      if (i) cachePorId.set(p.id, i);
    }
  }
  return cachePorId;
};
const prohibidas = personas.flatMap((p) => formasDe(p).map((f) => f.valor)).filter((v) => v.length >= 4);
const usados = new Set<string>();
for (const i of idents.values()) for (const v of [i.nombre_completo, i.correo, i.cedula, i.celular]) usados.add(v.toLowerCase());

const nuevo = (nombre: string, correo?: string, extra: { cedula?: string; celular?: string; direccion?: string } = {}): Persona => {
  const id = `P${String(personas.length + 1).padStart(4, "0")}`;
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const nombres = partes.length > 2 ? partes.slice(0, 2) : partes.slice(0, 1);
  const p: Persona = {
    id, tipo: "tercero", ancla: `lote:${norm(nombre)}`, nombre: nombre.trim(),
    nombres, apellidos: partes.slice(nombres.length), genero: generoDe(nombres), correo,
    cedula: extra.cedula, celular: extra.celular, direccion: extra.direccion,
    liga: "lote",
  };
  personas.push(p);
  idents.set(p.ancla, generarIdentidad(p, { sal: SAL, prohibidas, usados }));
  cachePorId = null;
  return p;
};

let idx = indexar(personas, formasDe);
const formasDigitos = () =>
  personas.flatMap((p) => formasDe(p).map((f) => ({ p, f, digitos: f.valor.replace(/\D/g, "") }))
    .filter((x) => x.digitos.length >= 6 && !/[a-zA-Z]/.test(x.f.valor) && x.digitos.length >= 0.6 * x.f.valor.length));
let fd = formasDigitos();

const procesar = (texto: string): string => {
  if (!texto) return texto;
  const marcas = buscarMarcas(texto, idx, fd);
  const conPersonas = marcas.length ? dibujarTexto(marcar(texto, marcas), porId()) : texto;
  // Identificadores que no son de nadie del registro (pasaporte, placa, dirección…).
  const falsos = new Set<string>();
  for (const i of porId().values())
    for (const v of [i.nombre_completo, i.nombre_apellido, i.nombre, i.correo, i.celular, i.cedula, i.direccion, i.placa])
      if (v) falsos.add(norm(v));
  const hs = buscarHuerfanos(conPersonas, SAL, (v) => falsos.has(norm(v)));
  return hs.length ? reemplazarHuerfanos(conPersonas, hs) : conPersonas;
};

const procesarArchivo = (texto: string): string => {
  if (!texto) return texto;
  const marcas = buscarMarcas(texto, idx, fd);
  const dibujado = marcas.length ? dibujarArchivo(marcar(texto, marcas), porId()) : texto;
  const falsos = new Set<string>();
  for (const i of porId().values())
    for (const v of [i.nombre_completo, i.nombre_apellido, i.nombre, i.correo, i.celular, i.cedula, i.direccion, i.placa])
      if (v) falsos.add(norm(v));
  const hs = buscarHuerfanos(dibujado, SAL, (v) => falsos.has(norm(v)));
  return hs.length ? reemplazarHuerfanos(dibujado, hs) : dibujado;
};
const salida: { chats: any[]; docs: any[]; tables: any[]; nuevas: string[]; usadas: Set<string> } = { chats: [], docs: [], tables: [], nuevas: [], usadas: new Set() };
const registrarUso = (id: string) => salida.usadas.add(id);

// El payload puede venir de varias formas; se aceptan todas:
//   [ {..}, {..} ]                         lista de registros
//   { records | registros | items: [...] } lista envuelta
//   { chats:[], docs:[], tables:[] }       por fuente
//   { source:"chats", record:{...} }       registro con su fuente declarada
const listaCruda: any[] | null = Array.isArray(entrada)
  ? entrada
  : (entrada.records ?? entrada.registros ?? entrada.items ?? entrada.registros_nuevos ?? null);

const tipoDe = (r: any): "chats" | "docs" | "tables" => {
  const fuente = r?.source ?? r?.fuente ?? r?.tipo_registro;
  if (fuente === "chats" || fuente === "docs" || fuente === "tables") return fuente;
  const obj = r?.record ?? r; // registro envuelto
  if (obj?.columns) return "tables";
  if (obj?.body !== undefined || obj?.metadata) return "docs";
  return "chats";
};
const desenvolver = (r: any) => r?.record ?? r;

const chats: any[] = [];
const docs: any[] = [];
const tablas: any[] = [];
if (listaCruda && Array.isArray(listaCruda)) {
  for (const r of listaCruda) {
    const t = tipoDe(r);
    (t === "tables" ? tablas : t === "docs" ? docs : chats).push(desenvolver(r));
  }
} else {
  chats.push(...(entrada.chats ?? []));
  docs.push(...(entrada.docs ?? []));
  tablas.push(...(entrada.tables ?? entrada.tablas ?? []));
}

for (const c of chats) {
  let autor = c.author ?? "";
  const porUid = c._uid || c.uid ? reg.porUid.get(c._uid ?? c.uid) : undefined;
  // Si no hay uid, el nombre se resuelve con las FORMAS del registro ("Ana Ruiz" es forma
  // de "Ana Ruiz Ceballos"), no con el nombre completo exacto.
  const marcasAutor = porUid ? [] : buscarMarcas(autor, idx, fd);
  const p = porUid ?? (marcasAutor.length ? marcasAutor[0].persona : undefined);
  if (p) {
    registrarUso(p.id);
    const n = (autor.match(/[a-z0-9]+/gi) ?? []).length;
    const tipo: TipoForma = n >= 3 ? "nombre_completo" : n === 2 ? "nombre_apellido" : "nombre";
    autor = dibujarTexto(`⟦${p.id}·${tipo}⟧`, porId());
  } else if (autor.trim()) {
    const nuevoP = nuevo(autor);
    // Si en el mismo mensaje la persona nueva dicta su documento, ese documento es suyo: se le
    // asigna para que su identidad lo cubra desde el primer momento (y no quede como huérfano).
    const docPropio = /(?:\bcc\b|\bc\.c\.|c[eé]dula|documento|identificaci[oó]n)\D{0,14}(\d[\d.\s]{5,14}\d)/i.exec(String(c.text ?? ""));
    if (docPropio && !personas.some((q) => q !== nuevoP && (q.cedula ?? "").replace(/\D/g, "") === docPropio[1].replace(/\D/g, ""))) {
      nuevoP.cedula = docPropio[1].trim();
    }
    idx = indexar(personas, formasDe);
    fd = formasDigitos();
    registrarUso(nuevoP.id);
    salida.nuevas.push(nuevoP.id);
    autor = dibujarTexto(`⟦${nuevoP.id}·nombre_completo⟧`, porId());
  }
  salida.chats.push({ ...c, author: autor, text: procesar(c.text ?? ""), attachments: (c.attachments ?? []).map((a: any) => ({ filename: procesarArchivo(a.filename ?? "") })) });
}
for (const d of docs) {
  salida.docs.push({
    ...d, filename: procesarArchivo(d.filename ?? ""), title: procesar(d.title ?? ""), body: procesar(d.body ?? ""),
    metadata: Object.fromEntries(Object.entries(d.metadata ?? {}).map(([k, v]) => [k, procesar(String(v))])),
  });
}
for (const t of tablas) {
  // Antes de dibujar, la fila enseña quién es: si trae nombre y documento/correo/celular, esa
  // persona se registra (o se completa) para que TODOS sus datos se sustituyan, no solo el nombre.
  const c: Record<string, any> = t.columns ?? {};
  const nombreFila = String(c.nombre_completo ?? c.nombre ?? "").trim();
  const cedulaFila = String(c.num_doc ?? c.documento ?? c.cedula ?? "").trim();
  const correoFila = String(c.correo ?? "").trim();
  const celularFila = String(c.celular ?? "").trim();
  if (nombreFila) {
    const ya = buscarMarcas(nombreFila, idx, fd).find((m) => m.persona)?.persona;
    const palabrasFila = norm(nombreFila).split(/\s+/).filter(Boolean);
    const palabrasYa = ya ? norm(ya.nombre).split(/\s+/).filter(Boolean) : [];
    const esExtension = !!ya && palabrasFila.length > palabrasYa.length &&
      palabrasFila.slice(0, palabrasYa.length).join(" ") === palabrasYa.join(" ");
    if (ya && (esExtension || palabrasFila.join(" ") === palabrasYa.join(" "))) {
      // Misma persona con más datos: se completa sin cambiarle la identidad.
      if (esExtension) { ya.nombre = nombreFila; ya.apellidos = nombreFila.split(/\s+/).slice((ya.nombres ?? []).length); }
      if (!ya.cedula && cedulaFila) ya.cedula = cedulaFila;
      if (!ya.correo && correoFila) ya.correo = correoFila;
      if (!ya.celular && celularFila) ya.celular = celularFila;
      idx = indexar(personas, formasDe);
      fd = formasDigitos();
    } else if (!ya) {
      const p = nuevo(nombreFila, correoFila || undefined, { cedula: cedulaFila || undefined, celular: celularFila || undefined });
      registrarUso(p.id);
      salida.nuevas.push(p.id);
      idx = indexar(personas, formasDe);
      fd = formasDigitos();
    }
  }
  const columns = Object.fromEntries(Object.entries(t.columns ?? {}).map(([k, v]) => [k, procesar(String(v))]));
  salida.tables.push({ ...t, columns });
}

guardar(reg);
guardarIdentidades(idents);
const meta = {
  personas_nuevas: salida.nuevas, personas_usadas: [...salida.usadas],
  registro: { personas: personas.length, identidades: idents.size },
};
if (listaCruda && Array.isArray(listaCruda)) {
  // Se responde en el mismo orden y con la misma forma en que llegó.
  const porId = new Map<string, any>();
  for (const [fuente, rs] of [["chats", salida.chats], ["docs", salida.docs], ["tables", salida.tables]] as const)
    for (const r of rs as any[]) porId.set(`${fuente}|${r.id}`, r);
  const devueltos = listaCruda.map((original: any) => {
    const obj = desenvolver(original);
    const t = tipoDe(original);
    const anon = porId.get(`${t}|${obj.id}`);
    return obj.source || obj.fuente ? { ...original, record: anon ?? obj } : anon ?? obj;
  });
  const clave = Array.isArray(entrada) ? null : Object.keys(entrada).find((k) => ["records", "registros", "items", "registros_nuevos"].includes(k));
  const cuerpo: any = clave ? { [clave]: devueltos } : devueltos;
  if (!Array.isArray(cuerpo)) Object.assign(cuerpo, meta);
  console.log(JSON.stringify(cuerpo));
} else {
  console.log(JSON.stringify({ chats: salida.chats, docs: salida.docs, tables: salida.tables, ...meta }));
}
