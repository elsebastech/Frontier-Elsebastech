// Identificadores huérfanos: PII que no pertenece a ninguna persona del registro (una placa en un
// chat, un pasaporte en una carta, una dirección suelta). No están en el maestro, así que el motor
// no los ve — y quedan literales en la salida.
//
// Se reemplazan por un valor determinista derivado del propio original (HMAC con la sal del reto),
// conservando el formato, y se registran como entidad propia para que el diccionario sea honesto.
// Solo se tocan patrones con evidencia fuerte: nunca un número suelto cualquiera.
import { createHmac } from "node:crypto";
import { norm, soloDigitos } from "./texto.ts";

export type TipoHuerfano = "placa" | "pasaporte" | "direccion" | "celular" | "cedula" | "correo";

export interface Huerfano { tipo: TipoHuerfano; original: string; reemplazo: string }

const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

function hmac(sal: string, valor: string): Buffer {
  return createHmac("sha256", sal).update(valor).digest();
}
function digitosDe(buf: Buffer, n: number, inicio: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += String(buf[(inicio + i) % buf.length] % 10);
  return s;
}
function letrasDe(buf: Buffer, n: number, inicio: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += LETRAS[buf[(inicio + i) % buf.length] % LETRAS.length];
  return s;
}

// Los patrones exigen contexto o formato inequívoco: falso positivo aquí cuesta utilidad.
const PATRONES: { tipo: TipoHuerfano; rx: RegExp; contexto?: RegExp }[] = [
  // Placa colombiana: 3 letras + 3 dígitos. No hay nada más con esa forma en el corpus.
  { tipo: "placa", rx: /(?<![\p{L}\p{N}])([A-Z]{3}[ -]?\d{3})(?![\p{L}\p{N}])/gu },
  // Pasaporte: solo si la palabra aparece antes.
  { tipo: "pasaporte", rx: /(?:\b(?:pasaporte|passport)\b[^\d]{0,40}?)([A-Z]{1,2}\d{6,9}|\d{7,9})(?!\d)/giu },
  // Dirección: vía + número + separadores.
  { tipo: "direccion", rx: /(?<![\p{L}])((?:calle|carrera|cra|cl|avenida|av|diagonal|dg|transversal|tv)\.?\s+\d{1,3}[a-z]?\s*(?:bis\s*)?#?\s*\d{1,3}\s*[-–]\s*\d{1,3}(?:\s*(?:apto|apartamento|of|oficina|casa|torre|bloque)\s*\d{1,4})?)(?![\p{L}\p{N}])/giu },
  // Celular: 10 dígitos que empiezan por 3, con separadores, SOLO si hay palabra de teléfono cerca.
  { tipo: "celular", rx: /(?<![\p{N}])(3\d{2}[ .\-]?\d{3}[ .\-]?\d{4})(?![\p{N}])/gu, contexto: /\b(cel|celular|whatsapp|wsp|tel|tel[ée]fono|llam[ae]|llamen|marcar|m[áa]rquenme|contacto)\b/i },
  // Cédula: 7-11 dígitos, solo con "cc/cédula/documento" antes.
  { tipo: "cedula", rx: /(?:\b(?:cc|c\.c\.|cedula|cédula|identificaci[óo]n|documento)\b[^\d]{0,14})(\d{2}[.\s]?\d{3}[.\s]?\d{3,4})(?!\d)/giu },
];

/** Genera el reemplazo determinista de un identificador huérfano, conservando el formato. */
/** Devuelve los dígitos con los mismos separadores y bloques que el original (1.022.649.507). */
export function conFormatoOriginal(original: string, digitos: string): string {
  if (!/[^\d]/.test(original)) return digitos;
  const sep = (original.match(/[^\d]/) ?? [""])[0];
  const bloques = original.split(/[^\d]+/).filter(Boolean).map((g) => g.length);
  let salida = "";
  let i = 0;
  bloques.forEach((tam, k) => {
    if (i >= digitos.length) return;
    salida += (k ? sep : "") + digitos.slice(i, i + tam);
    i += tam;
  });
  if (i < digitos.length) salida += sep + digitos.slice(i);
  return salida;
}

export function reemplazoDe(tipo: TipoHuerfano, original: string, sal: string): string {
  const b = hmac(sal, `${tipo}|${norm(original)}`);
  switch (tipo) {
    case "placa": {
      const sep = /[ -]/.test(original) ? original.match(/[ -]/)![0] : "";
      return `${letrasDe(b, 3, 0)}${sep}${digitosDe(b, 3, 5)}`;
    }
    case "pasaporte": {
      const soloNum = soloDigitos(original);
      if (soloNum.length === original.length) return digitosDe(b, original.length, 2);
      const letras = original.match(/^[A-Z]+/i)?.[0].length ?? 1;
      return `${letrasDe(b, letras, 3)}${digitosDe(b, original.length - letras, 7)}`;
    }
    case "direccion": {
      const via = original.match(/^(calle|carrera|cra|cl|avenida|av|diagonal|dg|transversal|tv)/i)?.[0] ?? "Calle";
      const sufijo = original.match(/(apto|apartamento|of|oficina|casa|torre|bloque)\s*\d{1,4}/i)?.[0].split(/\s+/)[0] ?? "";
      const base = `${via} ${1 + (b[0] % 180)}${b[1] % 2 ? " Bis" : ""} # ${10 + (b[2] % 90)}-${1 + (b[3] % 98)}`;
      return sufijo ? `${base} ${sufijo.toLowerCase()} ${101 + (b[4] * 7) % 899}` : base;
    }
    case "celular": return conFormatoOriginal(original, `3${digitosDe(b, 9, 1)}`);
    case "cedula": return conFormatoOriginal(original, digitosDe(b, soloDigitos(original).length, 3));
    case "correo": return `x${digitosDe(b, 6, 2)}@ejemplo.com`;
  }
}

/** Busca identificadores huérfanos en un texto, evitando los que ya pertenecen a alguien conocido. */
export function buscarHuerfanos(
  texto: string,
  sal: string,
  yaCubierto: (valor: string) => boolean,
): Huerfano[] {
  if (!texto) return [];
  const out: Huerfano[] = [];
  const ocupado: [number, number][] = [];
  for (const { tipo, rx, contexto } of PATRONES) {
    if (contexto && !contexto.test(texto)) continue;
    for (const m of texto.matchAll(rx)) {
      const ini = (m.index ?? 0) + m[0].indexOf(m[1]);
      const fin = ini + m[1].length;
      if (ocupado.some(([a, b]) => ini < b && fin > a)) continue;
      if (yaCubierto(m[1])) continue;
      const reemplazo = reemplazoDe(tipo, m[1], sal);
      if (norm(reemplazo) === norm(m[1])) continue; // nunca dejar el mismo valor
      ocupado.push([ini, fin]);
      out.push({ tipo, original: m[1], reemplazo });
    }
  }
  return out.sort((a, b) => texto.indexOf(a.original) - texto.indexOf(b.original));
}

/** Aplica los reemplazos de un texto. */
export function reemplazarHuerfanos(texto: string, huerfanos: Huerfano[]): string {
  let s = texto;
  for (const h of huerfanos) s = s.split(h.original).join(h.reemplazo);
  return s;
}
