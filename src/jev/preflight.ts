// Preflight con Jev: ¿este conjunto de datos puede aplicarse al anonimizador?
//
// Se le manda SOLO la forma de los datos —nombres de tabla y columna, conteos, formatos y el
// "tipo" de cada columna (dígitos, correo, fecha, texto…), nunca un valor. Con eso decide si el
// anonimizador aplica, y el servicio corre solo cuando la respuesta es compatible.
//
// Tres preguntas cerradas, en un solo request:
//   aplicable        choice: si | con_riesgo | no
//   nombres          noul:  hay fuente estructurada con nombres de personas
//   identificadores  noul:  cada persona tiene un identificador estable
//   texto_extraible  noul:  los documentos son texto, no imágenes escaneadas
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { firmaDesdeFilas, derivaDeEsquema, type Firma } from "../vigilante/esquema.ts";
import { clasificarCadenas, decidir, type PreguntaChoice } from "./cliente.ts";

export interface FormaColumna {
  nombre: string;
  tipo: string; // digitos | correo | fecha | url | texto_corto | texto_largo | vacio
  unicos: number;
  vacios: number;
}

export interface FormaFuente {
  registros: number;
  detalle?: Record<string, number>;
  columnas?: FormaColumna[];
}

export interface FormaConjunto {
  fuentes: Record<string, FormaFuente>;
  tablas: string[];
  columnas_por_tabla: Record<string, string[]>;
  formatos_documento: Record<string, number>;
  indice_registros: boolean;
  llave_de_tabla: string;
  /** Cuántos autores distintos del chat parecen nombre de persona (2-3 palabras capitalizadas). */
  difusion?: { autores: number; autores_con_nombre: number };
}

const RX_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RX_FECHA = /^\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4}$/;
const RX_DIGITOS = /^[\d.\s-]{6,}$/;
const RX_URL = /^https?:\/\//i;

/** Deduce el tipo de una columna sin exportar ningún valor. */
function tipoDe(valores: string[]): string {
  const vivos = valores.filter((v) => v && v.trim());
  if (!vivos.length) return "vacio";
  const cuenta = (rx: RegExp) => vivos.filter((v) => rx.test(v.trim())).length;
  if (cuenta(RX_CORREO) >= vivos.length * 0.8) return "correo";
  if (cuenta(RX_FECHA) >= vivos.length * 0.8) return "fecha";
  if (cuenta(RX_URL) >= vivos.length * 0.8) return "url";
  if (cuenta(RX_DIGITOS) >= vivos.length * 0.8) return "digitos";
  const medio = vivos.reduce((s, v) => s + v.length, 0) / vivos.length;
  return medio > 60 ? "texto_largo" : "texto_corto";
}

export function formaDelConjunto(dirDatos = "data"): FormaConjunto {
  const leer = (f: string) => {
    const p = `${dirDatos}/extraccion/${f}.jsonl`;
    return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  const chats = leer("chats");
  const docs = leer("docs");
  const tablas = leer("tables");

  const porTabla: Record<string, any[]> = {};
  for (const t of tablas) (porTabla[t.table] ??= []).push(t);

  const columnas: Record<string, string[]> = {};
  const detalleTablas: Record<string, FormaFuente> = {};
  for (const [nombre, filas] of Object.entries(porTabla)) {
    const claves = Object.keys(filas[0]?.columns ?? {});
    columnas[nombre] = claves;
    detalleTablas[nombre] = {
      registros: filas.length,
      columnas: claves.map((k) => {
        // Se miran 200 valores como máximo: suficiente para el tipo, barato.
        const muestra = filas.slice(0, 200).map((f) => String(f.columns?.[k] ?? ""));
        return {
          nombre: k,
          tipo: tipoDe(muestra),
          unicos: new Set(muestra.filter(Boolean)).size,
          vacios: muestra.filter((v) => !v.trim()).length,
        };
      }),
    };
  }

  const formatos: Record<string, number> = {};
  for (const d of docs) formatos[d.format] = (formatos[d.format] ?? 0) + 1;

  return {
    fuentes: {
      chats: { registros: chats.length, detalle: { canales: new Set(chats.map((c) => c._canal)).size,
        adjuntos: chats.reduce((s, c) => s + (c.attachments?.length ?? 0), 0) } },
      docs: { registros: docs.length, detalle: formatos },
      ...detalleTablas,
    },
    tablas: Object.keys(porTabla),
    columnas_por_tabla: columnas,
    formatos_documento: formatos,
    indice_registros: [
      "fuentes/record_index.json",
      `${dirDatos}/record_index.json`,
      `${dirDatos}/../fuentes/record_index.json`,
      `${process.env.FUENTES_DIR ?? "fuentes"}/record_index.json`,
    ].some((r) => existsSync(r)),
    llave_de_tabla: "primera columna del archivo",
    difusion: (() => {
      const autores = [...new Set(chats.map((c) => String(c.author ?? "").trim()).filter(Boolean))];
      const conNombre = autores.filter((a) => /^\p{Lu}[\p{L}'’-]+(\s+\p{Lu}[\p{L}'’-]+){1,2}$/u.test(a)).length;
      return { autores: autores.length, autores_con_nombre: conNombre };
    })(),
  };
}

export interface Requisitos {
  tabla_con_nombres: boolean;
  identificador_unico: boolean;
  texto_extraible: boolean;
  indice_registros: boolean;
  autores_con_nombre: boolean;
  /** Columnas nuevas o desaparecidas respecto a la última corrida aceptada. */
  deriva_columnas?: string[];
}

export interface Veredicto {
  aplicable: "si" | "con_riesgo" | "no";
  origen: "reglas" | "jev";
  probabilidad: number;
  requisitos: Requisitos;
  faltantes: string[];
  motivos: string[];
  modelo?: string;
  de_cache?: boolean;
}

const RX_NOMBRE_COL = /(nombre|name|apellido|surname)/i;
const RX_NO_NOMBRE = /(empresa|company|producto|product|archivo|file|banco|bank|ciudad|city)/i;

/** Chequeos deterministas sobre la forma: lo que el código puede decidir, no se le pregunta al modelo. */
export function evaluarRequisitos(forma: FormaConjunto): Requisitos {
  let tablaConNombres = false;
  let identificadorUnico = false;
  for (const t of forma.tablas) {
    const cols = forma.fuentes[t]?.columnas ?? [];
    const filas = forma.fuentes[t]?.registros ?? 0;
    if (!filas) continue;
    if (cols.some((c) => RX_NOMBRE_COL.test(c.nombre) && !RX_NO_NOMBRE.test(c.nombre) && c.tipo === "texto_corto")) tablaConNombres = true;
    if (cols.some((c) => c.unicos >= filas * 0.9 && (c.tipo === "digitos" || c.tipo === "correo" || c.tipo === "texto_corto"))) identificadorUnico = true;
  }
  const docs = forma.fuentes.docs?.registros ?? 0;
  const formatosTexto = (forma.formatos_documento.md ?? 0) + (forma.formatos_documento.html ?? 0);
  const textoDocs = docs === 0 ? false : formatosTexto >= docs * 0.5;
  const dif = forma.difusion ?? { autores_con_nombre: 0, autores: 0 };
  const autoresConNombre = dif.autores > 0 ? dif.autores_con_nombre / dif.autores >= 0.4 : false;
  return {
    tabla_con_nombres: tablaConNombres,
    identificador_unico: identificadorUnico,
    texto_extraible: textoDocs || autoresConNombre,
    indice_registros: forma.indice_registros,
    autores_con_nombre: autoresConNombre,
  };
}

/**
 * Veredicto: primero las reglas (si falta algo indispensable, se dice sin llamar a nadie);
 * solo cuando las reglas no alcanzan se pregunta a Jev, mandándole la forma y los requisitos.
 */
const FIRMA_COLUMNAS = "registro/firma-columnas.json";

/** Compara las columnas de esta corrida con la última aceptada. Columnas nuevas pueden traer PII nueva. */
export function derivaDeColumnas(forma: FormaConjunto): string[] {
  const actual: Firma = Object.fromEntries(forma.tablas.map((t) => [t, [...(forma.columnas_por_tabla[t] ?? [])].sort()]));
  let previa: Firma | null = null;
  try { if (existsSync(FIRMA_COLUMNAS)) previa = JSON.parse(readFileSync(FIRMA_COLUMNAS, "utf8")); } catch { previa = null; }
  if (!previa) return [];
  return derivaDeEsquema(actual, previa).filter((d) => !d.startsWith("sin firma previa"));
}

export function guardarFirmaColumnas(forma: FormaConjunto): void {
  const actual = Object.fromEntries(forma.tablas.map((t) => [t, [...(forma.columnas_por_tabla[t] ?? [])].sort()]));
  mkdirSync("registro", { recursive: true });
  writeFileSync(FIRMA_COLUMNAS, JSON.stringify(actual, null, 1));
}

export async function preflight(
  forma: FormaConjunto,
  opciones: { umbral?: number; usarJev?: boolean } = {},
): Promise<Veredicto> {
  const umbral = opciones.umbral ?? 0.85;
  const requisitos = evaluarRequisitos(forma);
  requisitos.deriva_columnas = derivaDeColumnas(forma);
  const faltantes: string[] = [];
  if (!requisitos.tabla_con_nombres && !requisitos.autores_con_nombre) faltantes.push("no hay nombres de personas en ninguna fuente");
  if (!requisitos.identificador_unico) faltantes.push("ninguna tabla tiene un identificador único por fila");
  if (!requisitos.texto_extraible) faltantes.push("no hay texto que anonimizar (conversaciones vacías y documentos sin capa de texto)");

  if (faltantes.length) {
    return { aplicable: "no", origen: "reglas", probabilidad: 1, requisitos, faltantes,
      motivos: ["reglas: " + faltantes.join("; ")] };
  }
  if (opciones.usarJev === false) {
    return { aplicable: "si", origen: "reglas", probabilidad: 1, requisitos, faltantes: [],
      motivos: ["reglas: los cuatro requisitos se cumplen"] };
  }

  const preguntas: Record<string, PreguntaChoice> = {
    aplicable: {
      type: "choice",
      instructions:
        "El anonimizador reemplaza datos personales en conversaciones, documentos y tablas, y necesita " +
        "nombres de personas, un identificador estable por persona y texto. En `forma` está la forma del " +
        "conjunto (tablas, columnas, tipos de dato, conteos) y en `requisitos` lo que las reglas ya comprobaron. " +
        "Decide si el proceso se puede aplicar completo a este conjunto.",
      criteria: {
        si: "Se puede anonimizar el conjunto completo: hay nombres, identificador estable por persona y texto con datos personales",
        no: "No se puede: falta alguno de los tres, o las columnas de datos personales no se reconocen",
      },
    },
  };

  // Estado compacto: el modelo decide mejor con lo esencial que con todos los conteos.
  const compacta = {
    tablas: Object.fromEntries(forma.tablas.map((t) => [t, {
      filas: forma.fuentes[t]?.registros ?? 0,
      columnas: (forma.fuentes[t]?.columnas ?? []).map((c) => `${c.nombre}:${c.tipo}`),
    }])),
    documentos: { total: forma.fuentes.docs?.registros ?? 0, formatos: forma.formatos_documento },
    conversaciones: { mensajes: forma.fuentes.chats?.registros ?? 0, autores_con_nombre: forma.difusion?.autores_con_nombre ?? 0 },
    indice_de_registros: forma.indice_registros,
  };
  const resp = await decidir({ forma: compacta, requisitos }, preguntas);
  if (!resp) {
    return { aplicable: "con_riesgo", origen: "reglas", probabilidad: 1, requisitos, faltantes: [],
      motivos: ["Jev no disponible: las reglas dan los cuatro requisitos por cumplidos"] };
  }
  const a = resp.respuestas.aplicable;
  const prob = a?.probabilities?.[a.choice] ?? a?.confidence ?? 0;
  const motivos = [`Jev: ${a?.choice} (p=${prob.toFixed(3)})`];
  for (const [k, v] of Object.entries(requisitos)) motivos.push(`${k}: ${v ? "si" : "no"}`);
  // Las reglas ya probaron lo indispensable, así que el listón del modelo baja: acompaña con 0,5.
  // El modelo solo veta cuando contradice a las reglas con fuerza.
  const pSi = a?.choice === "si" ? prob : 1 - prob;
  const corte = 0.5;
  const aplicable: "si" | "con_riesgo" | "no" = pSi >= corte ? "si" : "con_riesgo";
  if (aplicable === "si") motivos.push(`Jev acompaña (p(si)=${pSi.toFixed(2)}; reglas completas)`);
  else motivos.push(`Jev no acompaña (p(si)=${pSi.toFixed(2)}): se corre con aviso`);
  if (!requisitos.indice_registros) motivos.push("aviso: no se encontró el índice de registros; el conjunto puede estar incompleto");
  for (const d of requisitos.deriva_columnas ?? []) motivos.push(`esquema: ${d} (revisar si trae datos personales)`);
  return { aplicable, origen: "jev", probabilidad: Number(prob.toFixed(3)), requisitos, faltantes: [], motivos,
    modelo: resp.modelo, de_cache: resp.de_cache };
}
