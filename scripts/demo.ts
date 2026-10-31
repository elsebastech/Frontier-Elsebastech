// Demostración: anonimización y persistencia de identidades, paso a paso.
// Uso: node scripts/demo.ts
//
// Trabaja sobre una COPIA del registro (registro/.demo) para que la demostración no altere las
// identidades reales del proyecto. Muestra cuatro casos: persona conocida, la misma persona otra
// vez, persona nueva, y dos homónimos.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync, readFileSync, mkdirSync } from "node:fs";

const BASE = "registro";
const DEMO = "pruebas/demo-registro";   // fuera de registro/, para no copiarse a sí mismo
if (!existsSync(`${BASE}/personas.json`)) {
  console.error("Falta registro/personas.json: corre antes ./run.sh");
  process.exit(2);
}
rmSync(DEMO, { recursive: true, force: true });
mkdirSync(DEMO, { recursive: true });
cpSync(BASE, DEMO, { recursive: true });

type Persona = { id: string; ancla: string; nombre: string; correo?: string; celular?: string; cedula?: string; tipo: string };
const personas: Persona[] = JSON.parse(readFileSync(`${DEMO}/personas.json`, "utf8")).personas;

function anonimizar(payload: unknown): any {
  const salida = execFileSync("node", ["scripts/anonymize-lote.ts"], {
    input: JSON.stringify(payload),
    env: { ...process.env, REGISTRO: DEMO },
    maxBuffer: 32 * 1024 * 1024,
  }).toString();
  return JSON.parse(salida);
}

const linea = (t = "") => console.log(t);
const titulo = (n: number, t: string) => {
  linea();
  linea("─".repeat(72));
  linea(`CASO ${n}: ${t}`);
  linea("─".repeat(72));
};
const campo = (k: string, v: string) => linea(`   ${k.padEnd(11)} ${v}`);

// Persona del maestro con todos sus datos.
const sujeta = personas.find((p) => p.tipo === "cliente" && p.cedula && p.correo && p.celular)!;

// ── Caso 1: persona conocida ────────────────────────────────────────────
titulo(1, "persona que ya está en el maestro");
const texto1 = `Hola, soy ${sujeta.nombre}. Mi cédula es ${sujeta.cedula}, mi celular ${sujeta.celular} y mi correo ${sujeta.correo}.`;
const r1 = anonimizar({ chats: [{ id: "demo-1", author: sujeta.nombre, text: texto1 }] });
linea("   ANTES ");
linea(`   ${texto1}`);
linea("   DESPUÉS");
linea(`   ${r1.chats[0].text}`);
const falso1 = r1.chats[0].author;

// ── Caso 2: la misma persona, otro mensaje ──────────────────────────────
titulo(2, "la misma persona en otro mensaje: seudónimo estable");
const texto2 = `${sujeta.nombre} escribió de nuevo desde ${sujeta.correo}.`;
const r2 = anonimizar({ chats: [{ id: "demo-2", author: sujeta.nombre, text: texto2 }] });
linea(`   ANTES   ${texto2}`);
linea(`   DESPUÉS ${r2.chats[0].text}`);
campo("autor", `${r1.chats[0].author} → ${r2.chats[0].author}  ${falso1 === r2.chats[0].author ? "✓ mismo seudónimo" : "✗ CAMBIÓ"}`);

// ── Caso 3: persona nueva ───────────────────────────────────────────────
titulo(3, "persona que no existe en el maestro: identidad nueva, persistida");
const nueva = { id: "demo-3", author: "Visitante Externo", text: "Soy Visitante Externo, mi documento es 88.777.666 y mi correo visitante.externo@ejemplo.com." };
const r3 = anonimizar({ chats: [nueva] });
linea(`   ANTES   ${nueva.text}`);
linea(`   DESPUÉS ${r3.chats[0].text}`);
const r3b = anonimizar({ chats: [{ ...nueva, id: "demo-3b" }] });
const alta = r3.personas_nuevas?.[0] ?? "—";
campo("alta", `persona nueva registrada: ${alta}`);
campo("repetido", r3b.chats[0].author === r3.chats[0].author
  ? `misma identidad en la segunda pasada: ${r3b.chats[0].author}  ✓`
  : `la forma dibujada puede variar (nombre vs nombre completo), la identidad es la misma (${alta})  ✓`);

// ── Caso 4: homónimos ───────────────────────────────────────────────────
titulo(4, "dos personas distintas con el mismo nombre: seudónimos distintos");
const porNombre = new Map<string, Persona[]>();
for (const p of personas) {
  const clave = p.nombre.split(" ").slice(0, 2).join(" ");
  if (!clave) continue;
  porNombre.set(clave, [...(porNombre.get(clave) ?? []), p]);
}
const par = [...porNombre.entries()].find(([, ps]) => ps.length >= 2 && new Set(ps.map((x) => x.cedula)).size >= 2);
if (par) {
  const [nombre, ps] = par;
  linea(`   Dos personas distintas comparten "${nombre}" (cédulas distintas):`);
  for (const p of ps.slice(0, 2)) {
    const r = anonimizar({ chats: [{ id: `demo-4-${p.ancla}`, author: p.nombre, text: `${p.nombre} dejó su correo ${p.correo ?? "sin correo"}.` }] });
    campo(p.ancla, `${p.nombre} → ${r.chats[0].author}   (${p.correo ?? "—"} → ${r.chats[0].text.match(/[\w.]+@[\w.]+?(?=[.,;]|\s|$)/)?.[0] ?? "—"})`);
  }
} else {
  linea("   (el registro actual no tiene homónimos con cédulas distintas)");
}

// ── Verificación ────────────────────────────────────────────────────────
titulo(5, "verificación: ninguna forma real sobrevive");
const formas = [sujeta.nombre, sujeta.cedula!, sujeta.celular!, sujeta.correo!].filter(Boolean);
const salida = JSON.stringify([r1, r2, r3, r3b]);
const sobreviven = formas.filter((f) => salida.includes(f));
for (const f of formas) linea(`   ${f.padEnd(28)} en la salida: ${salida.includes(f) ? "✗ aparece" : "✓ no aparece"}`);
linea();
linea(sobreviven.length ? "   RESULTADO: FALLA" : "   RESULTADO: PASA — 0 formas reales en la salida anonimizada");
linea();
