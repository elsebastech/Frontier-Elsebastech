// Juez local: corre los tests (públicos o de la muestra) contra una salida, sin gastar corrida.
// Usa la misma función contiene() del validador oficial.
// Uso: node scripts/juez-local.ts <tests.json> <salida/> [--original data/extraccion]
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { contiene, norm } from "../src/anon/texto.ts";
import { leerJsonl } from "../src/registro/personas.ts";

interface Test {
  id: string; family: string; mechanism: string; weight: number; source: string;
  locator: { record: string | null; field: string | null };
  payload: string[]; expected: string; person?: string; entities?: string[];
  lookup_forms?: string[]; records?: string[]; sources?: string[]; extra?: any;
  forms?: Record<string, string>; persons?: string[];
}

const args = process.argv.slice(2);
const testsPath = args[0];
const salida = args[1] ?? "output";
const iOrig = args.indexOf("--original");
const origDir = iOrig >= 0 ? args[iOrig + 1] : "data/extraccion";

const tests = JSON.parse(readFileSync(testsPath, "utf8")) as Test[];
const cargar = (f: string) => (existsSync(join(salida, f)) ? leerJsonl<any>(join(salida, f)) : []);
const chats = cargar("chats.jsonl");
const docs = cargar("docs.jsonl");
const tablas = cargar("tables.jsonl");
const entities = existsSync(join(salida, "entities.json"))
  ? (JSON.parse(readFileSync(join(salida, "entities.json"), "utf8")).entities ?? [])
  : [];
const porId = new Map<string, any>();
for (const r of [...chats, ...docs, ...tablas]) porId.set(r.id, r);

const originales = new Map<string, any>();
if (existsSync(join(origDir, "chats.jsonl")))
  for (const r of [...leerJsonl<any>(join(origDir, "chats.jsonl")), ...leerJsonl<any>(join(origDir, "docs.jsonl")), ...leerJsonl<any>(join(origDir, "tables.jsonl"))])
    originales.set(r.id, r);

function valorCampo(rec: any, campo: string | null): string {
  if (!rec) return "";
  if (!campo) return JSON.stringify(rec);
  if (campo === "attachments") return (rec.attachments ?? []).map((a: any) => a.filename ?? a).join(" | ");
  if (campo.startsWith("columns.")) return String((rec.columns ?? {})[campo.slice(8)] ?? "");
  if (campo.startsWith("metadata.")) return String((rec.metadata ?? {})[campo.slice(9)] ?? "");
  const v = rec[campo];
  return typeof v === "string" ? v : JSON.stringify(v ?? "");
}
const textosDeTodo = () => [...chats, ...docs, ...tablas].map((r) => JSON.stringify(r));
const TODO = textosDeTodo();

const resultados: { id: string; family: string; ok: boolean; detalle: string }[] = [];

for (const t of tests) {
  const rec = t.locator.record ? porId.get(t.locator.record) : null;
  let ok = true;
  const detalles: string[] = [];
  const enTodo = (v: string) => TODO.some((s) => contiene(s, v));

  switch (t.family) {
    case "directa":
    case "oculta": {
      for (const p of t.payload) {
        const enCampo = rec ? contiene(valorCampo(rec, t.locator.field), p) : false;
        const enGlobal = enTodo(p);
        if (t.family === "directa" ? enGlobal : enCampo) {
          ok = false;
          detalles.push(`${p} sigue presente${enCampo ? ` en ${t.locator.record}:${t.locator.field}` : " en la salida"}`);
        }
      }
      break;
    }
    case "falso_positivo": {
      for (const p of t.payload) {
        if (!(rec && contiene(valorCampo(rec, t.locator.field), p))) { ok = false; detalles.push(`${p} se perdió (debe conservarse)`); }
      }
      break;
    }
    case "indirecta": {
      const ids = new Set<string>(t.extra?.join_records ?? []);
      if (t.locator.record) ids.add(t.locator.record);
      for (const r of tablas) {
        const col = r.columns ?? {};
        for (const v of t.payload) if (String(col.notas ?? "").includes(v) || String(col.descripcion ?? "").includes(v)) ids.add(r.id);
      }
      for (const id of ids) {
        const r = porId.get(id);
        if (!r) continue;
        const texto = valorCampo(r, null);
        if (t.payload.every((p) => contiene(texto, p))) {
          ok = false;
          detalles.push(`los 3 componentes co-ocurren en ${id}`);
        }
      }
      break;
    }
    case "homonimos": {
      // El registro del locator no puede compartir el nombre dibujado con otra persona del mismo nombre real.
      const nombreReal = t.payload[0] ?? "";
      const primeros2 = norm(nombreReal).split(" ").slice(0, 2).join(" ");
      const originalesIguales = [...originales.values()].filter((r) =>
        r?.columns?.nombre_completo && norm(String(r.columns.nombre_completo)).split(" ").slice(0, 2).join(" ") === primeros2);
      const dibujados = new Set(originalesIguales.map((o) => {
        const out = tablas.find((x) => x.id === o.id);
        return out ? String((out.columns ?? {}).nombre_completo ?? "") : "";
      }));
      if (originalesIguales.length >= 2 && dibujados.size < originalesIguales.length) {
        ok = false;
        detalles.push(`se dibujaron ${dibujados.size} seudónimos para ${originalesIguales.length} personas con el mismo nombre`);
      }
      if (!rec) { ok = false; detalles.push("no existe el registro del locator"); }
      break;
    }
    case "consistencia": {
      const formas = t.lookup_forms ?? Object.values(t.forms ?? {});
      const dueñas = new Set<string>();
      for (const f of formas) {
        const e = entities.find((x: any) => (x.originals ?? []).some((o: string) => norm(o) === norm(f)));
        if (e) dueñas.add(e.entity_id);
      }
      if (formas.length && dueñas.size !== 1) { ok = false; detalles.push(`${formas.length} formas caen en ${dueñas.size} entidades (debe ser 1)`); }
      for (const id of dueñas) {
        const e = entities.find((x: any) => x.entity_id === id);
        const nombres = new Set<string>();
        for (const rid of e?.records ?? []) {
          const r = porId.get(rid);
          if (!r) continue;
          if (r.author) nombres.add(r.author);
          const nc = (r.columns ?? {}).nombre_completo;
          if (nc) nombres.add(nc);
        }
        if (e?.pseudonyms?.name && nombres.size > 0 && ![...nombres].some((n) => n.includes(e.pseudonyms.name) || e.pseudonyms.name.includes(n))) {
          ok = false;
          detalles.push(`${id}: el nombre dibujado no coincide con el diccionario`);
        }
      }
      if (!dueñas.size) { ok = false; detalles.push("ninguna forma aparece en entities.json"); }
      break;
    }
    default:
      ok = false;
      detalles.push(`familia desconocida: ${t.family}`);
  }
  resultados.push({ id: t.id, family: t.family, ok, detalle: detalles.join("; ") });
}

const pasan = resultados.filter((r) => r.ok).length;
const pesoTotal = tests.reduce((a, t) => a + (t.weight ?? 1), 0);
const pesoGanado = tests.reduce((a, t) => a + (resultados.find((r) => r.id === t.id)?.ok ? (t.weight ?? 1) : 0), 0);
for (const r of resultados) if (!r.ok) console.log(`FALLA ${r.id} (${r.family}) — ${r.detalle}`);
console.log(JSON.stringify({ tests: tests.length, pasan, fallan: tests.length - pasan, peso: `${pesoGanado}/${pesoTotal}` }, null, 1));
process.exit(pasan === tests.length ? 0 : 1);
