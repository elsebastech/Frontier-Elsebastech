// Terceros: personas que solo existen en el texto o en un correo suelto (no están en ninguna tabla).
// Sin ellos, un nombre real en un memo o en una carta se queda intacto (fuga) y además la persona
// no tiene diccionario. Se detectan con reglas y se revisan en `knowledge/terceros.md`.
import { norm, palabras } from "../anon/texto.ts";
import type { Persona } from "./personas.ts";

export interface Candidato { nombre: string; clave: string; origen: string; correo?: string; cedula?: string; contexto: string }

/** Identificadores (cédula) que aparecen en el corpus y no pertenecen a nadie del registro. */
export function cedulasHuerfanas(
  campos: { registro: string; campo: string; texto: string }[],
  conocidas: Set<string>,
): Candidato[] {
  const out = new Map<string, Candidato>();
  const RX_CTX = /(?:\b(?:cc|c\.c\.|cedula|cédula|identificacion|identificación|documento)\b[^\d]{0,14})(\d{2}[.\s]?\d{3}[.\s]?\d{3,4})/gi;
  for (const c of campos) {
    const t = c.texto;
    if (!t) continue;
    const esColumna = /^(cedula|num_doc|documento)$/i.test(c.campo);
    const valores = esColumna ? [t] : [...t.matchAll(RX_CTX)].map((m) => m[1]);
    for (const v of valores) {
      const d = v.replace(/\D/g, "");
      if (d.length < 7 || d.length > 11) continue;
      if (conocidas.has(d)) continue;
      const clave = `doc:${d}`;
      if (!out.has(clave)) out.set(clave, { nombre: "", clave, origen: "cedula_sin_nombre", cedula: d, contexto: `${c.registro}:${c.campo}` });
    }
  }
  return [...out.values()];
}

// Nunca son personas: organizaciones, lugares, marcas, cargos y palabras de plantilla.
const NO_PERSONA = new Set([
  "bancolombia", "nequi", "daviplata", "davivienda", "bbva", "pse", "transfiya", "superfinanciera",
  "superintendencia financiera", "uiaf", "dian", "banco de la republica", "fogafin", "exito", "carulla",
  "jumbo", "olimpica", "d1", "ara", "rappi", "uber", "didi", "kipu pay", "kipi", "andes capital",
  "medellin", "bogota", "cali", "barranquilla", "cartagena", "bucaramanga", "pereira", "manizales",
  "colombia", "mexico", "miami", "panama", "chile", "peru", "ecuador", "estados unidos",
  "lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
  "noviembre", "diciembre", "hola", "buenas", "buenos dias", "buenas tardes", "buenas noches",
  "resumen", "nota", "asunto", "atentamente", "cordialmente", "estimado", "estimada", "senor", "senora",
  "cliente", "clienta", "usuario", "agente", "equipo", "soporte", "gerencia", "junta directiva",
  "junta", "directiva", "talento humano", "riesgo", "cobranza", "finanzas", "operaciones",
  "banco", "bancos", "whatsapp", "gmail", "hotmail", "outlook", "yahoo", "icloud", "app", "pdf", "html",
  "information security", "security", "compliance", "todo", "nada", "gracias", "listo", "ok", "okay", "si", "no", "favor", "urgente", "importante",
]);

// Palabras que se capitalizan por ser sustantivo, no nombre propio.
const COMUNES = new Set([
  "legal", "civil", "penal", "laboral", "tributario", "datos", "personales", "politica", "tratamiento",
  "cliente", "clienta", "clientes", "codigo", "sistema", "informe", "comite", "credito", "fraude", "riesgo",
  "cobranza", "operaciones", "soporte", "producto", "ingenieria", "marketing", "talento", "humano",
  "junta", "directiva", "gerencia", "area", "areas", "equipo", "equipos", "proceso", "procesos",
  "protocolo", "manual", "guia", "acta", "actas", "minuta", "politicas", "reglamento", "contrato",
  "convenio", "carta", "cobro", "juridico", "mora", "paz", "salvo", "acuerdo", "pago", "pagos",
  "cuenta", "cuentas", "tarjeta", "tarjetas", "banco", "bancos", "creditos", "nomina", "reporte",
  "informes", "auditoria", "seguridad", "calidad", "calibracion", "onboarding", "incidente", "incidentes",
  "evaluacion", "desempeno", "cierre", "cierre", "resumen", "casos", "revisar", "nota", "notas",
  "contacto", "asesor", "asesora", "analista", "coordinador", "coordinadora", "gerente", "director",
  "directora", "lider", "agente", "abogado", "abogada", "contador", "contadora", "ingeniero", "ingeniera",
  "de", "del", "la", "las", "los", "el", "y", "en", "con", "por", "para", "sin", "sobre",
]);

const NOMBRE_PROPIO = /\p{Lu}[\p{L}'’-]+(?:\s+(?:de|del|la|las|los|y)?\s*\p{Lu}[\p{L}'’-]+){0,3}/gu;
const CUE = /(?:preparado por|elaborad[oa] por|redactad[oa] por|firmad[oa] por|reportad[oa] por|revisad[oa] por|auditor[ai]|a nombre de|señor[ai]?|senor[ai]?|soy|te atiende|le atiende|habla|atentamente|asistentes|autor[ai]?|owner|contacto|prepared by|written by|signed by|reported by|reviewed by|submitted by|dear|mr\.?|mrs\.?|ms\.?|miss|my name is|this is|regards|kind regards|sincerely|attn|contact person)\s*:?\s*@?$/i;
const CAMPOS_PERSONA = /^(author|autor|autora|auditora|reportado_por|revisado_por|owner|asistentes|contacto|firmante|grabacion)$/i;

/** Correo sin dueño → persona: "kelly.castano@x" → "Kelly Castaño". */
export function deCorreo(correo: string): string | null {
  const local = correo.split("@")[0] ?? "";
  if (!/^[a-z][a-z._-]{2,30}$/i.test(local)) return null;
  const partes = local.split(/[._-]+/).filter((x) => x.length >= 2 && /^[a-z]+$/i.test(x));
  if (partes.length < 2 || partes.length > 3) return null;
  return partes.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
}

export function buscarCandidatos(
  campos: { registro: string; campo: string; texto: string }[],
  yaConocidas: Set<string>,
  yaConocidosCorreos: Set<string>,
): Candidato[] {
  const cand = new Map<string, Candidato>();
  const meter = (c: Candidato) => {
    const k = c.clave;
    if (!cand.has(k)) cand.set(k, c);
  };
  for (const c of campos) {
    const t = c.texto;
    if (!t) continue;
    // 1. Correos sin dueño con forma de nombre.apellido
    for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const correo = m[0].toLowerCase();
      if (yaConocidosCorreos.has(correo)) continue;
      if (!/\.(com|co|net|org|edu|gov|info|io|es)$/.test(correo)) continue;
      const nombre = deCorreo(correo);
      if (nombre) {
        const clave = norm(nombre);
        if (yaConocidas.has(clave) || NO_PERSONA.has(clave)) continue;
        meter({ nombre, clave, origen: "correo", correo, contexto: `${c.registro}:${c.campo}` });
      } else {
        // Correo de alguien cuyo nombre no conocemos (kmarulanda@…): igual es una persona y hay
        // que darle seudónimo; solo se dibuja el correo, no un nombre que nunca aparece.
        const clave = `correo:${correo}`;
        meter({ nombre: "", clave, origen: "correo_sin_nombre", correo, contexto: `${c.registro}:${c.campo}` });
      }
    }
    // 2. Secuencias de nombre propio con pista de contexto
    if (!/\p{Lu}/u.test(t)) continue;
    for (const m of t.matchAll(NOMBRE_PROPIO)) {
      const bruto = m[0].trim();
      const ws = palabras(bruto);
      if (ws.length < 2 || ws.length > 4) continue;
      if (ws.some((w) => w.length < 3)) continue;
      if (ws.some((w) => COMUNES.has(w))) continue;
      const clave = ws.join(" ");
      if (yaConocidas.has(clave) || NO_PERSONA.has(clave)) continue;
      if ([...NO_PERSONA].some((k) => clave === k || clave.startsWith(k + " ") && k.length > 6)) continue;
      const antes = t.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
      const ultima = antes.trim().split(/[.;\n]/).pop() ?? "";
      const conPista = CUE.test(antes.replace(/[\s@]+$/, " ") + " ") || CUE.test(ultima) || /@\s*$/.test(antes);
      const campoPersona = CAMPOS_PERSONA.test(c.campo);
      if (!conPista && !campoPersona) continue;
      meter({ nombre: bruto.replace(/\s+/g, " "), clave, origen: conPista ? "texto" : "campo", contexto: `${c.registro}:${c.campo}` });
    }
  }
  return [...cand.values()];
}

export function aPersona(c: Candidato, id: string, genero: (nombres: string[]) => "f" | "m" | "?"): Persona {
  const partes = c.nombre.split(" ").filter(Boolean);
  const nombres = partes.length === 0 ? [] : partes.length > 2 ? partes.slice(0, 2) : partes.slice(0, 1);
  const apellidos = partes.slice(nombres.length);
  return {
    id, tipo: "tercero", ancla: c.nombre ? `texto:${c.clave}` : c.correo ? `correo:${c.correo}` : c.clave, nombre: c.nombre,
    nombres, apellidos, genero: genero(nombres), correo: c.correo, cedula: c.cedula, liga: `tercero_${c.origen}`,
    notas: c.contexto,
  };
}
