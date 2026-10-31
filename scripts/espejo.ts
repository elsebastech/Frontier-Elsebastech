// Salida "espejo": extrae las fuentes y escribe output/ SIN anonimizar, para validar la forma.
// También deja data/extraccion/ (registros con campos internos) y data/uids.json (inventario).
// Uso: node scripts/espejo.ts [fuentes/] [output/]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extraer, publico } from "../src/extract/index.ts";

const dir = process.argv[2] ?? "fuentes";
const out = process.argv[3] ?? "output";
const datadir = process.env.DATA ?? "data";
const t0 = Date.now();
const x = extraer(dir);
mkdirSync(out, { recursive: true });
mkdirSync(`${datadir}/extraccion`, { recursive: true });
const jsonl = (rs: object[]) => rs.map((r) => JSON.stringify(r)).join("\n") + "\n";
writeFileSync(join(out, "chats.jsonl"), jsonl(x.chats.map(publico)));
writeFileSync(join(out, "docs.jsonl"), jsonl(x.docs.map(publico)));
writeFileSync(join(out, "tables.jsonl"), jsonl(x.tables.map(publico)));
writeFileSync(join(out, "entities.json"), JSON.stringify({ entities: [] }));
writeFileSync(`${datadir}/extraccion/chats.jsonl`, jsonl(x.chats));
writeFileSync(`${datadir}/extraccion/docs.jsonl`, jsonl(x.docs));
writeFileSync(`${datadir}/extraccion/tables.jsonl`, jsonl(x.tables));
writeFileSync(`${datadir}/uids.json`, JSON.stringify([...x.uids.values()], null, 1));

const uids = [...x.uids.values()];
const porTabla: Record<string, number> = {};
for (const t of x.tables) porTabla[t.table] = (porTabla[t.table] ?? 0) + 1;
console.log(JSON.stringify({
  segundos: (Date.now() - t0) / 1000,
  chats: x.chats.length, hilos: new Set(x.chats.map((c) => c.thread_id)).size,
  docs: Object.fromEntries(["pdf", "html", "md"].map((f) => [f, x.docs.filter((d) => d.format === f).length])),
  docs_body_vacio: x.docs.filter((d) => d.body.trim().length < 20).map((d) => d.id),
  tablas: porTabla,
  uids: {
    total: uids.length,
    en_users: uids.filter((u) => u.en_users).length,
    fuera_de_users: uids.filter((u) => !u.en_users).map((u) => ({ uid: u.uid, ap: u.apariciones })),
    con_mencion: uids.filter((u) => u.apariciones.mencion).length,
    autores: uids.filter((u) => u.apariciones.autor).length,
  },
  comentarios_en_tablas: Object.fromEntries(Object.entries(x.comentariosTablas).map(([k, v]) => [k, v.length])),
}, null, 1));
