// Resolutor: a qué fila del maestro corresponde cada uid de Slack.
// NO fusiona personas: asigna apuntadores. Dos uids pueden apuntar a la misma fila solo con prueba
// de que es el mismo humano (misma cédula / mismo correo / mismo número de cliente); si no hay
// prueba, se separa. Regla del diseño: separar de más cuesta menos que fusionar.
import { norm, soloDigitos, palabras } from "../anon/texto.ts";
import type { Persona } from "./personas.ts";

export interface Decision {
  uid: string;
  nombre: string;
  ancla: string | null; // fila del maestro, o null si queda pendiente
  metodo: "numero_de_cliente" | "cedula_dictada" | "correo_corregido" | "correo_literal" | "eliminacion" | "sin_evidencia";
  confianza: "alta" | "media" | "ninguna";
  detalle: string;
}

// Cualquier prefijo de dos letras + número: el maestro hoy usa CL- y PG-, y puede cambiar.
const RX_CL = /\b[A-Z]{2}-\d{3,7}\b/g;
const RX_CC = /(?:\bcc\b|\bc\.c\.|\bcedula\b|\bcédula\b|\bidentificacion\b|\bidentificación\b|\bdocumento\b)[^\d]{0,14}([\d.\s]{7,15})/gi;
const RX_EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Correos escritos como "ana punto perez arroba gmail punto com". */
function desDeletrear(t: string): string {
  return norm(t)
    .replace(/\b(arroba|at)\b/g, "@")
    .replace(/\b(punto|dot)\b/g, ".")
    .replace(/\b(guion bajo|subrayado|underscore)\b/g, "_")
    .replace(/\s*@\s*/g, "@").replace(/\s*\.\s*/g, ".")
    .replace(/\s+/g, " ");
}

export function resolverUids(
  chats: { id: string; text: string; _uid?: string }[],
  clientes: Persona[],
  pendientes: { uid: string; nombre: string; candidatos: string[] }[],
  pqrs: { cliente_id: string; cedula?: string }[] = [],
): { decisiones: Decision[]; uidAPersona: Map<string, Persona>; conflictos: string[] } {
  const porAncla = new Map(clientes.map((p) => [p.ancla, p]));
  const porCedula = new Map<string, Persona>();
  for (const p of clientes) if (p.cedula) porCedula.set(soloDigitos(p.cedula), p);
  // La cédula del PQR apunta a su cliente: sirve de puente cuando el maestro no la tiene
  for (const q of pqrs) {
    const d = soloDigitos(q.cedula ?? "");
    const p = porAncla.get(q.cliente_id);
    if (d && p && !porCedula.has(d)) porCedula.set(d, p);
  }
  const porCorreo = new Map<string, Persona>();
  for (const p of clientes) if (p.correo) porCorreo.set(p.correo.toLowerCase(), p);

  const textos = new Map<string, string[]>();
  for (const c of chats) {
    if (!c._uid) continue;
    const arr = textos.get(c._uid) ?? [];
    arr.push(c.text ?? "");
    textos.set(c._uid, arr);
  }

  const decisiones: Decision[] = [];
  const uidAPersona = new Map<string, Persona>();
  const tomados = new Map<string, string>(); // ancla → uid que la reclamó
  const conflictos: string[] = [];

  const asignar = (uid: string, p: Persona, d: Omit<Decision, "uid" | "ancla">) => {
    const dueño = tomados.get(p.ancla);
    if (dueño && dueño !== uid) {
      conflictos.push(`${uid} y ${dueño} reclaman ${p.ancla} (${d.metodo})`);
      return false;
    }
    tomados.set(p.ancla, uid);
    uidAPersona.set(uid, p);
    return true;
  };

  // 1-3. Evidencia directa en lo que escribió cada uid
  for (const pend of pendientes) {
    const suyos = (textos.get(pend.uid) ?? []).join("\n");
    if (!suyos) continue;

    // 1. número de cliente escrito
    const cl = [...suyos.matchAll(RX_CL)].map((m) => m[0]);
    for (const id of cl) {
      const p = porAncla.get(id);
      if (p && asignar(pend.uid, p, { nombre: pend.nombre, metodo: "numero_de_cliente", confianza: "alta", detalle: id })) {
        decisiones.push({ uid: pend.uid, nombre: pend.nombre, ancla: p.ancla, metodo: "numero_de_cliente", confianza: "alta", detalle: id });
        break;
      }
    }
    if (uidAPersona.has(pend.uid)) continue;

    // 2. cédula dictada
    for (const m of suyos.matchAll(RX_CC)) {
      const d = soloDigitos(m[1]);
      if (d.length < 7 || d.length > 11) continue;
      const p = porCedula.get(d);
      if (p && asignar(pend.uid, p, { nombre: pend.nombre, metodo: "cedula_dictada", confianza: "alta", detalle: "cédula dictada en el chat" })) {
        decisiones.push({ uid: pend.uid, nombre: pend.nombre, ancla: p.ancla, metodo: "cedula_dictada", confianza: "alta", detalle: "cédula dictada en el chat" });
        break;
      }
    }
    if (uidAPersona.has(pend.uid)) continue;

    // 3. correo: literal o corrigiéndolo en el chat
    const correos = new Set<string>();
    for (const m of suyos.matchAll(RX_EMAIL)) correos.add(m[0].toLowerCase());
    for (const m of desDeletrear(suyos).matchAll(RX_EMAIL)) correos.add(m[0].toLowerCase());
    for (const correo of correos) {
      const p = porCorreo.get(correo);
      if (p && asignar(pend.uid, p, { nombre: pend.nombre, metodo: "correo_corregido", confianza: "alta", detalle: "correo del maestro mencionado" })) {
        decisiones.push({ uid: pend.uid, nombre: pend.nombre, ancla: p.ancla, metodo: "correo_corregido", confianza: "alta", detalle: "correo del maestro mencionado" });
        break;
      }
    }
  }

  // 4. Eliminación: los uids que quedan de un nombre se reparten entre las filas que quedan.
  const grupos = new Map<string, { pend: typeof pendientes; candidatos: string[] }>();
  for (const pend of pendientes) {
    if (uidAPersona.has(pend.uid)) continue;
    const clave = norm(pend.nombre).split(" ").slice(0, 2).join(" ");
    const g = grupos.get(clave) ?? { pend: [], candidatos: pend.candidatos };
    g.pend.push(pend);
    grupos.set(clave, g);
  }
  for (const [, g] of grupos) {
    const libres = g.candidatos.filter((a) => !tomados.has(a));
    if (!g.pend.length) continue;
    if (libres.length === g.pend.length && libres.length > 0) {
      const uids = [...g.pend].sort((a, b) => a.uid.localeCompare(b.uid));
      const anclas = [...libres].sort();
      uids.forEach((pend, k) => {
        const p = porAncla.get(anclas[k]);
        if (!p) return;
        if (!asignar(pend.uid, p, { nombre: pend.nombre, metodo: "eliminacion", confianza: "media", detalle: `${uids.length} uids con el mismo nombre, ${libres.length} filas candidatas` })) return;
        decisiones.push({ uid: pend.uid, nombre: pend.nombre, ancla: p.ancla, metodo: "eliminacion", confianza: "media", detalle: `reparto 1 a 1: ${uids.length} uids, ${libres.length} filas` });
      });
    } else {
      for (const pend of g.pend)
        decisiones.push({ uid: pend.uid, nombre: pend.nombre, ancla: null, metodo: "sin_evidencia", confianza: "ninguna", detalle: `${g.pend.length} uids vs ${libres.length} filas libres: no se puede repartir` });
    }
  }

  // 5. Los que no tenían candidatos ni evidencia
  for (const pend of pendientes) {
    if (!decisiones.some((d) => d.uid === pend.uid))
      decisiones.push({ uid: pend.uid, nombre: pend.nombre, ancla: null, metodo: "sin_evidencia", confianza: "ninguna", detalle: `${pend.candidatos.length} candidato(s) en el maestro` });
  }
  return { decisiones, uidAPersona, conflictos };
}

/** Forma con la que hay que dibujar el autor según cuántas palabras traía el original. */
export function formaDeAutor(author: string): "nombre" | "nombre_apellido" | "nombre_completo" {
  const n = palabras(author).length;
  return n >= 3 ? "nombre_completo" : n === 2 ? "nombre_apellido" : "nombre";
}
