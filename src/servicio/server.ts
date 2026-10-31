// Servicio HTTP del reto: /health, /run, /run/{id}, /output/{archivo}, /anonymize, /entities.
// Node 26 sin dependencias ni build. Un proceso, estado en disco (registro/ append-only).
// Uso: PORT=8080 node src/servicio/server.ts
import { createServer } from "node:http";
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

// Credenciales propias para el panel interno (/run con sources_url="env").
if (existsSync(".env")) process.loadEnvFile(".env");

// Token interno. Sin él, el panel público no puede ver originales ni gastar nuestras credenciales.
// Se define en .env (ANON_TOKEN); si no existe, esas rutas quedan cerradas.
const ANON_TOKEN = process.env.ANON_TOKEN ?? "";

/**
 * Carpeta de salida vigente. Tras un reinicio no hay trabajos en memoria, así que se busca en
 * disco el job terminado más reciente; si no hay ninguno, se usa output/ de la raíz.
 */
function carpetaSalida(): string {
  if (!existsSync("trabajos")) return "output";
  const candidatos = readdirSync("trabajos", { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join("trabajos", d.name, "output", "entities.json")))
    .map((d) => ({ dir: join("trabajos", d.name), m: statSync(join("trabajos", d.name, "output")).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return candidatos[0]?.dir ?? "output";
}

const PUERTO = Number(process.env.PORT ?? 8080);
const EQUIPO = process.env.EQUIPO ?? "elsebastech";
const VERSION = process.env.VERSION ?? "1.0.0-reglas";
const MODELOS = (process.env.MODELOS ?? "reglas,typesafe/jev-1.14").split(",").map((m) => m.trim());
const TRABAJOS = "trabajos";
mkdirSync(TRABAJOS, { recursive: true });

interface Trabajo {
  id: string; estado: "queued" | "running" | "done" | "failed";
  inicio: number; segundos?: number; voces?: any; error?: string; dir: string; tokens: number;
  paso: string; preflight?: any;
}
const trabajos = new Map<string, Trabajo>();
let ultimo: Trabajo | null = null;

/** Token interno por cabecera o por query (?k=). Si no hay ANON_TOKEN configurado, cierra la puerta. */
function tokenValido(req: any): boolean {
  if (!ANON_TOKEN) return false;
  const cabecera = String(req.headers["x-anon-token"] ?? "");
  const url = new URL(req.url, "http://x");
  const query = url.searchParams.get("k") ?? "";
  return cabecera === ANON_TOKEN || query === ANON_TOKEN;
}

function json(res: any, codigo: number, cuerpo: any) {
  const texto = JSON.stringify(cuerpo);
  res.writeHead(codigo, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(texto) });
  res.end(texto);
}
function leerCuerpo(req: any, limite = 8 * 1024 * 1024): Promise<string> {
  return new Promise((ok, mal) => {
    let datos = "";
    req.on("data", (c: Buffer) => { datos += c.toString("utf8"); if (datos.length > limite) { mal(new Error("cuerpo demasiado grande")); req.destroy(); } });
    req.on("end", () => ok(datos));
    req.on("error", mal);
  });
}
const correr = (script: string, env: Record<string, string>, args: string[] = []) =>
  new Promise<{ ok: boolean; out: string; err: string }>((ok) => {
    const p = spawn("node", [script, ...args], { env: { ...process.env, ...env } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => ok({ ok: code === 0, out, err }));
  });

async function ejecutar(t: Trabajo, sources_url: string, token: string) {
  const base = t.dir;
  try {
    t.estado = "running";
    t.paso = "descarga";
    const fetch = await correr("scripts/fetch.ts", { FUENTES_URL: sources_url, FUENTES_TOKEN: token, FUENTES_DIR: join(base, "fuentes") });
    if (!fetch.ok) throw new Error(`descarga: ${fetch.err.slice(0, 400)}`);

    t.paso = "extraccion";
    const esp = await correr("scripts/espejo.ts", { DATA: join(base, "data") }, [join(base, "fuentes"), join(base, "esp")]);
    if (!esp.ok) throw new Error(`extracción: ${esp.err.slice(0, 400)}`);

    // ¿Este conjunto se puede anonimizar? Jev mira la FORMA de los datos (sin valores).
    t.paso = "preflight";
    const pre = await correr("scripts/preflight.ts", { DATA: join(base, "data") }, ["--json", "--dir", join(base, "data")]);
    let veredicto: any = null;
    try { veredicto = JSON.parse(pre.out).veredicto; } catch { veredicto = null; }
    t.preflight = veredicto;
    if (veredicto) writeFileSync(join(base, "preflight.json"), JSON.stringify(veredicto, null, 1));
    if (veredicto?.aplicable === "no") {
      throw new Error(`preflight: el conjunto no parece anonimizable (${veredicto.motivos?.join("; ") ?? "sin detalle"})`);
    }

    t.paso = "anonimizacion";
    const anon = await correr("scripts/anonimizar.ts", { DATA: join(base, "data"), REGISTRO: "registro" }, [join(base, "data/extraccion"), join(base, "output")]);
    if (!anon.ok) throw new Error(`anonimización: ${anon.err.slice(0, 400)}`);
    try { t.voces = JSON.parse(anon.out); } catch { t.voces = null; }

    t.paso = "verificacion";
    const bar = await correr("scripts/barrido.ts", { DATA: join(base, "data") }, [join(base, "output")]);
    let fugas = null;
    try { fugas = JSON.parse(bar.out); } catch { fugas = null; }
    if (!bar.ok || (fugas && fugas.fugas > 0)) throw new Error(`barrido: ${bar.out.slice(0, 400)}`);

    t.estado = "done";
    t.paso = "listo";
    ultimo = t;
  } catch (e: any) {
    t.estado = "failed";
    t.error = String(e.message ?? e).slice(0, 800);
    t.paso = "fallo";
  } finally {
    t.segundos = Math.round((Date.now() - t.inicio) / 100) / 10;
  }
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PUERTO}`);
  const ruta = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (req.method === "GET" && ruta === "/health") {
      return json(res, 200, {
        status: "ok", team: EQUIPO, version: VERSION, models: MODELOS,
        registro: existsSync("registro/identidades.json"),
        trabajos: trabajos.size,
        trabajos_en_curso: [...trabajos.values()].filter((t) => t.estado === "running").length,
        uptime_s: Math.round(process.uptime()),
      });
    }

    if (req.method === "POST" && ruta === "/run") {
      const cuerpo = JSON.parse((await leerCuerpo(req)) || "{}");
      // "env" = usa las credenciales del propio servidor (el panel interno lo hace así).
      if (cuerpo.sources_url === "env" && !tokenValido(req)) {
        return json(res, 401, { error: "correr con las credenciales del servidor requiere el token interno" });
      }
      if (cuerpo.sources_url === "env") cuerpo.sources_url = process.env.FUENTES_URL;
      if (cuerpo.token === "env") cuerpo.token = process.env.FUENTES_TOKEN;
      if (!cuerpo.sources_url || !cuerpo.token) return json(res, 400, { error: "faltan sources_url y token" });
      const id = randomUUID();
      const t: Trabajo = { id, estado: "queued", inicio: Date.now(), dir: join(TRABAJOS, id), tokens: 0, paso: "en cola" };
      mkdirSync(t.dir, { recursive: true });
      trabajos.set(id, t);
      void ejecutar(t, cuerpo.sources_url, cuerpo.token);
      return json(res, 202, { job_id: id, estado: t.estado });
    }

    if (req.method === "GET" && (ruta === "/panel" || ruta === "/panel.html")) {
      const p = "public/panel.html";
      if (!existsSync(p)) return json(res, 404, { error: "falta public/panel.html" });
      const buf = readFileSync(p);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-length": buf.length });
      return res.end(buf);
    }

    if (req.method === "GET" && /^\/run\/[^/]+\/muestra$/.test(ruta)) {
      if (!tokenValido(req)) return json(res, 401, { error: "esta vista compara con el texto original: requiere token" });
      const id = ruta.split("/")[2];
      const dirJob = join("trabajos", id);
      const t = trabajos.get(id) ?? (existsSync(dirJob) ? { dir: dirJob } : null);
      if (!t) return json(res, 404, { error: "job desconocido" });
      const n = Math.min(50, Number(url.searchParams.get("n") ?? 6));
      const leer = (ruta2: string) => existsSync(ruta2)
        ? readFileSync(ruta2, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
        : [];
      const pares: any[] = [];
      const campos: [string, string][] = [["chats", "text"], ["docs", "body"], ["tables", "columns"]];
      for (const [fuente, campo] of campos) {
        const orig = new Map(leer(join(t.dir, "data/extraccion", `${fuente}.jsonl`)).map((r: any) => [r.id, r]));
        for (const a of leer(join(t.dir, "output", `${fuente}.jsonl`))) {
          if (pares.length >= n) break;
          const o: any = orig.get(a.id);
          if (!o) continue;
          let original = "", anonimizado = "";
          if (campo === "columns") {
            for (const k of Object.keys(o.columns ?? {})) {
              if (String(o.columns[k]) !== String((a.columns ?? {})[k])) {
                original = String(o.columns[k]); anonimizado = String((a.columns ?? {})[k]);
                break;
              }
            }
            if (!original) continue;
          } else {
            original = String(o[campo] ?? ""); anonimizado = String(a[campo] ?? "");
            if (original === anonimizado || !original.trim()) continue;
          }
          pares.push({ fuente, id: a.id, campo, original: original.slice(0, 600), anonimizado: anonimizado.slice(0, 600) });
        }
      }
      return json(res, 200, { job_id: id, pares });
    }

    if (req.method === "GET" && ruta.startsWith("/run/")) {
      const idJob = ruta.slice(5);
      const t = trabajos.get(idJob);
      if (!t) {
        // Tras un reinicio el job no está en memoria: se reconstruye desde su carpeta si existe.
        const d = join("trabajos", idJob);
        if (!existsSync(d)) return json(res, 404, { error: "job desconocido" });
        const hecho = existsSync(join(d, "output", "entities.json"));
        return json(res, 200, { job_id: idJob, status: hecho ? "done" : "failed", paso: hecho ? "listo" : "interrumpido",
          segundos: null, tokens: 0, counts: null, error: hecho ? null : "el servicio se reinició durante esta corrida",
          preflight: existsSync(join(d, "preflight.json")) ? JSON.parse(readFileSync(join(d, "preflight.json"), "utf8")) : null });
      }
      return json(res, 200, {
        job_id: t.id, status: t.estado, paso: t.paso, segundos: t.segundos ?? null,
        tokens: t.tokens, counts: t.voces?.registros ?? null, error: t.error ?? null,
        preflight: t.preflight ?? null,
      });
    }

    if (req.method === "GET" && ruta === "/output/" + ruta.split("/").pop() && ["/output/chats.jsonl", "/output/docs.jsonl", "/output/tables.jsonl", "/output/entities.json"].includes(ruta)) {
      const archivo = ruta.split("/").pop()!;
      const p = join(carpetaSalida(), "output", archivo);
      if (!existsSync(p)) return json(res, 404, { error: `no existe ${archivo}` });
      const buf = readFileSync(p);
      res.writeHead(200, { "content-type": archivo.endsWith(".json") ? "application/json; charset=utf-8" : "application/x-ndjson; charset=utf-8", "content-length": buf.length });
      return res.end(buf);
    }

    if (req.method === "GET" && ruta === "/entities") {
      const p = join(carpetaSalida(), "output/entities.json");
      if (!existsSync(p)) return json(res, 404, { error: "todavía no hay diccionario" });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(readFileSync(p));
    }

    if (req.method === "POST" && ruta === "/anonymize") {
      const cuerpo = await leerCuerpo(req);
      const r = await new Promise<{ ok: boolean; out: string; err: string }>((ok) => {
        const p = spawn("node", ["scripts/anonymize-lote.ts"]);
        let out = "", err = "";
        p.stdout.on("data", (d) => (out += d));
        p.stderr.on("data", (d) => (err += d));
        p.on("close", (code) => ok({ ok: code === 0, out, err }));
        p.stdin.write(cuerpo);
        p.stdin.end();
      });
      if (!r.ok) return json(res, 500, { error: r.err.slice(0, 500) });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      return res.end(r.out);
    }

    return json(res, 404, { error: "ruta no encontrada", rutas: ["/health", "/run", "/run/{id}", "/run/{id}/muestra", "/output/{archivo}", "/anonymize", "/entities", "/panel"] });
  } catch (e: any) {
    return json(res, 500, { error: String(e.message ?? e).slice(0, 500) });
  }
});

servidor.listen(PUERTO, () => {
  console.log(JSON.stringify({ listo: true, puerto: PUERTO, equipo: EQUIPO, modelos: MODELOS, registro: existsSync("registro/identidades.json") }));
});
