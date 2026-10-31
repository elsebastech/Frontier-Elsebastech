// Compuerta de entrada: ¿este conjunto se puede anonimizar con este proceso?
// Uso: node scripts/preflight.ts [--json] [--dir data]
// A Jev se le manda solo la FORMA de los datos (tablas, columnas, tipos, conteos), nunca un valor.
import { existsSync } from "node:fs";
import { formaDelConjunto, preflight } from "../src/jev/preflight.ts";

if (existsSync(".env")) process.loadEnvFile(".env");
const json = process.argv.includes("--json");
const iDir = process.argv.indexOf("--dir");
const dir = iDir >= 0 ? process.argv[iDir + 1] : (process.env.DATA ?? "data");

const forma = formaDelConjunto(dir);
const veredicto = await preflight(forma);
const salida = { veredicto, forma: json ? forma : undefined, resumen: {
  fuentes: Object.fromEntries(Object.entries(forma.fuentes).map(([k, v]) => [k, v.registros])),
  tablas: forma.tablas,
  formatos: forma.formatos_documento,
} };

if (json) {
  console.log(JSON.stringify(salida, null, 1));
} else {
  const v = veredicto.aplicable;
  const icono = v === "si" ? "✓" : v === "no" ? "✗" : v === "sin_jev" ? "·" : "!";
  console.log(`${icono} aplicable: ${v}${veredicto.modelo ? `  (${veredicto.modelo})` : ""}`);
  for (const m of veredicto.motivos) console.log(`   ${m}`);
  console.log(`   fuentes: ${Object.entries(salida.resumen.fuentes).map(([k, n]) => `${k} ${n}`).join(" · ")}`);
  console.log(`   tablas: ${forma.tablas.join(", ")} · documentos: ${JSON.stringify(forma.formatos_documento)}`);
  for (const t of forma.tablas) {
    const cols = forma.fuentes[t]?.columnas ?? [];
    const interesantes = cols.filter((c) => ["digitos", "correo", "fecha", "texto_largo"].includes(c.tipo)).length;
    console.log(`   ${t}: ${cols.length} columnas (${interesantes} con datos tipados) · ${forma.fuentes[t]?.registros} filas`);
  }
}

// Código de salida útil para encadenar: 0 compatible, 2 incompatible.
process.exit(veredicto.aplicable === "no" ? 2 : 0);
