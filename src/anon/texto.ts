// Normalización y comparación — copia fiel del juez (validar.mjs), para que nuestro barrido y el
// suyo vean exactamente lo mismo: confusables, invisibles, separadores de dígitos, espacios raros.

export const ESPACIO = "\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const PALABRA = "\\p{L}\\p{N}_";
export const CONFUSABLES: Record<string, string> = {
  "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y",
  "\u0456": "i", "\u0458": "j", "\u0455": "s", "\u0410": "A", "\u0415": "E", "\u041E": "O", "\u0420": "P",
  "\u0421": "C", "\u0425": "X", "\u0423": "Y", "\u0406": "I", "\u0408": "J", "\u0405": "S", "\u0412": "B",
  "\u041D": "H", "\u041A": "K", "\u041C": "M", "\u0422": "T", "\u03BF": "o", "\u03B1": "a", "\u03C1": "p",
  "\u03BD": "v", "\u03B9": "i", "\u2113": "l", "\u0131": "i", "\u0251": "a",
};
const RX_CONFUSABLE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu");
const RX_FORMATO = /\p{Cf}/u;
const RX_ESPACIO_RARO = /[\p{Zs}\t\r\n\v\f]/u;
const RX_ESPACIOS = / {2,}/g;
const RX_MARCA = /\p{Mn}/gu;
const RX_SEPARADOR_DIGITOS = new RegExp(`(?<=\\p{Nd})[${ESPACIO}.,'\u2019\`\xB4\xB7/\\-\u2013\u2014_](?=\\p{Nd})`, "gu");
const RX_NO_DIGITO = /\P{Nd}/gu;
const RX_TEXTO = new RegExp(`^[${PALABRA} .'_-]+$`, "u");

export function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}
export function largo(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}
function plegar(s: string): string {
  return s.toLowerCase().replace(/ß/g, "ss").replace(/ς/g, "\u03C3").replace(/ſ/g, "s");
}
function quitarTildes(s: string): string {
  return s.normalize("NFD").replace(RX_MARCA, "");
}
function clean(s: string): string {
  const base = s.normalize("NFKC").replace(RX_CONFUSABLE, (c) => CONFUSABLES[c] ?? c);
  let out = "";
  for (const c of base) {
    if (RX_FORMATO.test(c)) continue;
    out += RX_ESPACIO_RARO.test(c) ? " " : c;
  }
  return out.replace(RX_ESPACIOS, " ");
}
const cacheNorm = new Map<string, string>();
export function norm(s: string): string {
  let r = cacheNorm.get(s);
  if (r === undefined) {
    r = plegar(quitarTildes(clean(s)));
    if (cacheNorm.size > 200000) cacheNorm.clear();
    cacheNorm.set(s, r);
  }
  return r;
}
const cacheCompacto = new Map<string, string>();
export function digitosCompactos(s: string): string {
  let r = cacheCompacto.get(s);
  if (r === undefined) {
    r = clean(s).replace(RX_SEPARADOR_DIGITOS, "");
    if (cacheCompacto.size > 200000) cacheCompacto.clear();
    cacheCompacto.set(s, r);
  }
  return r;
}
export function soloDigitos(s: string): string {
  return s.replace(RX_NO_DIGITO, "");
}
const cacheRx = new Map<string, RegExp>();
export function rx(fuente: string, flags = "u"): RegExp {
  const clave = `${flags}/${fuente}`;
  let r = cacheRx.get(clave);
  if (!r) {
    r = new RegExp(fuente, flags);
    if (cacheRx.size > 50000) cacheRx.clear();
    cacheRx.set(clave, r);
  }
  return r;
}
function digitosEn(haystack: string, digitos: string): boolean {
  const compacto = digitosCompactos(haystack);
  const candidatos = new Set([digitos]);
  if (digitos.length === 12 && digitos.startsWith("57")) candidatos.add(digitos.slice(2));
  for (const d of candidatos) if (rx(`(?<!\\p{Nd})(?:57)?${escaparRegex(d)}(?!\\p{Nd})`).test(compacto)) return true;
  return false;
}
/** Igual que el juez: dígitos con separadores, nombres con o sin espacios entre palabras, resto literal. */
export function contiene(haystack: string, needle: string, opciones: { exacto?: boolean } = {}): boolean {
  if (!needle) return false;
  if (opciones.exacto) return haystack.includes(needle);
  const digitos = soloDigitos(needle);
  if (digitos && largo(digitos) >= 6 && largo(digitos) >= 0.6 * largo(needle) && !/[a-zA-Z]/.test(needle))
    return digitosEn(haystack, digitos);
  const h = norm(haystack);
  const n = norm(needle);
  if (RX_TEXTO.test(n) && /[a-z]/.test(n)) {
    if (rx(`(?<![a-z0-9])${escaparRegex(n)}(?![a-z0-9])`).test(h)) return true;
    const palabras = partir(n);
    if (palabras.length >= 2 && palabras.every((w) => largo(w) >= 3))
      return rx(`(?<![a-z0-9])${palabras.map(escaparRegex).join(`[${ESPACIO}]*`)}(?![a-z0-9])`).test(h);
    return false;
  }
  return h.includes(n);
}
export function partir(s: string): string[] {
  return clean(s).split(/[ \t\n\v\f\r]+/).filter((x) => x !== "");
}
/** Palabras de un texto normalizado, para indexar formas por su primer token. */
export function palabras(s: string): string[] {
  return norm(s).match(/[a-z0-9]+/g) ?? [];
}
