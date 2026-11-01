// Reconciliación con el registro anterior: el registro solo crece y una persona nunca cambia de ID.
// Cuando llegan fuentes nuevas, la misma persona puede venir con otra fila (otro cliente_id) o con
// el mismo nombre que otra: se reconoce por evidencia (ancla, cédula, correo, nombre completo único)
// y se reutiliza su ID y su ancla original, para que su seudónimo no cambie.
import { norm, soloDigitos } from "../anon/texto.ts";
import type { Persona } from "./personas.ts";

export interface Reconciliacion {
  personas: Persona[];
  reutilizadas: number;
  nuevas: number;
  retiradas: number;
  detalle: { id: string; ancla: string; anclaNueva?: string; por: string }[];
  renumeradas: number;
  fusionadas_previas: number;
}

const contar = (xs: string[]) => xs.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<string, number>());

/**
 * Dos filas del maestro con la misma cédula Y el mismo contacto (correo o celular) son el mismo
 * humano con dos ids. Se colapsan conservando el id/ancla más antiguo, porque su seudónimo es el
 * que ya salió en corridas anteriores. Sin esa coincidencia de contacto no se toca nada.
 */
function deduplicarPrevias(entrada: Persona[]): { personas: Persona[]; fusionadas: number } {
  const porCedula = new Map<string, Persona>();
  const salida: Persona[] = [];
  let fusionadas = 0;
  for (const p of entrada) {
    const d = p.cedula ? soloDigitos(p.cedula) : "";
    if (!d) { salida.push(p); continue; }
    const previa = porCedula.get(d);
    if (!previa) { porCedula.set(d, p); salida.push(p); continue; }
    const mismoContacto =
      (!!p.correo && !!previa.correo && p.correo.toLowerCase() === previa.correo.toLowerCase()) ||
      (!!p.celular && !!previa.celular && soloDigitos(p.celular) === soloDigitos(previa.celular));
    if (!mismoContacto) { salida.push(p); continue; } // cédula compartida sin contacto: no se fusiona
    // Se queda la persona con el id más bajo (la más antigua) y absorbe las anclas de la otra.
    const vieja = Number(String(previa.id).replace(/\D/g, "")) <= Number(String(p.id).replace(/\D/g, "")) ? previa : p;
    const nueva = vieja === previa ? p : previa;
    vieja.anclas = [...new Set([...(vieja.anclas ?? [vieja.ancla]), ...(nueva.anclas ?? [nueva.ancla])])];
    vieja.uids = [...new Set([...(vieja.uids ?? []), ...(nueva.uids ?? [])])];
    if (!vieja.cedula) vieja.cedula = nueva.cedula;
    if (!vieja.correo) vieja.correo = nueva.correo;
    if (!vieja.celular) vieja.celular = nueva.celular;
    if (vieja !== previa) { // la nueva pasó a ser la canónica: reemplaza a la anterior en la salida
      const i = salida.indexOf(previa);
      if (i >= 0) salida[i] = vieja;
      porCedula.set(d, vieja);
    }
    fusionadas++;
  }
  return { personas: salida, fusionadas };
}

export function reconciliar(entradaPrevia: Persona[], frescas: Persona[]): Reconciliacion {
  const { personas: previas, fusionadas: fusionadasPrevias } = deduplicarPrevias(entradaPrevia);
  // Solo se acepta una clave si identifica a UNA persona previa (evita fusionar homónimos).
  const contarPrevio = (clave: (p: Persona) => string | undefined) =>
    contar(previas.map(clave).filter((k): k is string => !!k));
  const nAncla = contarPrevio((p) => p.ancla);
  const nCed = contarPrevio((p) => (p.cedula ? soloDigitos(p.cedula) : undefined));
  const nCorreo = contarPrevio((p) => p.correo?.toLowerCase());
  const nNombre = contarPrevio((p) => norm(p.nombre));

  const porAncla = new Map(previas.map((p) => [p.ancla, p]));
  const porCed = new Map<string, Persona>();
  const porCorreo = new Map<string, Persona>();
  const porNombre = new Map<string, Persona>();
  for (const p of previas) {
    const c = p.cedula ? soloDigitos(p.cedula) : "";
    if (c && nCed.get(c) === 1) porCed.set(c, p);
    const e = p.correo?.toLowerCase() ?? "";
    if (e && nCorreo.get(e) === 1) porCorreo.set(e, p);
    const n = norm(p.nombre);
    if (n && nNombre.get(n) === 1) porNombre.set(n, p);
  }

  let siguiente = previas.reduce((mx, p) => Math.max(mx, Number(String(p.id).replace(/\D/g, "")) || 0), 0);
  const tomadas = new Set<string>();
  const personas: Persona[] = [];
  const detalle: Reconciliacion["detalle"] = [];
  let reutilizadas = 0;
  let nuevas = 0;

  for (const f of frescas) {
    const c = f.cedula ? soloDigitos(f.cedula) : "";
    const e = f.correo?.toLowerCase() ?? "";
    const n = norm(f.nombre);
    const candidatos: [string, Persona | undefined][] = [
      ["ancla", porAncla.get(f.ancla)],
      ["cedula", c ? porCed.get(c) : undefined],
      ["correo", e ? porCorreo.get(e) : undefined],
      ["nombre", n ? porNombre.get(n) : undefined],
    ];
    // Una previa puede recibir dos filas frescas si es inequívocamente el mismo humano:
    // misma cédula y mismo contacto. Los homónimos no pasan este filtro.
    const mismoHumano = (p?: Persona) =>
      !!p && !!c && !!p.cedula && soloDigitos(p.cedula) === c &&
      ((!!e && (p.correo ?? "").toLowerCase() === e) ||
       (!!f.celular && !!p.celular && soloDigitos(p.celular) === soloDigitos(f.celular)));
    const hallado = candidatos.find(([, p]) => p && (!tomadas.has(p.ancla) || mismoHumano(p)));
    if (hallado?.[1]) {
      const prev = hallado[1];
      const yaTomada = tomadas.has(prev.ancla);
      tomadas.add(prev.ancla);
      const fusionada: Persona = {
        ...prev,
        // Se conserva el ancla original (es la llave de la identidad) y se anota la nueva.
        anclas: [...new Set([...(prev.anclas ?? [prev.ancla]), f.ancla])],
        // Datos frescos que enriquecen sin pisar la identidad.
        nombre: f.nombre.length > prev.nombre.length ? f.nombre : prev.nombre,
        nombres: f.nombre.length > prev.nombre.length ? f.nombres : prev.nombres,
        apellidos: f.nombre.length > prev.nombre.length ? f.apellidos : prev.apellidos,
        correo: f.correo ?? prev.correo, celular: f.celular ?? prev.celular,
        cedula: f.cedula ?? prev.cedula, direccion: f.direccion ?? prev.direccion,
        nacimiento: f.nacimiento ?? prev.nacimiento, ciudad: f.ciudad ?? prev.ciudad,
        barrio: f.barrio ?? prev.barrio, ocupacion: f.ocupacion ?? prev.ocupacion,
        cargo: f.cargo ?? prev.cargo, reporta_a: f.reporta_a ?? prev.reporta_a,
        genero: prev.genero !== "?" ? prev.genero : f.genero,
        uid: prev.uid ?? f.uid,
        uids: [...new Set([...(prev.uids ?? []), ...(f.uids ?? []), ...(f.uid ? [f.uid] : [])])],
        liga: prev.liga === "sin_liga" ? f.liga : prev.liga,
      };
      if (yaTomada) {
        // La misma persona entró en dos filas del lote: no se crea otro humano, se le suma el ancla.
        const existente = personas.find((x) => x.ancla === prev.ancla);
        if (existente) existente.anclas = [...new Set([...(existente.anclas ?? []), f.ancla])];
        else personas.push(fusionada);
      } else {
        personas.push(fusionada);
      }
      reutilizadas++;
      if (prev.ancla !== f.ancla)
        detalle.push({ id: prev.id, ancla: prev.ancla, anclaNueva: f.ancla, por: hallado[0] });
    } else {
      const id = `P${String(++siguiente).padStart(4, "0")}`;
      personas.push({ ...f, id, anclas: [...new Set([f.ancla])] });
      nuevas++;
    }
  }

  // Personas que ya no vienen en las fuentes: se conservan (el registro solo crece) para que, si
  // reaparecen, mantengan su identidad.
  const retiradas = previas.filter((p) => !tomadas.has(p.ancla));
  personas.push(...retiradas.map((p) => ({ ...p, anclas: [...new Set([...(p.anclas ?? [p.ancla])])] })));

  // Un registro viejo pudo quedar con IDs repetidos (antes de este control): se renumeran los
  // duplicados. La identidad va por ancla, así que renumerar no cambia ningún seudónimo.
  const vistos = new Set<string>();
  let maxFinal = personas.reduce((mx, p) => Math.max(mx, Number(String(p.id).replace(/\D/g, "")) || 0), siguiente);
  let renumeradas = 0;
  for (const p of personas) {
    if (!vistos.has(p.id)) { vistos.add(p.id); continue; }
    const id = `P${String(++maxFinal).padStart(4, "0")}`;
    p.id = id;
    vistos.add(id);
    renumeradas++;
  }

  return { personas, reutilizadas, nuevas, retiradas: retiradas.length, detalle, renumeradas, fusionadas_previas: fusionadasPrevias };
}
