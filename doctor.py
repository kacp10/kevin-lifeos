# -*- coding: utf-8 -*-
"""Diagnóstico local de Kevin Life OS.

Ejecutar desde la raíz del proyecto:
    python doctor.py

No modifica datos ni requiere que el servidor esté encendido.
"""
from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

BASE = Path(__file__).resolve().parent
OK, WARN, BAD = "  [OK] ", "  [!]  ", "  [X]  "
problemas: list[str] = []
advertencias: list[str] = []


def leer(ruta: str) -> str | None:
    archivo = BASE / ruta
    if not archivo.is_file():
        print(BAD + f"{ruta} no existe.")
        problemas.append(f"Falta el archivo requerido: {ruta}")
        return None
    return archivo.read_text(encoding="utf-8", errors="ignore")


def comprobar_archivo(ruta: str, marcadores: tuple[str, ...]) -> str | None:
    contenido = leer(ruta)
    if contenido is None:
        return None
    faltantes = [m for m in marcadores if m not in contenido]
    if faltantes:
        print(BAD + f"{ruta} está incompleto; faltan: {', '.join(faltantes)}")
        problemas.append(f"Revisa {ruta}: faltan marcadores esperados del proyecto")
    else:
        print(OK + ruta)
    return contenido


def extraer_version(contenido: str | None, patron: str, archivo: str) -> int | None:
    if contenido is None:
        return None
    coincidencia = re.search(patron, contenido, re.MULTILINE)
    if not coincidencia:
        print(BAD + f"No pude leer la versión declarada en {archivo}.")
        problemas.append(f"Declara correctamente la versión en {archivo}")
        return None
    return int(coincidencia.group(1))


def revisar_estructura() -> tuple[int | None, int | None]:
    print("1) Revisando archivos y estructura...\n")
    backend = comprobar_archivo("app.py", ("@app.get('/api/ping')", "def init_db", "VERSION ="))
    frontend = comprobar_archivo("static/app.js", ("const FRONT_V =", "async function api", "function render"))
    template = comprobar_archivo("templates/index.html", ('id="tab-inicio"', "/static/app.js?v={{ version }}"))
    comprobar_archivo("static/style.css", (".panel", ".modal"))
    comprobar_archivo("db_layer.py", ("def connect", "DATABASE_URL"))
    comprobar_archivo("requirements.txt", ("Flask==", "gunicorn==", "psycopg2-binary=="))
    comprobar_archivo("render.yaml", ("gunicorn app:app", "DATABASE_URL"))

    backend_v = extraer_version(backend, r"^VERSION\s*=\s*(\d+)", "app.py")
    frontend_v = extraer_version(frontend, r"^const\s+FRONT_V\s*=\s*(\d+)", "static/app.js")

    if backend_v is not None and frontend_v is not None:
        if backend_v == frontend_v:
            print(OK + f"Versiones sincronizadas: backend v{backend_v} / frontend v{frontend_v}")
        else:
            print(BAD + f"Versiones desincronizadas: backend v{backend_v} / frontend v{frontend_v}")
            problemas.append("Iguala VERSION en app.py con FRONT_V en static/app.js")

    if template is not None and "{{ version }}" not in template:
        print(BAD + "templates/index.html no usa la versión del backend para invalidar caché.")
        problemas.append("Usa ?v={{ version }} al cargar static/app.js")

    archivos_raiz_ignorados = [n for n in ("index.html", "app.js", "style.css") if (BASE / n).exists()]
    if archivos_raiz_ignorados:
        nombres = ", ".join(archivos_raiz_ignorados)
        print(WARN + f"Archivos web ignorados por Flask en la raíz: {nombres}")
        advertencias.append(f"Elimina o mueve los archivos web duplicados de la raíz: {nombres}")
    else:
        print(OK + "No hay copias web ambiguas en la raíz")

    return backend_v, frontend_v


def revisar_sintaxis() -> None:
    print("\n2) Revisando sintaxis Python...\n")
    import py_compile

    for ruta in ("app.py", "db_layer.py", "doctor.py", "migrar_a_nube.py"):
        archivo = BASE / ruta
        if not archivo.is_file():
            continue
        try:
            py_compile.compile(str(archivo), doraise=True)
            print(OK + ruta)
        except py_compile.PyCompileError as exc:
            print(BAD + f"{ruta}: {exc.msg}")
            problemas.append(f"Corrige el error de sintaxis en {ruta}")


def revisar_servidor(version_esperada: int | None) -> None:
    print("\n3) Revisando el servidor local (opcional)...\n")
    try:
        with urllib.request.urlopen("http://localhost:5000/api/ping", timeout=3) as respuesta:
            payload = json.load(respuesta)
        version_servidor = payload.get("version")
        if version_esperada is None or version_servidor == version_esperada:
            print(OK + f"Servidor activo; API reporta versión {version_servidor}")
        else:
            print(WARN + f"Servidor activo en v{version_servidor}, archivos locales en v{version_esperada}")
            advertencias.append("Reinicia el servidor para cargar la versión local actual")
    except urllib.error.HTTPError as exc:
        print(BAD + f"El servidor respondió HTTP {exc.code} en /api/ping.")
        problemas.append("Revisa los logs del servidor local")
    except (urllib.error.URLError, TimeoutError, OSError):
        print(WARN + "Servidor local apagado o no accesible; se omite esta prueba.")
        advertencias.append("Arranca con 'python app.py' para validar /api/ping")
    except (ValueError, json.JSONDecodeError):
        print(BAD + "La respuesta de /api/ping no es JSON válido.")
        problemas.append("Corrige la respuesta del endpoint /api/ping")


def terminar() -> int:
    print("\n========= DIAGNÓSTICO =========\n")
    if problemas:
        print(f"  Se encontraron {len(problemas)} problema(s):\n")
        for i, problema in enumerate(dict.fromkeys(problemas), 1):
            print(f"  {i}. {problema}")
        if advertencias:
            print("\n  Advertencias adicionales:")
            for advertencia in dict.fromkeys(advertencias):
                print(f"  - {advertencia}")
        print()
        return 1

    print("  ✦ Estructura y versiones correctas.")
    if advertencias:
        for advertencia in dict.fromkeys(advertencias):
            print(f"  - {advertencia}")
    else:
        print("  ✦ Todas las comprobaciones pasaron.")
    print()
    return 0


def main() -> int:
    print("\n========= DOCTOR KEVIN LIFE OS =========\n")
    backend_v, _ = revisar_estructura()
    revisar_sintaxis()
    revisar_servidor(backend_v)
    return terminar()


if __name__ == "__main__":
    sys.exit(main())
