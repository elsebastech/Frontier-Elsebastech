// Firma del esquema de las fuentes: qué tablas hay y con qué columnas.
// Sirve para detectar cambios de FORMATO (columna nueva, tabla nueva), no solo de conteo.
// El vigilante la compara en cada cambio y el preflight decide después si el anonimizador aplica.

export type Firma = Record<string, string[]>;

/** Construye la firma a partir de las filas de /tables (nombre de tabla → columnas ordenadas). */
export function firmaDesdeFilas(filas: { table: string; columns?: Record<string, unknown> }[]): Firma {
  const mapa: Firma = {};
  for (const f of filas) {
    if (!f?.table) continue;
    if (!mapa[f.table]) mapa[f.table] = Object.keys(f.columns ?? {}).sort();
  }
  return mapa;
}

/** Diferencias legibles entre dos firmas. Lista vacía = mismo esquema. */
export function derivaDeEsquema(actual: Firma, previa: Firma | null): string[] {
  if (!previa) return ["sin firma previa: se guarda como referencia"];
  const avisos: string[] = [];
  for (const t of Object.keys(actual)) {
    if (!previa[t]) { avisos.push(`tabla nueva: ${t} (${actual[t].length} columnas)`); continue; }
    const nuevas = actual[t].filter((c) => !previa[t].includes(c));
    const idas = previa[t].filter((c) => !actual[t].includes(c));
    if (nuevas.length) avisos.push(`${t}: columnas nuevas ${nuevas.join(", ")}`);
    if (idas.length) avisos.push(`${t}: columnas que desaparecieron ${idas.join(", ")}`);
  }
  for (const t of Object.keys(previa)) if (!actual[t]) avisos.push(`tabla desaparecida: ${t}`);
  return avisos;
}

/** ¿La deriva obliga a revisar antes de correr? Sí si hay columnas perdidas o tablas nuevas. */
export function derivaGrave(deriva: string[]): boolean {
  return deriva.some((d) => /desaparecid|tabla nueva|sin firma previa/.test(d));
}

// ── Firma de archivos: lo que /tables del proveedor publica (charset, separador, filas) ──
export interface ArchivoFuente {
  name: string;
  format: string;
  charset?: string;
  separator?: string;
  rows?: number;
}
export type FirmaArchivos = Record<string, { formato: string; charset: string; separador: string; filas: number }>;

export function firmaDeArchivos(lista: ArchivoFuente[]): FirmaArchivos {
  const mapa: FirmaArchivos = {};
  for (const f of lista) {
    if (!f?.name) continue;
    mapa[f.name] = {
      formato: f.format ?? "",
      charset: (f.charset ?? "").toLowerCase(),
      separador: f.separator ?? "",
      filas: f.rows ?? 0,
    };
  }
  return mapa;
}

/** Cambios de FORMATO: archivo nuevo, charset o separador distinto. Las filas van aparte. */
export function derivaDeArchivos(actual: FirmaArchivos, previa: FirmaArchivos | null): string[] {
  if (!previa) return ["sin firma previa de archivos"];
  const avisos: string[] = [];
  for (const n of Object.keys(actual)) {
    const p = previa[n];
    if (!p) { avisos.push(`archivo nuevo: ${n} (${actual[n].formato}, charset ${actual[n].charset || "?"}, ${actual[n].filas} filas)`); continue; }
    if (p.formato !== actual[n].formato) avisos.push(`${n}: formato ${p.formato} → ${actual[n].formato}`);
    if (p.charset !== actual[n].charset) avisos.push(`${n}: charset ${p.charset} → ${actual[n].charset}`);
    if (p.separador !== actual[n].separador) avisos.push(`${n}: separador "${p.separador}" → "${actual[n].separador}"`);
  }
  for (const n of Object.keys(previa)) if (!actual[n]) avisos.push(`archivo desaparecido: ${n}`);
  return avisos;
}
