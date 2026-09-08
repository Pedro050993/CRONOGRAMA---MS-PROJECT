"""Acesso ao banco. SQL direto, sem ORM: o worker compartilha o schema, nao o codigo."""
from __future__ import annotations

import psycopg
from psycopg.rows import dict_row


def connect(database_url: str) -> psycopg.Connection:
    conn = psycopg.connect(database_url, row_factory=dict_row, autocommit=False)
    return conn


def new_id() -> str:
    """Identificador compativel com o formato usado pelo Prisma (cuid-like)."""
    import secrets
    import time

    ts = int(time.time() * 1000)
    return f"c{ts:x}{secrets.token_hex(8)}"
