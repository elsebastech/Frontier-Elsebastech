// Lector XML mínimo para las exportaciones planas de Kipu (pqrs.xml, empleados.xml):
// <raiz><item attr="…"><hijo attr="…">texto | <![CDATA[…]]></hijo>…</item>…</raiz>
// También devuelve los comentarios del archivo (pueden traer PII).
import { decodificarEntidades } from "./texto.ts";

export interface NodoXml {
  tag: string;
  attrs: Record<string, string>;
  hijos: { tag: string; attrs: Record<string, string>; texto: string }[];
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = decodificarEntidades(m[2]);
  return out;
}

function textoDe(s: string): string {
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decodificarEntidades(s);
}

export function parsearXmlPlano(xml: string, tagItem: string): { items: NodoXml[]; comentarios: string[] } {
  const comentarios = [...xml.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1]);
  const items: NodoXml[] = [];
  const rx = new RegExp(`<${tagItem}\\b([^>]*)>([\\s\\S]*?)</${tagItem}>`, "g");
  for (const m of xml.matchAll(rx)) {
    const hijos: NodoXml["hijos"] = [];
    for (const h of m[2].matchAll(/<([\w:-]+)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
      hijos.push({ tag: h[1], attrs: attrs(h[2]), texto: textoDe(h[3]) });
    }
    items.push({ tag: tagItem, attrs: attrs(m[1]), hijos });
  }
  return { items, comentarios };
}
