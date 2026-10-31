// Verificación INDEPENDIENTE del motor: busca las formas reales en output/ con comparación literal
// (sin normalizar, sin confusables, sin separadores). Si el motor y el barrido compartieran un bug,
// esto lo vería igual. Complementa a scripts/barrido.ts, no lo reemplaza.
// Uso: node scripts/verificar.ts [output]
import { readFileSync, existsSync } from "node:fs";
import { leerJsonl, formasDe } from "../src/registro/personas.ts";

const out = process.argv[2] ?? "output";
const inv = JSON.parse(readFileSync("registro/inventario.json", "utf8"));
const personas = inv.personas as any[];
const terceros = existsSync("registro/terceros.json")
  ? (JSON.parse(readFileSync("registro/terceros.json", "utf8")).terceros as any[])
  : [];
const identidades = new Map<string, any>(
  (JSON.parse(readFileSync("registro/identidades.json", "utf8")).identidades as any[]).map((i) => [i.entity_id, i]),
);

const blob = ["chats.jsonl", "docs.jsonl", "tables.jsonl"]
  .filter((f) => existsSync(`${out}/${f}`))
  .map((f) => readFileSync(`${out}/${f}`, "utf8"))
  .join("\n");

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Palabra completa en el texto crudo: ni letras ni dígitos alrededor (respeta tildes y ñ). */
function apareceCrudo(valor: string): boolean {
  const v = valor.trim();
  if (v.length < 3) return false;
  const esNombre = /^[\p{L}\p{M} .'-]+$/u.test(v);
  const rx = esNombre
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escapar(v).replace(/ /g, "[ \\t]+")}(?![\\p{L}\\p{N}])`, "iu")
    : new RegExp(`(?<![\\p{N}])${escapar(v)}(?![\\p{N}])`, "u");
  return rx.test(blob);
}

const personasTodas = [...personas, ...terceros];
const fugas: { id: string; tipo: string; valor: string }[] = [];
let formas = 0;
for (const p of personasTodas) {
  for (const f of formasDe(p)) {
    if (!f.valor || f.valor.length < 3) continue;
    formas++;
    if (apareceCrudo(f.valor)) fugas.push({ id: p.id, tipo: f.tipo, valor: f.valor });
  }
}

// Correos y cédulas huérfanas del inventario (no pertenecen a nadie del registro)
const huerfanas = [
  ...(inv.resumen?.sinDueno?.correos ?? []).map((v: string) => ({ tipo: "correo_huerfano", valor: v })),
  ...(inv.resumen?.sinDueno?.cedulas ?? []).map((v: string) => ({ tipo: "cedula_huerfana", valor: v })),
  ...(inv.extras?.placa?.muestra ?? []).map((x: any) => ({ tipo: "placa", valor: x.valor })),
  ...(inv.extras?.pasaporte?.muestra ?? []).map((x: any) => ({ tipo: "pasaporte", valor: x.valor })),
].filter((x) => apareceCrudo(x.valor));

// Colisiones: dos personas con el mismo seudónimo de nombre, correo o cédula
const porClave = new Map<string, string[]>();
for (const [id, i] of identidades) {
  for (const campo of ["nombre_completo", "correo", "cedula", "celular"]) {
    const k = `${campo}:${String(i[campo] ?? "").toLowerCase()}`;
    if (!k.endsWith(":")) porClave.set(k, [...(porClave.get(k) ?? []), id]);
  }
}
const colisiones = [...porClave.entries()].filter(([, ids]) => ids.length > 1);

/**
 * Severidad: una fuga CRÍTICA identifica a alguien por sí sola (nombre y apellido, correo completo,
 * cédula, celular, placa, pasaporte, dirección). Un nombre de pila suelto o el prefijo de un correo
 * no identifican a nadie: se reportan aparte como colaterales, porque los pools de nombres comparten
 * nombres comunes con el corpus y eso no es una fuga.
 */
const esCritica = (f: { tipo: string; valor: string }): boolean => {
  const v = f.valor.trim();
  // El correo solo es crítico si viene completo (local@dominio); un prefijo "local@" no identifica.
  if (f.tipo === "correo") return v.includes("@") && (v.split("@")[1] ?? "").includes(".");
  if (/^(cedula|celular|placa|pasaporte|direccion|nit)$/i.test(f.tipo)) return true;
  if (/^(nombre_apellido|nombre_completo)$/i.test(f.tipo)) return v.split(/\s+/).length >= 2;
  if (f.tipo === "handle") return true;
  return v.split(/\s+/).length >= 2;
};
const criticas = fugas.filter(esCritica);
const colaterales = fugas.filter((f) => !esCritica(f));

const resumen = {
  formas_comparadas: formas,
  fugas_criticas: criticas.length,
  fugas_colaterales: colaterales.length,
  huerfanas_en_salida: huerfanas.length,
  colisiones_de_seudonimo: colisiones.length,
};
if (criticas.length) resumen["ejemplos_fuga_critica"] = criticas.slice(0, 15);
if (colaterales.length) resumen["ejemplos_colateral"] = colaterales.slice(0, 8).map((f) => f.valor);
if (huerfanas.length) resumen["ejemplos_huerfanas"] = huerfanas.slice(0, 10);
if (colisiones.length) resumen["ejemplos_colision"] = colisiones.slice(0, 5);
console.log(JSON.stringify(resumen, null, 1));
// Las colaterales no tumban la verificación: solo se informan.
const ok = !criticas.length && !huerfanas.length && !colisiones.length;
console.log(ok
  ? `PASA: 0 fugas críticas${colaterales.length ? ` (${colaterales.length} colaterales: nombres de pila o prefijos de correo)` : ""}.`
  : "FALLA: revisar lo anterior.");
process.exit(ok ? 0 : 1);
