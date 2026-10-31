// HTML → markdown conservando comentarios HTML, enlaces (mailto incluidos) y bloques ocultos.
import { decodificarEntidades } from "./texto.ts";

export function metadataHtml(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const nombre = m[1].match(/\b(?:name|property)\s*=\s*"([^"]*)"/i)?.[1];
    const contenido = m[1].match(/\bcontent\s*=\s*"([^"]*)"/i)?.[1];
    if (nombre && contenido !== undefined) out[nombre] = decodificarEntidades(contenido);
  }
  return out;
}

export function tituloHtml(html: string): string {
  const t = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1];
  return t ? decodificarEntidades(t.trim()) : "";
}

function inline(s: string): string {
  return decodificarEntidades(
    s
      .replace(/<a\b[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, txt) => `[${inline(txt)}](${href})`)
      .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(?!!--)[^>]+>/g, ""),
  ).replace(/[ \t]*\n[ \t]*/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

function tabla(t: string): string {
  const filas = [...t.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
    [...r[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => inline(c[1]).replace(/\|/g, "\\|").replace(/\n/g, " ")),
  );
  if (!filas.length) return "";
  const n = Math.max(...filas.map((f) => f.length));
  const linea = (f: string[]) => "| " + [...f, ...Array(n - f.length).fill("")].join(" | ") + " |";
  return [linea(filas[0]), "|" + " --- |".repeat(n), ...filas.slice(1).map(linea)].join("\n");
}

export function htmlAMarkdown(html: string): string {
  // Comentarios del <head> también se conservan (pueden traer PII): se emiten al inicio.
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? "";
  const comentariosHead = [...head.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
  let body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html.replace(/<head\b[\s\S]*?<\/head>/i, "");
  // comentarios antes de <body>/<html> (fuera de head)
  const antes = html.split(/<body\b/i)[0].replace(/<head\b[\s\S]*?<\/head>/i, "");
  const comentariosFuera = [...antes.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]);
  body = body.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");

  const bloques: string[] = [...comentariosFuera, ...comentariosHead];
  const rx = /<!--[\s\S]*?-->|<table\b[\s\S]*?<\/table>|<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>|<(ul|ol)\b[^>]*>([\s\S]*?)<\/\3>|<(p|div|blockquote|pre|section|article|header|footer)\b[^>]*>([\s\S]*?)<\/\5>/gi;
  let ultimo = 0;
  for (const m of body.matchAll(rx)) {
    const suelto = inline(body.slice(ultimo, m.index));
    if (suelto) bloques.push(suelto);
    ultimo = (m.index ?? 0) + m[0].length;
    const t = m[0];
    if (t.startsWith("<!--")) bloques.push(t);
    else if (/^<table/i.test(t)) bloques.push(tabla(t));
    else if (m[1]) bloques.push("#".repeat(Number(m[1])) + " " + inline(m[2]));
    else if (m[3]) {
      const items = [...m[4].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((li, i) => (m[3].toLowerCase() === "ol" ? `${i + 1}. ` : "- ") + inline(li[1]));
      bloques.push(items.join("\n"));
    } else {
      // div/p anidados: se aplana el contenido (incluye bloques ocultos con display:none)
      const interno = m[6].match(rx) ? htmlAMarkdown(`<body>${m[6]}</body>`).trim() : inline(m[6]);
      if (interno) bloques.push(interno);
    }
  }
  const resto = inline(body.slice(ultimo));
  if (resto) bloques.push(resto);
  return bloques.filter(Boolean).join("\n\n") + "\n";
}
