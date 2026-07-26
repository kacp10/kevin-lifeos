# -*- coding: utf-8 -*-
"""
MIGRADOR KEVIN LIFE OS
Sube todos los datos de una base SQLite local (lifeos.db) a PostgreSQL/Render.

Uso:
    python migrar_a_nube.py "postgresql://usuario:clave@host/base"

Opcionalmente puedes indicar otra base SQLite:
    python migrar_a_nube.py "postgresql://..." "ruta/otra_base.db"

Qué hace:
- Detecta automáticamente todas las tablas de usuario existentes en SQLite.
- Migra solo tablas que también existen en PostgreSQL.
- Conserva los nombres y el orden real de las columnas.
- Usa una transacción por tabla: una tabla se migra completa o no se toca.
- No deja conteos falsos ni filas parcialmente migradas.
- Resincroniza las secuencias PostgreSQL después de insertar IDs explícitos.
"""

from __future__ import annotations

import os
import re
import sqlite3
import sys
from pathlib import Path
from typing import Iterable, Sequence

import psycopg2
from psycopg2 import sql


EXCLUDED_TABLES = {
    "sqlite_sequence",
}


def fail(message: str, exit_code: int = 1) -> None:
    print(f"\n[X] {message}\n")
    raise SystemExit(exit_code)


def normalize_postgres_url(raw_url: str) -> str:
    url = (raw_url or "").strip()
    if not url:
        fail('Falta la URL de PostgreSQL.')
    if not (url.startswith("postgresql://") or url.startswith("postgres://")):
        fail('La URL debe empezar con "postgresql://" o "postgres://".')
    return url.replace("postgres://", "postgresql://", 1)


def quote_sqlite_identifier(name: str) -> str:
    """Escapa un identificador para SQLite."""
    return '"' + name.replace('"', '""') + '"'


def sqlite_user_tables(connection: sqlite3.Connection) -> list[str]:
    rows = connection.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    ).fetchall()
    return [row[0] for row in rows if row[0] not in EXCLUDED_TABLES]


def sqlite_columns(connection: sqlite3.Connection, table: str) -> list[str]:
    query = f"PRAGMA table_info({quote_sqlite_identifier(table)})"
    return [row[1] for row in connection.execute(query).fetchall()]


def postgres_tables(cursor) -> set[str]:
    cursor.execute(
        """
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
        """
    )
    return {row[0] for row in cursor.fetchall()}


def postgres_columns(cursor, table: str) -> list[str]:
    cursor.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = %s
        ORDER BY ordinal_position
        """,
        (table,),
    )
    return [row[0] for row in cursor.fetchall()]


def postgres_primary_key_columns(cursor, table: str) -> list[str]:
    cursor.execute(
        """
        SELECT a.attname
        FROM pg_index i
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = %s::regclass
          AND i.indisprimary
        ORDER BY array_position(i.indkey, a.attnum)
        """,
        (f"public.{table}",),
    )
    return [row[0] for row in cursor.fetchall()]


def order_tables(
    tables: Iterable[str],
    priority: Sequence[str],
) -> list[str]:
    """
    Migra primero tablas base conocidas y luego el resto alfabéticamente.
    Esto reduce problemas de claves foráneas sin depender de una lista cerrada.
    """
    available = set(tables)
    ordered = [table for table in priority if table in available]
    ordered.extend(sorted(available - set(ordered)))
    return ordered


def sync_serial_sequence(cursor, table: str, column: str = "id") -> None:
    """
    Sincroniza la secuencia asociada a una columna serial/identity.
    Si la tabla no tiene secuencia o no tiene esa columna, no hace nada.
    """
    cursor.execute(
        "SELECT pg_get_serial_sequence(%s, %s)",
        (f"public.{table}", column),
    )
    row = cursor.fetchone()
    sequence_name = row[0] if row else None
    if not sequence_name:
        return

    query = sql.SQL(
        """
        SELECT setval(
            %s,
            COALESCE((SELECT MAX({column}) FROM {table}), 1),
            EXISTS(SELECT 1 FROM {table})
        )
        """
    ).format(
        column=sql.Identifier(column),
        table=sql.Identifier(table),
    )
    cursor.execute(query, (sequence_name,))


def migrate_table(
    sqlite_connection: sqlite3.Connection,
    postgres_connection,
    table: str,
) -> tuple[int, str | None]:
    """
    Migra una tabla dentro de una única transacción.

    Retorna:
        (cantidad_migrada, aviso)
    """
    sqlite_cols = sqlite_columns(sqlite_connection, table)
    if not sqlite_cols:
        return 0, "sin columnas"

    pg_cursor = postgres_connection.cursor()
    try:
        pg_cols = postgres_columns(pg_cursor, table)
        common_cols = [column for column in sqlite_cols if column in pg_cols]
        ignored_cols = [column for column in sqlite_cols if column not in pg_cols]

        if not common_cols:
            postgres_connection.rollback()
            return 0, "sin columnas compatibles"

        sqlite_query = (
            f"SELECT {', '.join(quote_sqlite_identifier(c) for c in common_cols)} "
            f"FROM {quote_sqlite_identifier(table)}"
        )
        rows = sqlite_connection.execute(sqlite_query).fetchall()

        # La tabla se reemplaza completa. Todo ocurre dentro de esta transacción:
        # si una fila falla, el DELETE y las inserciones se revierten juntos.
        pg_cursor.execute(
            sql.SQL("DELETE FROM {}").format(sql.Identifier(table))
        )

        if rows:
            insert_query = sql.SQL("INSERT INTO {} ({}) VALUES ({})").format(
                sql.Identifier(table),
                sql.SQL(", ").join(map(sql.Identifier, common_cols)),
                sql.SQL(", ").join(sql.Placeholder() for _ in common_cols),
            )
            pg_cursor.executemany(
                insert_query,
                [tuple(row[column] for column in common_cols) for row in rows],
            )

        if "id" in common_cols:
            sync_serial_sequence(pg_cursor, table, "id")

        postgres_connection.commit()

        warning = None
        if ignored_cols:
            warning = "columnas omitidas porque no existen en PostgreSQL: " + ", ".join(ignored_cols)
        return len(rows), warning

    except Exception:
        postgres_connection.rollback()
        raise
    finally:
        pg_cursor.close()


def main() -> None:
    if len(sys.argv) < 2:
        fail(
            'Uso: python migrar_a_nube.py "postgresql://usuario:clave@host/base" '
            '["ruta/lifeos.db"]'
        )

    postgres_url = normalize_postgres_url(sys.argv[1])
    sqlite_path = Path(sys.argv[2] if len(sys.argv) >= 3 else "lifeos.db").expanduser().resolve()

    if not sqlite_path.exists():
        fail(f"No existe la base SQLite: {sqlite_path}")

    print("\n========= MIGRADOR KEVIN LIFE OS =========\n")
    print(f"SQLite origen : {sqlite_path}")
    print("PostgreSQL    : conexión recibida (URL oculta por seguridad)\n")

    sqlite_connection = sqlite3.connect(str(sqlite_path))
    sqlite_connection.row_factory = sqlite3.Row

    try:
        postgres_connection = psycopg2.connect(postgres_url)
    except Exception as exc:
        sqlite_connection.close()
        fail(f"No se pudo conectar a PostgreSQL: {exc}")

    try:
        check_cursor = postgres_connection.cursor()
        remote_tables = postgres_tables(check_cursor)
        check_cursor.close()

        local_tables = sqlite_user_tables(sqlite_connection)
        if not local_tables:
            fail("La base SQLite no contiene tablas de usuario.")

        shared_tables = set(local_tables) & remote_tables
        missing_remote = sorted(set(local_tables) - remote_tables)

        if not shared_tables:
            fail(
                "No hay tablas compatibles en PostgreSQL. "
                "Primero deja que la aplicación de Render arranque al menos una vez."
            )

        # Orden base para respetar dependencias conocidas.
        priority = [
            "config",
            "debts",
            "habits",
            "dreams",
            "animes",
            "books",
            "goals",
            "careers",
            "detalle_items",
            "extra_debts",
            "compras",
            "services",
            "fund",
            "piggy",
            "shopping",
            "todos",
            "assets",
            "expenses",
            "month_income",
            "study_profile",
            "week_shifts",
            "months_history",
            "abonos",
            "habit_marks",
            "payment_checks",
            "routine_done",
            "routine_extra",
            "routine_hidden",
            "routine_hidden_day",
            "journal",
            "courses_done",
            "piggy_moves",
            "gym_sets",
            "debts_v2",
            "payments",
        ]

        ordered_tables = order_tables(shared_tables, priority)

        total_rows = 0
        migrated_tables = 0
        failed_tables: list[tuple[str, str]] = []

        for table in ordered_tables:
            try:
                count, warning = migrate_table(
                    sqlite_connection,
                    postgres_connection,
                    table,
                )
                total_rows += count
                migrated_tables += 1
                message = f"  [OK] {table}: {count} filas"
                if warning:
                    message += f" ({warning})"
                print(message)
            except Exception as exc:
                failed_tables.append((table, str(exc)))
                print(f"  [X]  {table}: NO migrada — {exc}")

        if missing_remote:
            print("\nTablas locales omitidas porque aún no existen en PostgreSQL:")
            for table in missing_remote:
                print(f"  [!] {table}")

        print("\n========= RESULTADO =========\n")
        print(f"Tablas migradas : {migrated_tables}")
        print(f"Filas migradas  : {total_rows}")

        if failed_tables:
            print(f"Tablas con error: {len(failed_tables)}")
            print("\nNo se alteraron parcialmente las tablas que fallaron.")
            print("Corrige los errores indicados y vuelve a ejecutar el migrador.\n")
            raise SystemExit(1)

        print("\n✦ Migración terminada correctamente.")
        print("✦ Recarga tu aplicación de Render y revisa los datos.\n")

    finally:
        try:
            postgres_connection.close()
        except Exception:
            pass
        sqlite_connection.close()


if __name__ == "__main__":
    main()
