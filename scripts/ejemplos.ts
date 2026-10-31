// Genera los ejemplos REALES que ofrece el panel (pruebas/ejemplos-panel.json).
// Ese archivo no va al repo: contiene datos del corpus. El panel lo pide a /ejemplos.
// Uso: node scripts/ejemplos.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const leer = (f: string) => readFileSync(`data/extraccion/${f}.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const chats = leer("chats");
const tablas = leer("tables");
const docs = leer("docs");

type Ejemplo = { id: string; titulo: string; nota: string; payload: unknown };
const ejemplos: Ejemplo[] = [];

// 1. Chat con tres personas dentro: autor, tercero mencionado y el celular del tercero.
const tercero = chats.find((c) => /registrado en otra cuenta|enrolado|el de ella/.test(c.text ?? "") && /\+57/.test(c.text ?? ""));
if (tercero) {
  ejemplos.push({
    id: "chat-tercero",
    titulo: "Chat con un tercero mencionado y su celular",
    nota: "El autor, una persona que solo se menciona y un número de contacto.",
    payload: { records: [{ id: tercero.id, author: tercero.author, text: tercero.text }] },
  });
}

// 2. Fila del maestro: nombre, documento, correo, celular, dirección, notas.
const cliente = tablas.find((t) => t.table === "clientes" && /@/.test(t.columns?.correo ?? "") && t.columns?.direccion);
if (cliente) {
  ejemplos.push({
    id: "cliente",
    titulo: "Cliente del maestro (fila completa)",
    nota: "Nombre, cédula, correo, celular y dirección de una sola persona.",
    payload: { records: [{ source: "tables", record: { ...cliente } }] },
  });
}

// 3. PQRS: la cédula del cliente y el agente que atendió.
const pqrs = tablas.find((t) => t.table === "pqrs" && t.columns?.agente && t.columns?.cedula);
if (pqrs) {
  ejemplos.push({
    id: "pqrs",
    titulo: "PQRS: cédula del cliente y agente",
    nota: "Dos personas en una fila: quien reclama y quien atiende.",
    payload: { records: [{ source: "tables", record: { ...pqrs } }] },
  });
}

// 4. Empleado: organigrama (reporta_a es otro empleado).
const empleado = tablas.find((t) => t.table === "empleados" && t.columns?.reporta_a && t.columns?.correo);
if (empleado) {
  ejemplos.push({
    id: "empleado",
    titulo: "Empleado con jefe en el organigrama",
    nota: "La persona y su jefe: dos identidades relacionadas.",
    payload: { records: [{ source: "tables", record: { ...empleado } }] },
  });
}

// 5. Documento con nombres en metadata (autor, revisó, elaboró).
const doc = docs.find((d) => {
  const m = d.metadata ?? {};
  return (m.author || m.revisado_por || m.elaborada_por) && (d.body ?? "").length > 300;
});
if (doc) {
  ejemplos.push({
    id: "doc",
    titulo: "Documento con personas en la metadata",
    nota: "El cuerpo del documento y los nombres que van en author/revisado_por.",
    payload: { records: [{ source: "docs", record: {
      id: doc.id, filename: doc.filename, title: doc.title, body: doc.body, metadata: doc.metadata,
    } }] },
  });
}

// 6. Varios a la vez: el chat y la fila del mismo cliente, para ver consistencia.
if (tercero && cliente) {
  ejemplos.push({
    id: "mixto",
    titulo: "Chat + fila del mismo cliente",
    nota: "Los dos registros en una sola llamada: cada persona conserva su seudónimo.",
    payload: { records: [
      { id: cliente.id, author: cliente.columns.nombre_completo, text: `Hola, soy ${cliente.columns.nombre_completo}, mi correo es ${cliente.columns.correo} y mi celular ${cliente.columns.celular}.` },
      { source: "tables", record: { ...cliente } },
    ] },
  });
}

mkdirSync("pruebas", { recursive: true });
writeFileSync("pruebas/ejemplos-panel.json", JSON.stringify({ generado: new Date().toISOString(), ejemplos }, null, 1));
console.log(`${ejemplos.length} ejemplos escritos en pruebas/ejemplos-panel.json`);
for (const e of ejemplos) console.log(`  ${e.id.padEnd(14)} ${e.titulo}`);
