// Extracción: lee las fuentes tal cual (carpeta espejo del API) y produce los registros en el
// esquema normalizado de output/ + un inventario de UIDs. No anonimiza nada.
// Los campos que empiezan con "_" son internos (contexto para la resolución) y nunca se emiten.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parsearCsv } from "./texto.ts";
import { parsearXmlPlano } from "./xml.ts";
import { textoPdf } from "./pdf.ts";
import { htmlAMarkdown, metadataHtml, tituloHtml } from "./html.ts";

export interface ChatRecord {
  id: string; thread_id: string; author: string; ts: string; text: string; attachments: { filename: string }[];
  _canal: string; _uid: string; _bot: boolean; _menciones: string[]; _reacciones: string[]; _editor?: string; _archivos: { name: string; title?: string }[];
}
export interface DocRecord {
  id: string; format: "pdf" | "html" | "md"; filename: string; title: string; body: string; metadata: Record<string, string>;
}
export interface TableRecord { id: string; table: string; columns: Record<string, string>; _comentarios?: string[] }
export interface UsuarioSlack {
  id: string; name?: string; real_name?: string; is_bot?: boolean; deleted?: boolean;
  profile?: { real_name?: string; display_name?: string; title?: string; email?: string; phone?: string };
}
export interface InfoUid {
  uid: string; real_name: string; display_name: string; title: string; email: string; phone: string;
  bot: boolean; borrado: boolean; en_users: boolean; apariciones: Record<string, number>;
}
export interface Extraccion {
  chats: ChatRecord[]; docs: DocRecord[]; tables: TableRecord[];
  usuarios: UsuarioSlack[]; canales: any[]; uids: Map<string, InfoUid>; comentariosTablas: Record<string, string[]>;
}

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const RX_MENCION = /<@([A-Z0-9]+)(?:\|[^>]*)?>/g;

function frontMatter(md: string): Record<string, string> {
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out: Record<string, string> = {};
  if (!fm) return out;
  for (const l of fm[1].split(/\r?\n/)) {
    const m = l.match(/^([\w.-]+)\s*:\s?(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["'](.*)["']$/, "$1");
  }
  return out;
}

export function extraer(dir: string): Extraccion {
  // ── Chats ──────────────────────────────────────────────────────────
  const usuarios: UsuarioSlack[] = json(join(dir, "chats/users.json"));
  const canales = json(join(dir, "chats/channels.json"));
  const porUid = new Map(usuarios.map((u) => [u.id, u]));
  const uids = new Map<string, InfoUid>();
  const anotar = (uid: string | undefined | null, donde: string) => {
    if (!uid) return;
    let i = uids.get(uid);
    if (!i) {
      const u = porUid.get(uid);
      i = {
        uid, real_name: u?.real_name || u?.profile?.real_name || "", display_name: u?.profile?.display_name ?? "",
        title: u?.profile?.title ?? "", email: u?.profile?.email ?? "", phone: u?.profile?.phone ?? "",
        bot: !!u?.is_bot, borrado: !!u?.deleted, en_users: !!u, apariciones: {},
      };
      uids.set(uid, i);
    }
    i.apariciones[donde] = (i.apariciones[donde] ?? 0) + 1;
  };
  for (const u of usuarios) anotar(u.id, "users");
  for (const c of canales) {
    anotar(c.creator, "canal_creador");
    for (const m of c.members ?? []) anotar(m, "canal_miembro");
  }

  const chats: ChatRecord[] = [];
  for (const c of canales) {
    const carpeta = join(dir, "chats", c.name);
    if (!existsSync(carpeta)) continue;
    const fechas = readdirSync(carpeta).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of fechas) {
      for (const m of json(join(carpeta, f))) {
        const u = porUid.get(m.user);
        const bot = m.subtype === "bot_message" || !!u?.is_bot;
        const menciones = [...String(m.text ?? "").matchAll(RX_MENCION)].map((x) => x[1]);
        const reacciones: string[] = (m.reactions ?? []).flatMap((r: any) => r.users ?? []);
        anotar(m.user, "autor");
        menciones.forEach((x) => anotar(x, "mencion"));
        reacciones.forEach((x) => anotar(x, "reaccion"));
        anotar(m.edited?.user, "editor");
        anotar(m.parent_user_id, "parent_user");
        chats.push({
          id: m.client_msg_id,
          thread_id: `${c.name}:${m.thread_ts ?? m.ts}`,
          author: u?.real_name || u?.profile?.real_name || m.username || "",
          ts: m.ts,
          text: m.text ?? "",
          attachments: (m.files ?? []).map((x: any) => ({ filename: x.name ?? "" })),
          _canal: c.name, _uid: m.user, _bot: bot, _menciones: menciones, _reacciones: reacciones,
          _editor: m.edited?.user, _archivos: (m.files ?? []).map((x: any) => ({ name: x.name, title: x.title })),
        });
      }
    }
  }

  // ── Docs ───────────────────────────────────────────────────────────
  const docs: DocRecord[] = [];
  for (const d of json(join(dir, "docs/index.json"))) {
    const buf = readFileSync(join(dir, "docs", d.filename));
    if (d.format === "pdf") {
      const { markdown, metadata } = textoPdf(buf);
      const titulo = metadata.title || markdown.match(/^# (.+)$/m)?.[1] || "";
      docs.push({ id: d.id, format: "pdf", filename: d.filename, title: titulo, body: markdown, metadata });
    } else if (d.format === "html") {
      const html = buf.toString("utf8");
      docs.push({ id: d.id, format: "html", filename: d.filename, title: tituloHtml(html), body: htmlAMarkdown(html), metadata: metadataHtml(html) });
    } else {
      const md = buf.toString("utf8");
      const fm = frontMatter(md);
      const titulo = fm.title || md.match(/^# (.+)$/m)?.[1] || "";
      docs.push({ id: d.id, format: "md", filename: d.filename, title: titulo, body: md, metadata: fm });
    }
  }

  // ── Tablas ─────────────────────────────────────────────────────────
  const tables: TableRecord[] = [];
  const comentariosTablas: Record<string, string[]> = {};
  const rutaMeta = join(dir, "tables/_tables.json");
  // Si la fuente no trae _tables.json (la muestra no lo trae), se infiere de los propios archivos.
  const meta = existsSync(rutaMeta)
    ? (json(rutaMeta) as { name: string; format: string; charset: string; separator?: string }[])
    : readdirSync(join(dir, "tables"))
        .filter((f) => /\.(csv|xml)$/i.test(f))
        .map((name) => {
          if (/\.xml$/i.test(name)) return { name, format: "xml", charset: "utf-8" };
          const crudo = readFileSync(join(dir, "tables", name));
          const utf8 = crudo.toString("utf8");
          const latin1 = crudo.toString("latin1");
          const roto = (s: string) => (s.match(/\uFFFD/g) ?? []).length;
          const texto = roto(utf8) > roto(latin1) ? latin1 : utf8;
          const coma = (texto.split("\n")[0].match(/,/g) ?? []).length;
          const puntoYComa = (texto.split("\n")[0].match(/;/g) ?? []).length;
          return { name, format: "csv", charset: texto === latin1 ? "latin-1" : "utf-8", separator: puntoYComa > coma ? ";" : "," };
        });
  for (const t of meta) {
    const buf = readFileSync(join(dir, "tables", t.name));
    const nombre = t.name.replace(/\.\w+$/, "");
    if (t.format === "csv") {
      const texto = buf.toString(/latin|8859/i.test(t.charset) ? "latin1" : "utf8").replace(/^\uFEFF/, "");
      const [cab, ...filas] = parsearCsv(texto, t.separator ?? ",");
      const llave = cab[0];
      for (const f of filas) {
        const columns = Object.fromEntries(cab.map((k, i) => [k, f[i] ?? ""]));
        tables.push({ id: `${nombre}:${columns[llave]}`, table: nombre, columns });
      }
    } else {
      const xml = buf.toString("utf8");
      const tag = nombre === "pqrs" ? "pqr" : nombre === "empleados" ? "empleado" : nombre.replace(/s$/, "");
      const { items, comentarios } = parsearXmlPlano(xml, tag);
      comentariosTablas[nombre] = comentarios;
      const llaveAttr = nombre === "pqrs" ? "radicado" : "id";
      for (const it of items) {
        const columns: Record<string, string> = { ...it.attrs };
        for (const h of it.hijos) {
          columns[h.tag] = h.texto;
          for (const [k, v] of Object.entries(h.attrs)) columns[`${h.tag}_${k}`] = v; // supuesto F7
        }
        tables.push({ id: `${nombre}:${it.attrs[llaveAttr]}`, table: nombre, columns, _comentarios: comentarios });
      }
    }
  }
  return { chats, docs, tables, usuarios, canales, uids, comentariosTablas };
}

/** Quita los campos internos "_…" antes de escribir output/. */
export function publico<T extends object>(r: T): T {
  return Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith("_"))) as T;
}
