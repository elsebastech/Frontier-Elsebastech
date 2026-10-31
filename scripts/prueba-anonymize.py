#!/usr/bin/env python3
"""Prueba /anonymize en vivo con datos REALES del registro.

Comprueba, para una persona real: nombre completo, nombre de pila, cédula con puntos,
cédula compacta, celular y correo. Falla si alguno de sus datos reales sobrevive en la
respuesta, y comprueba que dos llamadas seguidas devuelven el mismo seudónimo.

Uso: python3 scripts/prueba-anonymize.py https://xxxx.trycloudflare.com
"""
import json
import sys
import urllib.request

U = (sys.argv[1] if len(sys.argv) > 1 else "").rstrip("/")
if not U:
    print("Falta la URL: python3 scripts/prueba-anonymize.py https://xxxx.trycloudflare.com", file=sys.stderr)
    sys.exit(2)


def post(registros):
    req = urllib.request.Request(
        U + "/anonymize",
        data=json.dumps({"records": registros}).encode(),
        headers={"content-type": "application/json"},
    )
    return json.load(urllib.request.urlopen(req, timeout=30))


def personas():
    reg = json.load(open("registro/personas.json"))
    return reg["personas"] if isinstance(reg, dict) else reg


def elegir():
    for p in personas():
        if p.get("cedula") and p.get("celular") and p.get("correo") and len(p.get("nombre", "").split()) >= 3:
            return p
    raise SystemExit("no hay persona con cédula, celular y correo en el registro")


p = elegir()
ced = p["cedula"]
ced_fmt = f"{ced[:3]}.{ced[3:6]}.{ced[6:]}"
nombre = p["nombre"]
pila = nombre.split()[0]
reales = [nombre, pila, ced, p["celular"], p["correo"], p.get("nombre_apellido") or ""]
reales = [v for v in reales if v and len(v) >= 4]

print(f"     persona real de prueba: {nombre} · CC {ced} · {p['correo']} · ancla {p['ancla']}")

casos = [
    ("nombre completo", nombre),
    ("nombre de pila", pila),
    ("cédula con puntos", f"Mi cedula es {ced_fmt}"),
    ("cédula compacta", f"cc {ced}"),
    ("celular", f"llamenme al {p['celular']}"),
    ("correo", f"escriban a {p['correo']}"),
]

fallos = 0
seudonimos = []
for etiqueta, texto in casos:
    try:
        out = post([{"id": "p-" + etiqueta, "author": nombre, "text": texto, "attachments": []}])
        r = out["records"][0]
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ {etiqueta}: fallo de red o de respuesta ({e})")
        fallos += 1
        continue
    salida = r["author"] + " | " + r["text"]
    fuga = [v for v in reales if v in salida]
    if fuga:
        print(f"  ✗ {etiqueta}: sobrevive {fuga[0]!r} → {salida[:110]!r}")
        fallos += 1
    else:
        print(f"  ✓ {etiqueta}: {salida[:110]!r}")
    seudonimos.append(r["author"])

if len(set(seudonimos)) == 1:
    print(f"  ✓ idempotencia: las 6 llamadas devuelven el mismo seudónimo ({seudonimos[0]!r})")
else:
    print(f"  ✗ idempotencia rota: {sorted(set(seudonimos))}")
    fallos += 1

# La misma persona con otro payload: {chats: [...]}
try:
    req = urllib.request.Request(
        U + "/anonymize",
        data=json.dumps({"chats": [{"id": "c1", "author": nombre, "text": f"cc {ced}", "attachments": [
            {"filename": "extracto_ana_perez_julio.pdf"}]}]}).encode(),
        headers={"content-type": "application/json"},
    )
    out = json.load(urllib.request.urlopen(req, timeout=30))
    r = (out.get("chats") or out.get("records"))[0]
    if r["author"] != seudonimos[0]:
        print(f"  ✗ payload {{chats}}: seudónimo distinto ({r['author']!r})")
        fallos += 1
    else:
        print(f"  ✓ payload {{chats}}: mismo seudónimo, filename {r['attachments'][0]['filename']!r}")
except Exception as e:  # noqa: BLE001
    print(f"  ✗ payload {{chats}} falló: {e}")
    fallos += 1

# Array plano
try:
    req = urllib.request.Request(
        U + "/anonymize",
        data=json.dumps([{"id": "c2", "author": nombre, "text": f"correo {p['correo']}"}]).encode(),
        headers={"content-type": "application/json"},
    )
    out = json.load(urllib.request.urlopen(req, timeout=30))
    lista = out if isinstance(out, list) else (out.get("records") or out.get("chats"))
    r = lista[0]
    if any(v in r["author"] + r["text"] for v in reales):
        print(f"  ✗ array plano: quedó un dato real")
        fallos += 1
    else:
        print(f"  ✓ array plano: {r['author']!r}")
except Exception as e:  # noqa: BLE001
    print(f"  ✗ array plano falló: {e}")
    fallos += 1

sys.exit(0 if fallos == 0 else 1)
