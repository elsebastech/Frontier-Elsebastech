// Identidades falsas: una por persona, fijas entre corridas, deterministas desde el ancla.
// Reglas (de la muestra): mismo género en el nombre, formato válido, lejos del original,
// pools sin ninguna forma real del corpus (si no, el barrido global cuenta fuga de otra persona).
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { contiene, norm, soloDigitos } from "./texto.ts";
import type { Persona } from "../registro/personas.ts";

export interface Identidad {
  /** Ancla con la que se creó: es la llave estable entre corridas. */
  ancla: string;
  entity_id: string;
  tipo: string;
  nombre_completo: string;
  nombre_apellido: string;
  nombre: string;
  correo: string;
  celular: string;
  cedula: string;
  direccion: string;
  nacimiento: string;
  placa: string;
  uid: string;
  handle: string;
  filename_token: string;
}

const NOMBRES_F = ["Marcela", "Doris", "Sofía Elena", "Norma", "Liliana", "Camila", "Valentina", "Paula Andrea",
  "Mónica", "Adriana", "Gloria", "Teresa", "Lorena", "Catalina", "Natalia", "Carolina", "Verónica", "Patricia",
  "Silvia", "Ángela", "Martha", "Claudia", "Sandra Milena", "Yolanda", "Elena", "Rosa", "Irene", "Lucía",
  "Beatriz", "Alicia", "Victoria", "Gabriela", "Isabela", "Manuela", "Salomé", "Renata", "Emilia", "Antonia",
  "Josefina", "Amalia", "Inés", "Mercedes", "Cecilia", "Alejandra"];
const NOMBRES_M = ["Hugo", "Andrés", "Carlos", "Jorge", "Mauricio", "Felipe", "Ricardo", "Alberto", "Óscar",
  "Germán", "Iván", "Rubén", "Emilio", "Tomás", "Santiago", "Nicolás", "Sebastián", "Cristóbal", "Mateo",
  "Simón", "Julián", "Rodrigo", "Alfonso", "Gustavo", "Hernán", "Leonardo", "Pablo", "Rafael", "Eduardo",
  "Armando", "Ernesto", "Víctor", "Camilo", "Esteban", "Federico", "Ignacio", "Joaquín", "Lorenzo", "Marcos",
  "Néstor", "Orlando", "Ramiro", "Saúl", "Wilmer"];
const APELLIDOS = ["Zambrano", "Pardo", "Lozano", "Pineda", "Cano", "Restrepo", "Arroyave", "Betancur",
  "Cardona", "Cifuentes", "Duarte", "Escobar", "Franco", "Galindo", "Guzmán", "Henao", "Isaza", "Jaramillo",
  "Londoño", "Madrigal", "Naranjo", "Ocampo", "Palacio", "Quintero", "Ramírez", "Salcedo", "Tobón", "Urrea",
  "Valencia", "Zapata", "Bermúdez", "Correa", "Díaz", "Echeverri", "Fajardo", "Giraldo", "Hoyos", "Mejía",
  "Montoya", "Ospina", "Patiño", "Robledo", "Sánchez", "Torres", "Vélez", "Zuluaga", "Álvarez", "Bedoya",
  "Castaño", "Domínguez", "Espinal", "Fonnegra", "Gómez", "Hurtado", "López", "Molina", "Navarro", "Osorio",
  "Peláez", "Rojas"];
const PROVEEDORES = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com"];
const VIAS = ["Calle", "Carrera", "Diagonal", "Transversal", "Avenida", "Cra", "Cl", "Av"];

const hmac = (sal: string, clave: string): Buffer => createHmac("sha256", sal).update(clave).digest();
const num = (b: Buffer, i: number, mod: number) => b[i % b.length] % mod;
const elegir = <T,>(arr: T[], b: Buffer, i: number): T => arr[num(b, i, arr.length)];

function saludo(nombre: string): string {
  return nombre.split(" ")[0];
}
function sinTildes(s: string): string {
  return s.normalize("NFD").replace(/\p{Mn}/gu, "");
}

export interface OpcionesIdentidad {
  sal: string;
  /** Todas las formas reales del corpus: ningún seudónimo puede contenerlas. */
  prohibidas: string[];
  /** Valores que ya usa otra persona: dos humanos nunca comparten seudónimo. */
  usados?: Set<string>;
}

/** ¿El valor choca con alguna forma real? Se compara como el juez (contiene). */
function choca(valor: string, prohibidas: string[]): boolean {
  if (valor.length < 4) return false;
  for (const p of prohibidas) if (p.length >= 4 && contiene(valor, p)) return true;
  return false;
}

export function generarIdentidad(p: Persona, o: OpcionesIdentidad): Identidad {
  const b = hmac(o.sal, p.ancla);
  const fem = p.genero === "f";
  const poolN = fem ? NOMBRES_F : NOMBRES_M;
  const usado = (v: string) => o.usados?.has(v.toLowerCase()) ?? false;
  for (let intento = 0; intento < 60; intento++) {
    const semilla = hmac(o.sal, `${p.ancla}#${intento}`);
    const nombre = elegir(poolN, semilla, 0);
    const a1 = elegir(APELLIDOS, semilla, 5);
    const a2 = elegir(APELLIDOS, semilla, 9);
    if (a1 === a2) continue;
    const completo = `${nombre} ${a1} ${a2}`;
    if (choca(completo, o.prohibidas)) continue;
    const nombreApellido = `${nombre} ${a1}`;
    const inicial = sinTildes(saludo(nombre)).charAt(0).toLowerCase();
    const apellido = sinTildes(a1).toLowerCase();
    const proveedor = p.correo?.split("@")[1]?.toLowerCase() ?? elegir(PROVEEDORES, semilla, 13);
    const esCorporativo = !!p.correo && !PROVEEDORES.includes(proveedor);
    const correo = esCorporativo
      ? `${sinTildes(saludo(nombre)).toLowerCase()}.${apellido}@${proveedor}`
      : `${inicial}${apellido}@${PROVEEDORES.includes(proveedor) ? proveedor : "gmail.com"}`;
    // Cédula: mismo largo, formato válido, prefijo de región y dígitos distintos.
    const digitosCed = (p.cedula ?? "").replace(/\D/g, "");
    const largoCed = digitosCed.length || 8;
    let cedula = "";
    const original = digitosCed;
    for (let intentoCed = 0; intentoCed < 40; intentoCed++) {
      const s2 = hmac(o.sal, `${p.ancla}#cedula${intentoCed}`);
      let d = "";
      for (let i = 0; i < largoCed; i++) d += String(num(s2, i, 10));
      if (d[0] === "0") d = "1" + d.slice(1);
      // lejos del original: al menos 3 posiciones distintas y ningún prefijo de 4 dígitos igual
      let dif = 0;
      for (let i = 0; i < Math.min(d.length, original.length); i++) if (d[i] !== original[i]) dif++;
      if (dif >= 3 || original === "") { cedula = d; break; }
    }
    const celular = `3${String(num(semilla, 1, 10))}${Array.from({ length: 8 }, (_, i) => String(num(semilla, 20 + i, 10))).join("")}`;
    const via = elegir(VIAS, semilla, 30);
    const dir = `${via} ${1 + num(semilla, 31, 180)}${num(semilla, 32, 2) ? " Bis" : ""} # ${10 + num(semilla, 33, 90)}-${1 + num(semilla, 34, 98)}${num(semilla, 35, 2) ? ` apto ${101 + num(semilla, 36, 899)}` : ""}`;
    let anio = 1970 + num(semilla, 37, 35);
    const nac = `${anio}-${String(1 + num(semilla, 38, 12)).padStart(2, "0")}-${String(1 + num(semilla, 39, 28)).padStart(2, "0")}`;
    const placa = `${String.fromCharCode(65 + num(semilla, 40, 26), 65 + num(semilla, 41, 26), 65 + num(semilla, 42, 26))}${Array.from({ length: 3 }, (_, i) => String(num(semilla, 43 + i, 10))).join("")}`;
    const uid = `U0${Array.from({ length: 8 }, (_, i) => "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[num(semilla, 50 + i, 34)]).join("")}`;
    const ident: Identidad = {
      ancla: p.ancla, entity_id: p.id, tipo: p.tipo, nombre_completo: completo, nombre_apellido: nombreApellido,
      nombre, correo, celular, cedula, direccion: dir, nacimiento: nac, placa, uid,
      handle: sinTildes(nombre).toLowerCase().replace(/\s+/g, ".") + `.${apellido}`,
      filename_token: `${sinTildes(nombre).toLowerCase().replace(/\s+/g, "_")}_${apellido}`,
    };
    if (choca(ident.nombre, o.prohibidas) || choca(ident.correo, o.prohibidas)) continue;
    // Una fecha falsa que coincide con la fecha real de otra persona es fuga para el barrido del juez.
    if (choca(ident.nacimiento, o.prohibidas) || choca(ident.direccion, o.prohibidas)) continue;
    if (usado(ident.nombre_completo) || usado(ident.correo) || usado(ident.cedula) || usado(ident.celular)
      || usado(ident.nombre_apellido) || usado(ident.nacimiento) || usado(ident.direccion) || usado(ident.placa)) continue;
    return ident;
  }
  // Fallback determinista (no debería ocurrir): nombre + sufijo.
  const b2 = hmac(o.sal, p.ancla);
  const base = `${elegir(poolN, b2, 0)} ${elegir(APELLIDOS, b2, 5)} ${elegir(APELLIDOS, b2, 9)}`;
  return {
    ancla: p.ancla, entity_id: p.id, tipo: p.tipo, nombre_completo: base, nombre_apellido: `${elegir(poolN, b2, 0)} ${elegir(APELLIDOS, b2, 5)}`,
    nombre: elegir(poolN, b2, 0), correo: `x${p.id.toLowerCase()}@gmail.com`, celular: "3000000000",
    cedula: p.cedula ?? "10000000", direccion: "Calle 1 # 1-1", nacimiento: "1980-01-01",
    placa: "AAA000", uid: `U0${p.id}`, handle: `x.${p.id.toLowerCase()}`, filename_token: `x_${p.id.toLowerCase()}`,
  };
}

export function cargarIdentidades(ruta = `${process.env.REGISTRO ?? "registro"}/identidades.json`): Map<string, Identidad> {
  if (!existsSync(ruta)) return new Map();
  const j = JSON.parse(readFileSync(ruta, "utf8")) as { identidades: Identidad[] };
  const lista = j.identidades ?? [];
  // Migración: archivos viejos no traen `ancla`; se recupera desde personas.json por entity_id.
  let porId: Map<string, string> | null = null;
  if (lista.some((i) => !i.ancla)) {
    const rutaPersonas = ruta.replace(/identidades\.json$/, "personas.json");
    if (existsSync(rutaPersonas)) {
      const rp = JSON.parse(readFileSync(rutaPersonas, "utf8")) as { personas: { id: string; ancla: string }[] };
      porId = new Map((rp.personas ?? []).map((p) => [p.id, p.ancla]));
    }
  }
  const m = new Map<string, Identidad>();
  for (const i of lista) {
    const ancla = i.ancla ?? porId?.get(i.entity_id) ?? `id:${i.entity_id}`;
    m.set(ancla, { ...i, ancla });
  }
  return m;
}

export function guardarIdentidades(m: Map<string, Identidad>, ruta = `${process.env.REGISTRO ?? "registro"}/identidades.json`): void {
  mkdirSync(ruta.replace(/\/[^/]+$/, ""), { recursive: true });
  writeFileSync(ruta, JSON.stringify({ generado: new Date().toISOString(), identidades: [...m.values()] }, null, 1));
}
