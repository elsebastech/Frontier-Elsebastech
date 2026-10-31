"""Exploración del corpus real (fuentes/). Solo lee; imprime conteos, no datos personales completos.
Uso: python3 scripts/explorar.py
"""
import csv, io, json, re, glob, os, collections, unicodedata
import xml.etree.ElementTree as ET

F = "fuentes"
C = collections.Counter

def norm(s):
    s = unicodedata.normalize("NFKD", s)
    return "".join(c for c in s if not unicodedata.combining(c)).lower().strip()

print("=" * 70, "\nTABLAS")
cli = list(csv.DictReader(io.StringIO(open(f"{F}/tables/clientes.csv", encoding="latin-1").read()), delimiter=";"))
print("clientes:", len(cli), "columnas:", list(cli[0].keys()))
nom = C(norm(r["nombre_completo"]) for r in cli)
homo = {k: v for k, v in nom.items() if v > 1}
print("  homónimos por nombre completo:", len(homo), "grupos →", sum(homo.values()), "filas")
for k in homo:
    filas = [r for r in cli if norm(r["nombre_completo"]) == k]
    print("   ", [(r["cliente_id"], r["ciudad"], r["correo"].split("@")[-1]) for r in filas])
corto = C(" ".join(norm(r["nombre_completo"]).split()[:2]) for r in cli)
print("  colisiones nombre+1er apellido:", sum(1 for v in corto.values() if v > 1))
print("  tipo_doc:", C(r["tipo_doc"] for r in cli))
print("  dominios correo:", C(r["correo"].split("@")[-1] for r in cli).most_common(8))
print("  ciudades:", C(r["ciudad"] for r in cli))
print("  ocupaciones distintas:", len(set(r["ocupacion"] for r in cli)))
qi = C((r["ciudad"], r["barrio"], r["ocupacion"], r["fecha_vinculacion"][:4]) for r in cli)
print("  (ciudad,barrio,ocupación,año) únicos:", sum(1 for v in qi.values() if v == 1), "de", len(cli))
qi2 = C((r["barrio"], r["ocupacion"]) for r in cli)
print("  (barrio,ocupación) únicos:", sum(1 for v in qi2.values() if v == 1))
print("  filas con notas:", sum(1 for r in cli if r["notas"].strip()))
print("  notas con CL-:", sum(1 for r in cli if "CL-" in r["notas"]))

tx = list(csv.DictReader(open(f"{F}/tables/transacciones.csv", encoding="utf-8")))
print("transacciones:", len(tx), "columnas:", list(tx[0].keys()))
print("  tipos:", C(r["tipo"] for r in tx).most_common(10))
print("  canales:", C(r["canal"] for r in tx))
desc_may = [r["descripcion"] for r in tx if re.search(r"\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+ [A-ZÁÉÍÓÚÑ][a-záéíóúñ]+", r["descripcion"])]
print("  descripciones con 'Nombre Apellido'-like:", len(desc_may), "ej:", desc_may[:6])
ids_cli = set(r["cliente_id"] for r in cli)
print("  cliente_id en tx que no están en clientes:", len(set(r["cliente_id"] for r in tx) - ids_cli))

pq = ET.parse(f"{F}/tables/pqrs.xml").getroot()
print("pqrs:", len(pq), "atributos:", sorted(set(k for p in pq for k in p.attrib)), "hijos:", sorted(set(c.tag for p in pq for c in p)))
print("  agentes:", C(p.get("agente") for p in pq))
emp = ET.parse(f"{F}/tables/empleados.xml").getroot()
print("empleados:", len(emp), "atributos:", sorted(set(k for e in emp for k in e.attrib)), "hijos:", sorted(set(c.tag for e in emp for c in e)))
enames = [e.findtext("nombre") for e in emp]
print("  reporta_a valores distintos:", len(set(e.get("reporta_a") for e in emp)))
corto_emp = {" ".join(n.split()[:2]): n for n in enames}
print("  reporta_a que no coinciden con 'nombre 1er apellido' de un empleado:",
      [e.get("reporta_a") for e in emp if e.get("reporta_a") and e.get("reporta_a") not in corto_emp])
cli_n = set(norm(r["nombre_completo"]) for r in cli)
cli_c = set(" ".join(norm(r["nombre_completo"]).split()[:2]) for r in cli)
print("  empleados con nombre igual a un cliente (completo / nombre+apellido):",
      [n for n in enames if norm(n) in cli_n], [n for n in enames if " ".join(norm(n).split()[:2]) in cli_c])

print("=" * 70, "\nUSERS.JSON")
us = json.load(open(f"{F}/chats/users.json"))
print("usuarios:", len(us), "títulos:", C(u.get("profile", {}).get("title", "∅") for u in us).most_common(12))
print("  bots:", [u["real_name"] for u in us if u.get("is_bot")], "borrados:", sum(1 for u in us if u.get("deleted")))
emp_mail = {e.findtext("correo"): e for e in emp}
cli_mail = {r["correo"]: r for r in cli}
cat = C()
for u in us:
    p = u.get("profile", {}); m = p.get("email", ""); rn = norm(u.get("real_name", ""))
    if u.get("is_bot") or u.get("deleted"): cat["bot/borrado"] += 1
    elif m in emp_mail: cat["empleado por correo"] += 1
    elif m in cli_mail: cat["cliente por correo"] += 1
    elif rn in cli_n: cat["cliente por nombre (" + str(sum(1 for r in cli if norm(r['nombre_completo']) == rn)) + " candidatos)"] += 1
    elif rn in set(norm(n) for n in enames): cat["empleado por nombre"] += 1
    else: cat["SIN LIGA: " + p.get("title", "∅")] += 1
print("  liga users → tablas:", dict(cat))
emp_n = set(norm(n) for n in enames)
print("  empleados de users con nombre distinto al de empleados.xml:",
      [(u["real_name"], emp_mail[u["profile"]["email"]].findtext("nombre")) for u in us
       if u.get("profile", {}).get("email") in emp_mail and norm(u["real_name"]) != norm(emp_mail[u["profile"]["email"]].findtext("nombre"))][:8])

print("=" * 70, "\nCHATS")
msgs = []
for f in sorted(glob.glob(f"{F}/chats/*/*.json")):
    if f.endswith("_fechas.json") or f.endswith("channels.json") or f.endswith("users.json"): continue
    canal = f.split("/")[-2]
    for m in json.load(open(f)): m["_canal"] = canal; msgs.append(m)
print("mensajes:", len(msgs), "por canal:", C(m["_canal"] for m in msgs))
print("  llaves:", C(k for m in msgs for k in m).most_common(25))
print("  subtypes:", C(m.get("subtype", "∅") for m in msgs))
hilos = set((m["_canal"], m.get("thread_ts", m["ts"])) for m in msgs)
print("  hilos:", len(hilos), " con archivos:", sum(1 for m in msgs if m.get("files")), " editados:", sum(1 for m in msgs if m.get("edited")))
T = [m.get("text", "") for m in msgs]
pat = {
    "mención <@U>": r"<@U[A-Z0-9]+>", "correo": r"[\w.+-]+@[\w-]+\.[\w.]+", "arroba": r"\barroba\b",
    "celular 3xx": r"(?<!\d)(?:\+?57[\s-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)", "cédula con puntos": r"\b\d{1,3}\.\d{3}\.\d{3}\b",
    "número 7-10 díg": r"(?<![\d.])\d{7,10}(?![\d.])", "placa": r"\b[A-Z]{3}[\s-]?\d{3}\b", "pasaporte": r"(?i)pasaporte",
    "dirección": r"(?i)\b(calle|carrera|cra|cl|av|avenida|diagonal|transversal|tv)\.? ?\d+", "MAYÚSCULAS 2+ palabras": r"\b[A-ZÑ]{3,} [A-ZÑ]{3,}\b",
    "CL-": r"CL-\d+", "PQR-": r"PQR-\d{4}-\d+", "TX-": r"TX-\d+", "html/comentario": r"<!--",
}
for k, p in pat.items():
    n = sum(1 for t in T if re.search(p, t)); print(f"  {k:24s} {n}")
print("  ej. MAYÚSCULAS:", [re.search(pat["MAYÚSCULAS 2+ palabras"], t).group(0) for t in T if re.search(pat["MAYÚSCULAS 2+ palabras"], t)][:8])
print("  ej. arroba:", [t[:140] for t in T if re.search(r"\barroba\b", t)][:3])
fn = [f.get("name", "") for m in msgs for f in m.get("files", [])]
print("  adjuntos:", len(fn), "ej:", fn[:8])
bots = [m.get("text", "")[:160] for m in msgs if m.get("subtype") == "bot_message"]
print("  textos de bot distintos (inicio):", C(re.sub(r"[A-ZÁÉÍÓÚ][a-záéíóú]+", "X", b)[:60] for b in bots).most_common(6))

print("=" * 70, "\nDOCS")
idx = json.load(open(f"{F}/docs/index.json"))
for d in idx:
    p = f"{F}/docs/{d['filename']}"; b = open(p, "rb").read()
    info = ""
    if d["format"] == "pdf":
        au = re.findall(rb"/(Author|Title|Subject|Keywords|Creator|Producer)\s*\(([^)]*)\)", b)
        info = f"pdf meta={[(k.decode(), v.decode('latin-1')[:40]) for k, v in au]} texto_plano={'sí' if b'BT' in b else '?'} comprimido={'FlateDecode' in b.decode('latin-1')}"
    elif d["format"] == "html":
        t = b.decode("utf-8")
        info = f"meta={re.findall(r'<meta[^>]+name=.([a-zA-Z_:-]+)', t)} comentarios={len(re.findall('<!--', t))} lang={re.findall(r'lang=.([a-z]+)', t)[:1]}"
    else:
        t = b.decode("utf-8"); fm = re.match(r"---\n(.*?)\n---", t, re.S)
        info = f"front_matter={[l.split(':')[0] for l in fm.group(1).splitlines()] if fm else None} comentarios={len(re.findall('<!--', t))}"
    print(f"  {d['id']} {d['format']:4s} {len(b):7d}B {d['filename'][:42]:42s} {info}")
