// Clasifica con Jev los candidatos dudosos del registro y deja las decisiones en caché.
// Uso: node scripts/jev-clasificar.ts [--solo-cache]
// Escribe registro/jev-decisiones.json:
//   { "cadenas": { "<cadena>": "persona" | "organizacion" | "lugar" | "duda" }, costo_usd, modelo }
// El pipeline lee ese archivo y NUNCA llama a la red en caliente.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { clasificarCadenas } from "../src/jev/cliente.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const soloCache = process.argv.includes("--solo-cache");
const dirRegistro = process.env.REGISTRO ?? "registro";

interface Persona { nombre: string; correo?: string; cedula?: string; liga?: string; tipo?: string }

const leer = (f: string): any => (existsSync(`${dirRegistro}/${f}`) ? JSON.parse(readFileSync(`${dirRegistro}/${f}`, "utf8")) : null);

const reg = leer("personas.json");
const personas: Persona[] = reg?.personas ?? [];
// Candidatas: los terceros que crearon las reglas (donde puede haber un falso positivo) y los
// nombres que aparecieron sin ancla estructurada.
const candidatas = [...new Set(
  personas
    .filter((p) => p.tipo === "tercero" || (p.liga ?? "").startsWith("tercero"))
    .map((p) => p.nombre)
    .filter((n) => n && n.trim().length >= 6),
)];

if (!candidatas.length) {
  console.log(JSON.stringify({ candidatas: 0, mensaje: "no hay terceros que clasificar" }, null, 1));
  process.exit(0);
}

const clasificacion = await clasificarCadenas(candidatas, { umbral: 0.85, soloCache });
const conteo: Record<string, number> = {};
for (const v of clasificacion.values()) conteo[v] = (conteo[v] ?? 0) + 1;

mkdirSync(dirRegistro, { recursive: true });
writeFileSync(`${dirRegistro}/jev-decisiones.json`, JSON.stringify({
  generado: new Date().toISOString(),
  modelo: process.env.JEV_MODELO ?? "typesafe/jev-1.14",
  umbral: 0.85,
  cadenas: Object.fromEntries(clasificacion),
}, null, 1));

console.log(JSON.stringify({
  candidatas: candidatas.length,
  resultado: conteo,
  detalle: Object.fromEntries(clasificacion),
}, null, 1));
