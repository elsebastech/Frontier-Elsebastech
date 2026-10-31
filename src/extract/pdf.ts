// Extractor de PDF propio para los documentos "Kipu Docs 1.4": streams FlateDecode con
// operadores BT … Td (texto) Tj ET, fuente F1 = negrita / F2 = normal, tablas con `re S`.
// Devuelve markdown: tamaño ≥ 15 → "#", ≥ 12 → "##", celdas en la misma línea → fila de tabla,
// líneas cortadas por justificado se unen en un párrafo.
import { inflateSync } from "node:zlib";

interface Linea { x: number; y: number; tam: number; texto: string; justificada: boolean; pagina: number }

function decodificarCadenaPdf(s: string): string {
  // s viene en latin-1; resolver escapes \n \r \t \b \f \( \) \\ \ddd
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
    const n = s[++i];
    if (n === undefined) break;
    if (/[0-7]/.test(n)) {
      let oct = n;
      while (oct.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) oct += s[++i];
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "t") out += "\t";
    else if (n === "b") out += "\b";
    else if (n === "f") out += "\f";
    else if (n === "\r" || n === "\n") { if (n === "\r" && s[i + 1] === "\n") i++; }
    else out += n;
  }
  return out;
}

/** Lee un literal ( … ) con paréntesis balanceados desde la posición i (que apunta a "("). */
function leerLiteral(s: string, i: number): [string, number] {
  let prof = 0, j = i, buf = "";
  for (; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") { buf += c + (s[j + 1] ?? ""); j++; continue; }
    if (c === "(") { if (prof++ > 0) buf += c; continue; }
    if (c === ")") { if (--prof === 0) break; buf += c; continue; }
    buf += c;
  }
  return [buf, j + 1];
}

function streamsDePagina(pdf: string): string[] {
  // Orden de páginas según /Kids; cada página → su /Contents.
  const objetos = new Map<number, string>();
  for (const m of pdf.matchAll(/(\d+) 0 obj([\s\S]*?)endobj/g)) objetos.set(Number(m[1]), m[2]);
  const raiz = [...objetos.values()].find((o) => /\/Type\s*\/Pages\b/.test(o));
  const kids = raiz?.match(/\/Kids\s*\[([^\]]*)\]/)?.[1].match(/(\d+) 0 R/g)?.map((k) => Number(k.split(" ")[0])) ?? [];
  const contenidos: string[] = [];
  for (const k of kids) {
    const pag = objetos.get(k) ?? "";
    const refs = pag.match(/\/Contents\s*(\[[^\]]*\]|\d+ 0 R)/)?.[1].match(/(\d+) 0 R/g) ?? [];
    for (const r of refs) {
      const obj = objetos.get(Number(r.split(" ")[0])) ?? "";
      const st = obj.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
      if (!st) continue;
      const bytes = Buffer.from(st[1], "latin1");
      contenidos.push(/FlateDecode/.test(obj) ? inflateSync(bytes).toString("latin1") : st[1]);
    }
  }
  return contenidos;
}

export function metadataPdf(pdf: string): Record<string, string> {
  const info = pdf.match(/\/Info\s+(\d+) 0 R/);
  if (!info) return {};
  const obj = pdf.match(new RegExp(`\\b${info[1]} 0 obj([\\s\\S]*?)endobj`))?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const m of obj.matchAll(/\/(\w+)\s*\(/g)) {
    const [lit] = leerLiteral(obj, (m.index ?? 0) + m[0].length - 1);
    out[m[1].toLowerCase()] = decodificarCadenaPdf(lit);
  }
  return out;
}

interface Rect { x: number; y: number; w: number; h: number; pagina: number }

export function textoPdf(buf: Buffer): { markdown: string; metadata: Record<string, string>; lineas: number } {
  const pdf = buf.toString("latin1");
  const lineas: (Linea & { celda?: Rect })[] = [];
  const rects: Rect[] = [];
  streamsDePagina(pdf).forEach((s, pagina) => {
    let tam = 10;
    const rx = /(?:([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+re\b)|(?:BT\s+\/\w+\s+([\d.]+)\s+Tf\s+ET)|(?:BT\s+([\d.-]+)\s+([\d.-]+)\s+Td\s+(?:([\d.-]+)\s+Tw\s+)?\()/g;
    for (const m of s.matchAll(rx)) {
      if (m[1] !== undefined) { rects.push({ x: +m[1], y: +m[2], w: +m[3], h: +m[4], pagina }); continue; }
      if (m[5] !== undefined) { tam = Number(m[5]); continue; }
      const [lit] = leerLiteral(s, (m.index ?? 0) + m[0].length - 1);
      const x = Number(m[6]), y = Number(m[7]);
      const celda = rects.find((r) => r.pagina === pagina && x >= r.x - 0.5 && x <= r.x + r.w && y >= r.y - 0.5 && y <= r.y + r.h + 0.5);
      lineas.push({ x, y, tam, texto: decodificarCadenaPdf(lit), justificada: m[8] !== undefined, pagina, celda });
    }
  });

  const bloques: string[] = [];
  let parrafo = "";
  let ultJustificada = false;
  // tabla en construcción: filas por y del rectángulo, celdas por x
  let tabla: Map<string, Map<number, string>> | null = null;
  const cerrarParrafo = () => { if (parrafo) { bloques.push(parrafo); parrafo = ""; } };
  const cerrarTabla = () => {
    if (!tabla) return;
    const filas = [...tabla.values()].map((f) => [...f.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t.replace(/\|/g, "\\|")));
    const n = Math.max(...filas.map((f) => f.length));
    const linea = (f: string[]) => "| " + [...f, ...Array(n - f.length).fill("")].join(" | ") + " |";
    bloques.push([linea(filas[0]), "|" + " --- |".repeat(n), ...filas.slice(1).map(linea)].join("\n"));
    tabla = null;
  };
  let yPrev: number | null = null, pagPrev = -1;
  for (const l of lineas) {
    if (l.celda) {
      cerrarParrafo();
      tabla ??= new Map();
      const clave = `${l.celda.pagina}:${l.celda.y.toFixed(1)}`;
      const fila = tabla.get(clave) ?? new Map<number, string>();
      const previo = fila.get(l.celda.x);
      fila.set(l.celda.x, previo ? previo + " " + l.texto : l.texto);
      tabla.set(clave, fila);
      yPrev = null;
      continue;
    }
    cerrarTabla();
    if (l.tam >= 15) { cerrarParrafo(); bloques.push("# " + l.texto); yPrev = null; continue; }
    if (l.tam >= 12) { cerrarParrafo(); bloques.push("## " + l.texto); yPrev = null; continue; }
    // cambio de página a mitad de un párrafo justificado = el párrafo continúa
    const salto = yPrev === null ? 99 : l.pagina !== pagPrev ? (ultJustificada ? 0 : 99) : yPrev - l.y;
    if (!parrafo || salto > 18) { cerrarParrafo(); parrafo = l.texto; }      // espacio de párrafo (~21)
    else parrafo += (ultJustificada ? " " : "\n") + l.texto;                // interlineado (~15,6)
    ultJustificada = l.justificada;
    yPrev = l.y; pagPrev = l.pagina;
  }
  cerrarParrafo();
  cerrarTabla();
  return { markdown: bloques.join("\n\n") + "\n", metadata: metadataPdf(pdf), lineas: lineas.length };
}
