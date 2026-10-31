// Motor de reemplazo en dos pasos: real → ⟦P0042·forma⟧ → identidad falsa.
// El paso A deja marcadores (verificables con el barrido); el paso B los dibuja.
// Reemplazo quirúrgico: el texto se reconstruye exactamente igual salvo los tramos tocados.
import { norm, digitosCompactos, CONFUSABLES, soloDigitos } from "./texto.ts";
import type { Persona, Forma, TipoForma } from "../registro/personas.ts";
import type { Identidad } from "./identidades.ts";

// ── Análisis: texto normalizado + mapa de posiciones al original ─────────
export interface Analisis {
  norm: string;
  ini: number[]; // por carácter normalizado: índice inicial en el original
  fin: number[]; // por carácter normalizado: índice final (exclusivo) en el original
  tokens: { w: string; ini: number; fin: number }[]; // en coordenadas normalizadas
}

const RX_CF = /\p{Cf}/u;
const RX_MN = /\p{Mn}/gu;
const RX_ESPACIO_RARO = /[\p{Zs}\t\r\n\v\f]/u;

function normalizarCaracter(ch: string): string {
  let s = ch.normalize("NFKC");
  if (s.length === 1 && CONFUSABLES[s]) s = CONFUSABLES[s];
  let out = "";
  for (const c of s) {
    if (RX_CF.test(c)) continue;
    if (RX_ESPACIO_RARO.test(c)) { out += " "; continue; }
    out += c;
  }
  return out.toLowerCase().replace(/\u00df/g, "ss").normalize("NFD").replace(RX_MN, "");
}

export function analizar(texto: string): Analisis {
  let norm = "";
  const ini: number[] = [];
  const fin: number[] = [];
  let i = 0;
  for (const ch of texto) {
    const n = normalizarCaracter(ch);
    const largoCh = ch.length;
    for (const c of n) {
      // Un carácter normalizado puede ocupar 2 unidades UTF-16 (emoji) o más (ligaduras NFKC):
      // se registra una entrada por unidad para que el mapa nunca se desalinee.
      norm += c;
      for (let k = 0; k < c.length; k++) {
        ini.push(i);
        fin.push(i + largoCh);
      }
    }
    i += largoCh;
  }
  const tokens: { w: string; ini: number; fin: number }[] = [];
  const rxTok = /[a-z0-9]+/g;
  let m: RegExpExecArray | null;
  while ((m = rxTok.exec(norm))) tokens.push({ w: m[0], ini: m.index, fin: m.index + m[0].length });
  return { norm, ini, fin, tokens };
}

// ── Formas: índice por primera palabra ─────────────────────────────────
export interface FormaIndexada { p: Persona; f: Forma; palabras: string[] }

export function indexar(personas: Persona[], formasDe: (p: Persona) => Forma[]): Map<string, FormaIndexada[]> {
  const idx = new Map<string, FormaIndexada[]>();
  const meter = (fi: FormaIndexada) => {
    const w = fi.palabras[0];
    if (!w) return;
    const arr = idx.get(w) ?? [];
    arr.push(fi);
    idx.set(w, arr);
  };
  for (const p of personas) {
    for (const f of formasDe(p)) {
      const palabras = norm(f.valor).match(/[a-z0-9]+/g) ?? [];
      if (!palabras.length) continue;
      meter({ p, f, palabras });
      // Correo deletreado: "ana arroba gmail punto com" → palabras con arroba/punto
      if (f.tipo === "correo" && f.valor.includes("@")) {
        const [local, dominio] = f.valor.split("@");
        const deletreo = [
          ...local.split(".").flatMap((x) => [norm(x), "punto"]).slice(0, -1),
          "arroba",
          ...(dominio ?? "").split(".").flatMap((x) => [norm(x), "punto"]).slice(0, -1),
        ].filter(Boolean);
        if (deletreo.length >= 3) meter({ p, f: { valor: f.valor, tipo: "correo" }, palabras: deletreo });
      }
    }
  }
  return idx;
}

// ── Paso A: marcar ─────────────────────────────────────────────────────
export interface Marca { persona: Persona; forma: Forma; ini: number; fin: number }

const RX_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const SEP = "[.,'`´·/\\-–—_ ]?";
function patronDigitos(digitos: string, con57 = false): RegExp {
  const cuerpo = digitos.split("").join(SEP);
  return new RegExp(`(?<!\\d)(?:57)?${cuerpo}(?!\\d)`, "g");
}

/** Devuelve los tramos a reemplazar, ya resueltos, sin solapes y de más largo a más corto. */
export function buscarMarcas(texto: string, idx: Map<string, FormaIndexada[]>, formasDigitos: { p: Persona; f: Forma; digitos: string }[]): Marca[] {
  const a = analizar(texto);
  const candidatas: Marca[] = [];
  const cubierto = new Uint8Array(texto.length);

  // 1. Por palabras (nombres, correos deletreados, handles, tokens de archivo)
  for (let i = 0; i < a.tokens.length; i++) {
    const cands = idx.get(a.tokens[i].w);
    if (!cands) continue;
    for (let n = 12; n >= 1; n--) {
      if (i + n > a.tokens.length) continue;
      for (const { p, f, palabras } of cands) {
        if (palabras.length !== n) continue;
        let ok = true;
        for (let k = 0; k < n; k++) if (a.tokens[i + k].w !== palabras[k]) { ok = false; break; }
        if (!ok) continue;
        const ini = a.ini[a.tokens[i].ini];
        const fin = a.fin[a.tokens[i + n - 1].fin - 1];
        candidatas.push({ persona: p, forma: f, ini, fin });
      }
    }
  }
  // 2. Correos literales del texto
  for (const m of texto.matchAll(RX_EMAIL)) {
    const v = m[0].toLowerCase();
    const cands = idx.get(norm(v).match(/[a-z0-9]+/)?.[0] ?? "");
    for (const c of cands ?? []) {
      if (c.f.tipo === "correo" && c.f.valor.toLowerCase() === v)
        candidatas.push({ persona: c.p, forma: c.f, ini: m.index, fin: m.index + v.length });
    }
  }
  // 3. Dígitos (cédula, celular, placa numérica)
  const compacto = digitosCompactos(texto);
  if (/\d{6}/.test(compacto)) {
    for (const { p, f, digitos } of formasDigitos) {
      if (!compacto.includes(digitos)) continue;
      for (const m of texto.matchAll(patronDigitos(digitos))) {
        if (soloDigitos(m[0]) !== digitos) continue;
        // El formato se decide por lo que traía ESTA aparición, no por la persona entera.
        const tipo = f.tipo === "cedula" && /[^\d]/.test(m[0]) ? ("cedula_dots" as const) : f.tipo;
        candidatas.push({ persona: p, forma: tipo === f.tipo ? f : { valor: f.valor, tipo }, ini: m.index, fin: m.index + m[0].length });
      }
    }
  }

  // Sin solapes: primero los tramos más largos, luego el orden de aparición.
  candidatas.sort((x, y) => (y.fin - y.ini) - (x.fin - x.ini) || x.ini - y.ini);
  const elegidas: Marca[] = [];
  for (const c of candidatas) {
    let libre = true;
    for (let k = c.ini; k < c.fin; k++) if (cubierto[k]) { libre = false; break; }
    if (!libre) continue;
    for (let k = c.ini; k < c.fin; k++) cubierto[k] = 1;
    elegidas.push(c);
  }
  return elegidas.sort((x, y) => x.ini - y.ini);
}

export function marcar(texto: string, marcas: Marca[]): string {
  let out = "";
  let pos = 0;
  for (const m of marcas) {
    out += texto.slice(pos, m.ini) + `⟦${m.persona.id}·${m.forma.tipo}⟧`;
    pos = m.fin;
  }
  return out + texto.slice(pos);
}

// ── Paso B: dibujar ────────────────────────────────────────────────────
export type FormaDibujo = "dotted" | "plain" | "spaced";

export interface Dibujo { valor: string }

export function dibujarTexto(
  texto: string,
  idents: Map<string, Identidad>,
  detalle: (entity: string, tipo: TipoForma) => FormaDibujo = () => "plain",
): string {
  return texto.replace(RX_MARCA_GLOBAL, (_m, id: string, tipo: string, offset: number) => {
    const i = idents.get(id);
    if (!i) return _m;
    const valor = valorMarcador(i, tipo);
    // Contexto: un seudónimo con espacios rompe un correo o una URL. Ahí se dibuja en formato slug.
    const token = tokenAlrededor(texto, offset, _m.length);
    // Solo un correo de verdad (algo@dominio.tld) fuerza formato slug. Una mención "@U0…" no.
    if (/[^\s@]@[^\s@]+\.[a-z]{2,}/i.test(token)) return i.handle;
    if (/^https?:\/\//i.test(token)) return i.filename_token.replace(/_/g, "-");
    return valor;
  });
}

/** Token (sin espacios ni comillas) que contiene la marca: sirve para saber si estamos en un correo. */
function tokenAlrededor(texto: string, inicio: number, largo: number): string {
  const blando = (c: string) => !/[\s"'<>()\[\],;]/.test(c);
  let a = inicio;
  let b = inicio + largo;
  while (a > 0 && blando(texto[a - 1])) a--;
  while (b < texto.length && blando(texto[b])) b++;
  return texto.slice(a, b);
}

/** Valor del marcador según el tipo. */
function valorMarcador(i: Identidad, tipo: string): string {
  switch (tipo) {
    case "nombre_completo": return i.nombre_completo;
    case "nombre_apellido": return i.nombre_apellido;
    case "nombre": return i.nombre;
    case "apellido": return i.nombre_apellido.split(" ").at(-1) ?? i.nombre_apellido;
    case "correo": return i.correo;
    case "celular": return i.celular;
    case "cedula": return i.cedula;
    case "cedula_dots": return i.cedula.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    case "direccion": return i.direccion;
    case "nacimiento": return i.nacimiento;
    case "uid": return i.uid;
    case "handle": return i.handle;
    case "filename_token": return i.filename_token;
    default: return i.nombre_completo;
  }
}

/** Dibujo para nombres de archivo: minúsculas, sin tildes, con "_" (regla S7 de la muestra). */
export function dibujarArchivo(texto: string, idents: Map<string, Identidad>): string {
  const limpiar = (v: string) =>
    v.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return texto.replace(RX_MARCA, (_m, id: string, tipo: string) => {
    const i = idents.get(id);
    if (!i) return _m;
    switch (tipo) {
      case "nombre_completo":
      case "nombre_apellido": return i.filename_token;
      case "nombre": return i.filename_token.split("_")[0];
      case "correo": return limpiar(i.correo.replace("@", " arroba "));
      case "handle": return limpiar(i.handle);
      case "filename_token": return i.filename_token;
      case "cedula": case "cedula_dots": return i.cedula;
      case "celular": return i.celular;
      case "direccion": return limpiar(i.direccion);
      case "nacimiento": return i.nacimiento;
      case "uid": return i.uid;
      default: return limpiar(i.nombre_completo);
    }
  });
}

export const RX_MARCA = /⟦(P\d{4})·([a-z_]+)⟧/g;
const RX_MARCA_GLOBAL = /⟦(P\d{4})·([a-z_]+)⟧/g;
export function marcasEn(texto: string): { id: string; tipo: TipoForma }[] {
  return [...texto.matchAll(RX_MARCA)].map((m) => ({ id: m[1], tipo: m[2] as TipoForma }));
}
