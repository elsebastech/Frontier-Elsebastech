// ¿Ya cambiaron las fuentes? Compara el índice del servidor contra el que tenemos guardado.
// Uso: node scripts/revisar-cambio.ts            (solo compara, no descarga nada)
//      node scripts/revisar-cambio.ts --bajar    (además baja TODO a fuentes/ y muestra muestras)
import { readFileSync, existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = (process.env.FUENTES_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.FUENTES_TOKEN ?? "";
const bajar = process.argv.includes("--bajar");
if (!BASE || !TOKEN) { console.error("faltan FUENTES_URL / FUENTES_TOKEN en .env"); process.exit(2); }

const localPath = "fuentes/record_index.json";
if (!existsSync(localPath)) { console.error("no existe fuentes/record_index.json — corre node scripts/fetch.ts"); process.exit(2); }
const local = JSON.parse(readFileSync(localPath, "utf8")) as Record<string, string[]>;

const headers: Record<string, string> = { Authorization: "Bearer " + TOKEN };
const etags = existsSync("fuentes/_etags.json") ? JSON.parse(readFileSync("fuentes/_etags.json", "utf8")) : {};
if (etags["/record_index"]) headers["If-None-Match"] = etags["/record_index"];

const r = await fetch(BASE + "/record_index", { headers });
const hora = new Date().toISOString();

if (r.status === 304) {
  console.log(JSON.stringify({ hora, estado: "sin_cambios", etag: headers["If-None-Match"] ?? null,
    conteos: Object.fromEntries(Object.entries(local).map(([k, v]) => [k, v.length])) }, null, 1));
  process.exit(0);
}
if (r.status !== 200) {
  console.error(`error HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  process.exit(1);
}

const remoto = (await r.json()) as Record<string, string[]>;
const salida: any = { hora, estado: "CAMBIO", por_fuente: {} };
let totalNuevos = 0;
for (const fuente of Object.keys(remoto)) {
  const antes = new Set(local[fuente] ?? []);
  const ahora = new Set(remoto[fuente] ?? []);
  const nuevos = [...ahora].filter((x) => !antes.has(x));
  const perdidos = [...antes].filter((x) => !ahora.has(x));
  totalNuevos += nuevos.length;
  salida.por_fuente[fuente] = {
    antes: antes.size, ahora: ahora.size, delta: ahora.size - antes.size,
    nuevos: nuevos.length, perdidos: perdidos.length,
    ejemplos_nuevos: nuevos.slice(0, 5),
  };
}
salida.total_nuevos = totalNuevos;
console.log(JSON.stringify(salida, null, 1));

// Guarda el índice nuevo aparte para no perder la referencia de la corrida anterior.
writeFileSync("fuentes/record_index-nuevo.json", JSON.stringify(remoto, null, 1));

if (bajar && totalNuevos > 0) {
  const { execFileSync } = await import("node:child_process");
  console.error("descargando todo de nuevo a fuentes/ (tarda ~30 s)…");
  execFileSync("node", ["scripts/fetch.ts"], { stdio: "inherit" });
}
