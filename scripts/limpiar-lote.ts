// Limpia del registro las personas inventadas al probar con /anonymize (ancla "lote:…") que no
// aparecen en la salida ni en las fuentes. No toca a nadie del corpus ni a los seudónimos.
// Uso: node scripts/limpiar-lote.ts [--aplicar]
import { readFileSync, existsSync, writeFileSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");
const REG = process.env.REGISTRO ?? "registro";
const aplicar = process.argv.includes("--aplicar");

const reg = JSON.parse(readFileSync(`${REG}/personas.json`, "utf8"));
const idents = JSON.parse(readFileSync(`${REG}/identidades.json`, "utf8"));
const listaIdents: any[] = Array.isArray(idents.identidades) ? idents.identidades : Object.values(idents.identidades);

// Todo el texto de la salida y de las fuentes: si la persona no está ahí, no la usa nadie.
const texto = ["output/chats.jsonl", "output/docs.jsonl", "output/tables.jsonl",
  "data/extraccion/chats.jsonl", "data/extraccion/docs.jsonl", "data/extraccion/tables.jsonl"]
  .filter((f) => existsSync(f)).map((f) => readFileSync(f, "utf8")).join("\n");

const sobrantes = reg.personas.filter((p: any) =>
  String(p.ancla).startsWith("lote:") && !texto.includes(p.nombre ?? "\u0000"));

console.log(`personas de prueba en el registro: ${reg.personas.filter((p: any) => String(p.ancla).startsWith("lote:")).length}`);
console.log(`sin uso en la salida ni en las fuentes: ${sobrantes.length}`);
for (const p of sobrantes) console.log(`  ${p.id} ${p.ancla} (${p.nombre})`);

if (!aplicar) {
  console.log("\n(simulación: vuelve a correrlo con --aplicar para quitarlas)");
  process.exit(0);
}
const fuera = new Set(sobrantes.map((p: any) => p.ancla));
reg.personas = reg.personas.filter((p: any) => !fuera.has(p.ancla));
const limpio = listaIdents.filter((i: any) => !fuera.has(i.ancla));
idents.identidades = Array.isArray(idents.identidades) ? limpio : Object.fromEntries(limpio.map((i: any) => [i.ancla, i]));
writeFileSync(`${REG}/personas.json`, JSON.stringify(reg, null, 1));
writeFileSync(`${REG}/identidades.json`, JSON.stringify(idents, null, 1));
console.log(`\nquedaron ${reg.personas.length} personas y ${limpio.length} identidades`);
