"""
Consumo da fila compartilhada (tabela ProcessingJob).

O mesmo `FOR UPDATE SKIP LOCKED` usado pela API garante que Node e Python possam
consumir a fila sem corrida e sem broker adicional.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import psycopg


@dataclass
class Job:
    id: str
    project_id: str
    kind: str
    payload: dict[str, Any]
    attempts: int
    max_attempts: int


CLAIM_SQL = """
UPDATE "ProcessingJob" j
   SET status = 'RUNNING', "lockedBy" = %(worker)s, "lockedAt" = now(),
       "startedAt" = COALESCE(j."startedAt", now()), attempts = j.attempts + 1
 WHERE j.id = (
   SELECT c.id FROM "ProcessingJob" c
    WHERE c.status = 'QUEUED'
      AND c."runAfter" <= now()
      AND c.kind = ANY(%(kinds)s)
    ORDER BY c.priority ASC, c."createdAt" ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
 )
 RETURNING j.id, j."projectId", j.kind, j.payload, j.attempts, j."maxAttempts"
"""


def claim(conn: psycopg.Connection, worker_id: str, kinds: list[str]) -> Optional[Job]:
    with conn.cursor() as cur:
        cur.execute(CLAIM_SQL, {"worker": worker_id, "kinds": kinds})
        row = cur.fetchone()
    conn.commit()
    if not row:
        return None
    return Job(
        id=row["id"], project_id=row["projectId"], kind=row["kind"],
        payload=row["payload"] or {}, attempts=row["attempts"], max_attempts=row["maxAttempts"],
    )


def progress(conn: psycopg.Connection, job_id: str, pct: int, note: str = "") -> None:
    with conn.cursor() as cur:
        cur.execute(
            'UPDATE "ProcessingJob" SET progress = %s, "progressNote" = %s WHERE id = %s',
            (max(0, min(100, pct)), note or None, job_id),
        )
    conn.commit()


def complete(conn: psycopg.Connection, job_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            'UPDATE "ProcessingJob" SET status = %s, progress = 100, "finishedAt" = now(), '
            '"lockedBy" = NULL, "lockedAt" = NULL WHERE id = %s',
            ("DONE", job_id),
        )
    conn.commit()


def fail(conn: psycopg.Connection, job: Job, error: str) -> bool:
    """Reagenda com backoff exponencial ate esgotar as tentativas. Retorna se havera retry."""
    will_retry = job.attempts < job.max_attempts
    backoff = 2 ** job.attempts * 15
    with conn.cursor() as cur:
        if will_retry:
            cur.execute(
                'UPDATE "ProcessingJob" SET status = %s, "lastError" = %s, "lockedBy" = NULL, '
                '"lockedAt" = NULL, "runAfter" = now() + (%s || \' seconds\')::interval WHERE id = %s',
                ("QUEUED", error[:4000], str(backoff), job.id),
            )
        else:
            cur.execute(
                'UPDATE "ProcessingJob" SET status = %s, "lastError" = %s, "finishedAt" = now(), '
                '"lockedBy" = NULL, "lockedAt" = NULL WHERE id = %s',
                ("FAILED", error[:4000], job.id),
            )
    conn.commit()
    return will_retry
