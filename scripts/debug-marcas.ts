// Depuración puntual: qué formas de una persona coinciden y con qué tramo (temporal, no va al repo).
import { readFileSync } from "node:fs";
import { construir, formasDe, leerJsonl } from "../src/registro/personas.ts";
import { indexar, buscarMarcas } from "../src/anon/motor.ts";

const ancla = process.argv[2] ?? "CL-16386";
const base = process.argv[3] ?? "pruebas/f3-data";
const tablas = leerJsonl<any>(`${base}/extraccion/tables.jsonl`);
const chats = leerJsonl<any>(`${base}/extraccion/chats.jsonl`);
const docs = leerJsonl<any>(`${base}/extraccion/docs.jsonl`);
const uids = JSON.parse(readFileSync(`${base}/uids.json`, "utf8"));
const reg = construir(tablas, uids);
const p = reg.personas.find((x) => x.ancla === ancla)!;
console.log("formas:", formasDe(p).map((f) => `${f.tipo}=${JSON.stringify(f.valor)}`).join(" · "));
const idx = indexar(reg.personas, formasDe);
const fd = reg.personas.flatMap((pp) =>
  formasDe(pp).map((f) => ({ p: pp, f, digitos: f.valor.replace(/\D/g, "") }))
    .filter((x) => x.digitos.length >= 6 && !/[a-zA-Z]/.test(x.f.valor) && x.digitos.length >= 0.6 * x.f.valor.length));
for (const [fuente, rs, campo] of [["chat", chats, "text"], ["doc", docs, "body"]] as const) {
  for (const r of rs) {
    const ms = buscarMarcas(r[campo] ?? "", idx, fd).filter((m) => m.persona.ancla === ancla);
    if (!ms.length) continue;
    console.log(`\n${fuente} ${r.id}: ${JSON.stringify(String(r[campo]).slice(0, 240))}`);
    for (const m of ms) console.log(`   tipo=${m.forma.tipo} tramo=${JSON.stringify(String(r[campo]).slice(m.ini, m.fin))}`);
  }
}
