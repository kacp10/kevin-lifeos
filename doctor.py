# -*- coding: utf-8 -*-
"""Diagnóstico de Kevin Life OS v103.

Ejecutar desde la raíz del proyecto:
    python doctor.py

No modifica datos. Con PostgreSQL configurado, las comprobaciones de datos se
omiten para no abrir conexiones remotas inesperadas.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
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
        problemas.append(f"Revisa {ruta}: faltan marcadores esperados")
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


def revisar_estructura() -> int | None:
    print("1) Revisando archivos y estructura...\n")
    backend = comprobar_archivo("app.py", ("@app.get('/api/ping')", "def init_db", "VERSION =", "schema_migrations"))
    frontend = comprobar_archivo("static/app.js", ("const FRONT_V =", "async function api", "function renderDesglose"))
    template = comprobar_archivo("templates/index.html", ('id="tab-inicio"', 'id="openTodoBtn"', 'id="openShoppingBtn"', "/static/app.js?v={{ version }}"))
    comprobar_archivo("static/style.css", (".panel", ".modal-back", ".tabs"))
    comprobar_archivo("db_layer.py", ("def connect", "DATABASE_URL"))

    backend_v = extraer_version(backend, r"^VERSION\s*=\s*(\d+)", "app.py")
    frontend_v = extraer_version(frontend, r"^const\s+FRONT_V\s*=\s*(\d+)", "static/app.js")
    if backend_v is not None and frontend_v is not None:
        if backend_v == frontend_v:
            print(OK + f"Versiones sincronizadas: backend v{backend_v} / frontend v{frontend_v}")
        else:
            print(BAD + f"Versiones desincronizadas: backend v{backend_v} / frontend v{frontend_v}")
            problemas.append("Iguala VERSION en app.py con FRONT_V en static/app.js")

    if template is not None and "{{ version }}" not in template:
        problemas.append("templates/index.html no invalida caché con la versión")

    duplicados = [n for n in ("index.html", "app.js") if (BASE / n).exists()]
    if duplicados:
        print(WARN + "Copias web ignoradas en la raíz: " + ", ".join(duplicados))
        advertencias.append("Elimina copias ambiguas de index.html/app.js en la raíz")
    else:
        print(OK + "No hay copias web ambiguas en la raíz")
    return backend_v


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


def revisar_sqlite() -> None:
    print("\n3) Revisando base de datos local...\n")
    if os.environ.get("DATABASE_URL"):
        print(WARN + "DATABASE_URL está configurada; se omite diagnóstico remoto.")
        advertencias.append("Ejecuta doctor localmente sin DATABASE_URL para revisar lifeos.db")
        return
    ruta = BASE / "lifeos.db"
    if not ruta.is_file():
        print(WARN + "lifeos.db no existe todavía en esta carpeta.")
        advertencias.append("La base se creará al iniciar la aplicación")
        return

    try:
        con = sqlite3.connect(f"file:{ruta}?mode=ro", uri=True)
        con.row_factory = sqlite3.Row
        integrity = con.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity == "ok":
            print(OK + "PRAGMA integrity_check: ok")
        else:
            print(BAD + f"Integridad SQLite: {integrity}")
            problemas.append("La base SQLite no pasó integrity_check")

        tablas = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        requeridas = {"config", "debts", "abonos", "books", "habits", "goals", "schema_migrations"}
        faltan = sorted(requeridas - tablas)
        if faltan:
            print(BAD + "Faltan tablas: " + ", ".join(faltan))
            problemas.append("Faltan tablas requeridas en lifeos.db")
        else:
            print(OK + f"Tablas esenciales presentes ({len(tablas)} tablas en total)")

        if "schema_migrations" in tablas:
            migraciones = con.execute("SELECT version, applied_at FROM schema_migrations ORDER BY applied_at").fetchall()
            versiones = {r[0] for r in migraciones}
            if "v103_performance_indexes" in versiones:
                print(OK + f"Migraciones registradas: {len(migraciones)}; v103 aplicada")
            else:
                print(WARN + "v103 todavía no aparece en schema_migrations; inicia app.py una vez.")
                advertencias.append("Inicia la app para aplicar la migración v103")

        if "books" in tablas:
            futuros = con.execute("SELECT COUNT(*) FROM books WHERE read_year > CAST(strftime('%Y','now') AS INTEGER)").fetchone()[0]
            if futuros:
                print(BAD + f"Libros con año futuro: {futuros}")
                problemas.append("Corrige los años futuros en Books")
            else:
                print(OK + "Books no contiene años futuros")

        if "extra_debts" in tablas:
            negativos = con.execute("SELECT COUNT(*) FROM extra_debts WHERE total < 0 OR abonado < 0 OR abonado > total").fetchone()[0]
            if negativos:
                print(BAD + f"Deudas extra con valores inválidos: {negativos}")
                problemas.append("Hay deudas extra con saldo o abono inválido")
            else:
                print(OK + "Deudas extra sin saldos negativos ni sobrepagos")

        if "compras" in tablas:
            malas = con.execute("SELECT COUNT(*) FROM compras WHERE valor < 0 OR cuotas <= 0 OR abonado < 0 OR abonado > valor").fetchone()[0]
            if malas:
                print(BAD + f"Compras a cuotas inválidas: {malas}")
                problemas.append("Hay compras a cuotas con valores inválidos")
            else:
                print(OK + "Compras a cuotas consistentes")
        con.close()
    except sqlite3.Error as exc:
        print(BAD + f"No pude revisar lifeos.db: {exc}")
        problemas.append("No se pudo abrir o consultar lifeos.db")


def revisar_servidor(version_esperada: int | None) -> None:
    print("\n4) Revisando servidor local (opcional)...\n")
    try:
        with urllib.request.urlopen("http://localhost:5000/api/ping", timeout=3) as respuesta:
            payload = json.load(respuesta)
        version = payload.get("version")
        if version_esperada is None or version == version_esperada:
            print(OK + f"Servidor activo; API reporta versión {version}")
        else:
            print(WARN + f"Servidor v{version}, archivos locales v{version_esperada}")
            advertencias.append("Reinicia el servidor para cargar los archivos actuales")
    except urllib.error.HTTPError as exc:
        print(BAD + f"El servidor respondió HTTP {exc.code} en /api/ping.")
        problemas.append("Revisa los logs del servidor")
    except (urllib.error.URLError, TimeoutError, OSError):
        print(WARN + "Servidor local apagado; se omite esta prueba.")
    except (ValueError, json.JSONDecodeError):
        print(BAD + "La respuesta de /api/ping no es JSON válido.")
        problemas.append("Corrige /api/ping")


def terminar() -> int:
    print("\n========= DIAGNÓSTICO =========\n")
    if problemas:
        for i, problema in enumerate(dict.fromkeys(problemas), 1):
            print(f"  {i}. {problema}")
        if advertencias:
            print("\n  Advertencias:")
            for aviso in dict.fromkeys(advertencias):
                print(f"  - {aviso}")
        return 1
    print("  ✦ Sin problemas críticos.")
    for aviso in dict.fromkeys(advertencias):
        print(f"  - {aviso}")
    return 0


def main() -> int:
    print("\n========= DOCTOR KEVIN LIFE OS v103 =========\n")
    version = revisar_estructura()
    revisar_sintaxis()
    revisar_sqlite()
    revisar_servidor(version)
    return terminar()


if __name__ == "__main__":
    sys.exit(main())
