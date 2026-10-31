// Descarga todas las fuentes del reto tal cual a fuentes/ (bytes originales) + sample/.
// Uso: node scripts/fetch.ts            (lee FUENTES_URL y FUENTES_TOKEN de .env)
// Respeta 600 req/min (vamos a ≤ 8 req/s) y guarda los ETag en fuentes/_etags.json.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

if (existsSync(".env")) process.loadEnvFile(".env");
const BASE = (process.env.FUENTES_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.FUENTES_TOKEN ?? "";
if (!BASE || !TOKEN) {
  console.error("Falta FUENTES_URL o FUENTES_TOKEN en .env");
  process.exit(2);
}
const OUT = process.env.FUENTES_DIR ?? "fuentes";
const etagsPath = join(OUT, "_etags.json");
mkdirSync(OUT, { recursive: true });
const etags: Record<string, string> = existsSync(etagsPath) ? JSON.parse(readFileSync(etagsPath, "utf8")) : {};

let ultimo = 0;
let peticiones = 0;
async function get(ruta: string): Promise<{ status: number; buf: Buffer; tipo: string }> {
  for (let intento = 0; intento < 5; intento++) {
    const espera = ultimo + 125 - Date.now(); // ≤ 8 req/s
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultimo = Date.now();
    peticiones++;
    const r = await fetch(BASE + ruta, { headers: { Authorization: "Bearer " + TOKEN } });
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 2000 * (intento + 1)));
      continue;
    }
    const etag = r.headers.get("etag");
    if (etag) etags[ruta] = etag;
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), tipo: r.headers.get("content-type") ?? "" };
  }
  throw new Error(`sin respuesta tras 5 intentos: ${ruta}`);
}
function guardar(rel: string, buf: Buffer) {
  const p = join(OUT, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, buf);
}
async function json(ruta: string, rel: string) {
  const { status, buf } = await get(ruta);
  if (status !== 200) throw new Error(`${ruta} → ${status}: ${buf.toString().slice(0, 200)}`);
  guardar(rel, buf);
  return JSON.parse(buf.toString("utf8"));
}

const t0 = Date.now();
const canales = await json("/chats/channels", "chats/channels.json");
await json("/chats/users", "chats/users.json");
let nFechas = 0, nMensajes = 0;
for (const c of canales) {
  const nombre = c.name ?? c.id;
  const fechas: string[] = await json(`/chats/${encodeURIComponent(nombre)}`, `chats/${nombre}/_fechas.json`);
  for (const f of fechas) {
    const msgs = await json(`/chats/${encodeURIComponent(nombre)}/${f}`, `chats/${nombre}/${f}.json`);
    nFechas++;
    nMensajes += msgs.length;
  }
}
const docs = await json("/docs", "docs/index.json");
const tiposDocs: Record<string, string> = {};
for (const d of docs) {
  const { status, buf, tipo } = await get(`/docs/${encodeURIComponent(d.id)}`);
  if (status !== 200) throw new Error(`/docs/${d.id} → ${status}`);
  guardar(`docs/${d.filename}`, buf);
  tiposDocs[d.id] = tipo;
}
const tablas = await json("/tables", "tables/_tables.json");
const tiposTablas: Record<string, string> = {};
for (const t of tablas) {
  const { status, buf, tipo } = await get(`/tables/${encodeURIComponent(t.name)}`);
  if (status !== 200) throw new Error(`/tables/${t.name} → ${status}`);
  guardar(`tables/${t.name}`, buf);
  tiposTablas[t.name] = tipo;
}
const indice = await json("/record_index", "record_index.json");
await json("/tests/public", "tests_public.json");
const zip = await get("/sample.zip");
if (zip.status === 200) {
  guardar("sample.zip", zip.buf);
  mkdirSync("sample", { recursive: true });
  execFileSync("unzip", ["-o", "-q", join(OUT, "sample.zip"), "-d", "sample"]);
}
writeFileSync(etagsPath, JSON.stringify(etags, null, 2));

const resumen = {
  descargado: new Date().toISOString(),
  segundos: Math.round((Date.now() - t0) / 1000),
  peticiones,
  canales: canales.length,
  fechas: nFechas,
  mensajes: nMensajes,
  docs: docs.length,
  tablas: tablas.map((t: any) => ({ ...t, content_type: tiposTablas[t.name] })),
  record_index: Object.fromEntries(Object.entries(indice).map(([k, v]) => [k, (v as unknown[]).length])),
  content_type_docs: tiposDocs,
};
writeFileSync(join(OUT, "_resumen.json"), JSON.stringify(resumen, null, 2));
console.log(JSON.stringify(resumen, null, 2));
