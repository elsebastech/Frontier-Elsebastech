// Vigilante: detecta cuándo crecen las fuentes. Corre en la laptop durante el reto.
// Uso: caffeinate -i node scripts/vigilante.ts        (lee .env; Ctrl+C para parar)
// Cada VIGILANTE_SEG (60 s) pide /record_index con If-None-Match: 304 = igual, 200 = cambió.
// Cada ronda se agrega a vigilante.jsonl (evidencia para DECISIONS.md y el debrief).
import { appendFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { firmaDeArchivos, derivaDeArchivos, type FirmaArchivos } from "../src/vigilante/esquema.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = (process.env.FUENTES_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.FUENTES_TOKEN ?? "";
const SEG = Number(process.env.VIGILANTE_SEG ?? 60);
const LOG = process.env.VIGILANTE_LOG ?? "vigilante.jsonl";
if (!BASE || !TOKEN) {
  console.error("Falta FUENTES_URL o FUENTES_TOKEN en .env");
  process.exit(2);
}

let etag: string | null = null;
let conteos: Record<string, number> | null = null;
// Línea base desde el índice ya guardado: si el proceso se reinicia, no pierde la referencia.
try {
  if (existsSync("fuentes/record_index.json")) {
    const local = JSON.parse(readFileSync("fuentes/record_index.json", "utf8")) as Record<string, string[]>;
    conteos = Object.fromEntries(Object.entries(local).map(([k, v]) => [k, v.length]));
  }
} catch { /* sin línea base: se toma en la primera ronda */ }

const FIRMA = process.env.VIGILANTE_FIRMA ?? "registro/firma-esquema.json";

/** Pide /tables al proveedor y devuelve la firma de archivos (charset, separador, filas). */
async function firmaEsquema(): Promise<FirmaArchivos | null> {
  try {
    const r = await fetch(BASE + "/tables", { headers: { Authorization: "Bearer " + TOKEN } });
    if (r.status !== 200) return null;
    return firmaDeArchivos((await r.json()) as any[]);
  } catch { return null; }
}

async function ronda() {
  const hora = new Date().toISOString();
  const headers: Record<string, string> = { Authorization: "Bearer " + TOKEN };
  if (etag) headers["If-None-Match"] = etag;
  try {
    const r = await fetch(BASE + "/record_index", { headers });
    if (r.status === 304) {
      appendFileSync(LOG, JSON.stringify({ hora, estado: "igual" }) + "\n");
      return;
    }
    if (r.status !== 200) {
      appendFileSync(LOG, JSON.stringify({ hora, estado: "error", status: r.status }) + "\n");
      console.log(`${hora} error HTTP ${r.status}`);
      return;
    }
    const idx = (await r.json()) as Record<string, string[]>;
    const nuevos = Object.fromEntries(Object.entries(idx).map(([k, v]) => [k, v.length]));
    const antes = conteos;
    etag = r.headers.get("etag");
    conteos = nuevos;
    if (!antes) {
      appendFileSync(LOG, JSON.stringify({ hora, estado: "linea_base", conteos }) + "\n");
      console.log(`${hora} línea base ${JSON.stringify(conteos)}`);
      return;
    }
    const delta = Object.fromEntries(Object.keys(nuevos).map((k) => [k, nuevos[k] - (antes[k] ?? 0)]));
    const cambio = Object.values(delta).some((d) => d !== 0);
    appendFileSync(LOG, JSON.stringify({ hora, estado: cambio ? "CAMBIO" : "igual_200", antes, despues: nuevos, delta }) + "\n");
    if (cambio) {
      // El cambio también puede ser de formato: se compara la firma del esquema.
      const firma = await firmaEsquema();
      let deriva: string[] = [];
      if (firma) {
        let previa: FirmaArchivos | null = null;
        try { if (existsSync(FIRMA)) previa = JSON.parse(readFileSync(FIRMA, "utf8")); } catch { previa = null; }
        deriva = derivaDeArchivos(firma, previa);
        mkdirSync(FIRMA.replace(/\/[^/]+$/, ""), { recursive: true });
        writeFileSync(FIRMA, JSON.stringify(firma, null, 1));
      }
      const parte = { hora, antes, despues: nuevos, delta, deriva_esquema: deriva, esquema_revisado: firma !== null };
      // Marcador con el ÚLTIMO cambio (se reescribe) y archivo por cambio (nunca se pierde).
      writeFileSync("vigilante-CAMBIO.json", JSON.stringify(parte, null, 1));
      mkdirSync("registro/cambios", { recursive: true });
      writeFileSync(`registro/cambios/${hora.replace(/[:.]/g, "-")}.json`, JSON.stringify(parte, null, 1));
      appendFileSync(LOG, JSON.stringify({ hora, estado: "cambio_esquema", deriva }) + "\n");
      console.log(`\n*** ${hora} CAMBIO EN LAS FUENTES *** delta ${JSON.stringify(delta)}\x07`);
      for (const d of deriva) console.log(`    esquema: ${d}`);
    }
  } catch (e) {
    appendFileSync(LOG, JSON.stringify({ hora, estado: "error", error: String(e) }) + "\n");
    console.log(`${hora} error de red: ${e}`);
  }
}

await ronda();
setInterval(ronda, SEG * 1000);
