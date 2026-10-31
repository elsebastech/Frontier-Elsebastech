// Cliente del modelo de decisiones de OpenRouter (typesafe/jev-1.14).
//
// Jev no genera texto: devuelve probabilidades por pregunta. Se usa SOLO para los juicios que las
// reglas no pueden hacer con confianza — si es persona, organización o lugar una cadena suelta.
// El motor funciona sin él: si no hay red, tarda más de 8 s o no hay clave, se cae a las reglas.
//
// Cache en registro/jev-cache.json: la clave es el hash del estado + las preguntas. El pipeline
// consulta el caché y nunca llama a la red en caliente (así una corrida no depende de OpenRouter).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface PreguntaChoice {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}
export interface RespuestaChoice {
  type: "choice";
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
}

export interface Resultado {
  modelo: string;
  respuestas: Record<string, RespuestaChoice>;
  costo_usd?: number;
  de_cache: boolean;
}

const MODELO = process.env.JEV_MODELO ?? "typesafe/jev-1.14";
const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const TIMEOUT_MS = Number(process.env.JEV_TIMEOUT_MS ?? 12000);
const RUTA_CACHE = process.env.JEV_CACHE ?? "registro/jev-cache.json";

type Cache = Record<string, Resultado>;

function leerCache(): Cache {
  if (!existsSync(RUTA_CACHE)) return {};
  try {
    return JSON.parse(readFileSync(RUTA_CACHE, "utf8")) as Cache;
  } catch {
    return {};
  }
}
function guardarCache(c: Cache): void {
  mkdirSync(dirname(RUTA_CACHE), { recursive: true });
  writeFileSync(RUTA_CACHE, JSON.stringify(c, null, 1));
}
function claveDe(estado: unknown, preguntas: unknown): string {
  return createHash("sha256").update(JSON.stringify({ estado, preguntas })).digest("hex").slice(0, 32);
}

/** Pregunta al modelo. Devuelve null si no se puede (sin clave, sin red, timeout, error). */
export async function decidir(
  estado: unknown,
  preguntas: Record<string, PreguntaChoice>,
  opciones: { modelo?: string; usarCache?: boolean } = {},
): Promise<Resultado | null> {
  const clave = claveDe(estado, preguntas);
  const usarCache = opciones.usarCache ?? true;
  const cache = leerCache();
  if (usarCache && cache[clave]) return { ...cache[clave], de_cache: true };

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const modelo = opciones.modelo ?? MODELO;
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: modelo, state: estado, questions: preguntas }),
      signal: control.signal,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { model?: string; answers?: Record<string, RespuestaChoice>; usage?: { cost?: number } };
    if (!j.answers) return null;
    const resultado: Resultado = {
      modelo: j.model ?? modelo,
      respuestas: j.answers,
      costo_usd: j.usage?.cost,
      de_cache: false,
    };
    cache[clave] = resultado;
    guardarCache(cache);
    return resultado;
  } catch {
    return null; // timeout, red caída o JSON inválido: el llamador usa reglas
  } finally {
    clearTimeout(t);
  }
}

/** Consulta el caché sin llamar a la red (para el pipeline en caliente). */
export function delCache(estado: unknown, preguntas: Record<string, PreguntaChoice>): Resultado | null {
  const c = leerCache()[claveDe(estado, preguntas)];
  return c ? { ...c, de_cache: true } : null;
}

/**
 * Clasifica cadenas sueltas: persona natural / organización / lugar.
 * Acepta la respuesta solo con probabilidad ≥ umbral; si el modelo duda, se cae a las reglas.
 */
export async function clasificarCadenas(
  cadenas: string[],
  opciones: { umbral?: number; contexto?: string; soloCache?: boolean } = {},
): Promise<Map<string, "persona" | "organizacion" | "lugar" | "duda">> {
  const umbral = opciones.umbral ?? 0.85;
  const salida = new Map<string, "persona" | "organizacion" | "lugar" | "duda">();
  if (!cadenas.length) return salida;

  const estado: Record<string, unknown> = { cadenas };
  if (opciones.contexto) estado.contexto = opciones.contexto.slice(0, 2000);
  const preguntas: Record<string, PreguntaChoice> = {};
  cadenas.forEach((_, i) => {
    preguntas[`q${i}`] = {
      type: "choice",
      instructions: `La cadena en \`cadenas[${i}]\` es el nombre de una persona natural, el nombre de una organización (empresa, banco, entidad, producto) o un lugar (ciudad, barrio, dirección, sitio).`,
      criteria: {
        persona: "Nombre propio de una persona natural",
        organizacion: "Empresa, banco, entidad financiera, producto o marca",
        lugar: "Ciudad, barrio, dirección o sitio geográfico",
      },
    };
  });

  const r = opciones.soloCache ? delCache(estado, preguntas) : await decidir(estado, preguntas);
  if (!r) {
    for (const c of cadenas) salida.set(c, "duda");
    return salida;
  }
  cadenas.forEach((c, i) => {
    const a = r.respuestas[`q${i}`];
    if (!a) return salida.set(c, "duda");
    const prob = a.probabilities?.[a.choice] ?? a.confidence ?? 0;
    salida.set(c, prob >= umbral ? (a.choice as "persona" | "organizacion" | "lugar") : "duda");
  });
  return salida;
}
