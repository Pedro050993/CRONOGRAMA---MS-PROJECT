"""
Loop principal do worker.

Erros de processamento NAO viram documento vazio: o job falha, tenta de novo com
backoff e, esgotadas as tentativas, o documento fica com status FAILED e mensagem.
"""
from __future__ import annotations

import logging
import os
import signal
import socket
import time
import traceback
from typing import Any

from .adapters.ocr import build_ocr
from .config import Config
from .db import connect, new_id
from .handlers import document_process, productivity_import, revision_impact
from .queue import claim, complete, fail, progress
from .storage import build_storage

HANDLED_KINDS = ["document.process", "document.reprocess", "revision.impact", "productivity.import"]

log = logging.getLogger("docproc")
_stop = False


def _handle_signal(signum, frame) -> None:  # noqa: ANN001
    global _stop
    _stop = True
    log.info("sinal %s recebido; encerrando apos o job atual", signum)


def run() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    cfg = Config.from_env()
    worker_id = f"{socket.gethostname()}-{os.getpid()}-{new_id()[:8]}"

    ocr = build_ocr(cfg.ocr_provider)
    storage = build_storage(cfg)
    conn = connect(cfg.database_url)

    log.info(
        "worker iniciado id=%s ocr=%s (disponivel=%s) llm=%s storage=%s",
        worker_id, cfg.ocr_provider, ocr.available(), cfg.llm_provider, cfg.storage_driver,
    )
    if not ocr.available():
        log.warning(
            "Nenhum provedor de OCR disponivel. Paginas digitalizadas serao marcadas como "
            "pendencia e NAO serao interpretadas — comportamento intencional."
        )

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    while not _stop:
        try:
            job = claim(conn, worker_id, HANDLED_KINDS)
        except Exception:
            log.exception("falha ao reivindicar job; reconectando")
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(cfg.poll_interval * 2)
            conn = connect(cfg.database_url)
            continue

        if job is None:
            time.sleep(cfg.poll_interval)
            continue

        log.info("job %s (%s) reivindicado, tentativa %s", job.id, job.kind, job.attempts)
        started = time.time()

        def on_progress(pct: int, note: str = "") -> None:
            try:
                progress(conn, job.id, pct, note)
            except Exception:
                log.warning("nao foi possivel gravar o progresso do job %s", job.id)

        try:
            if job.kind in ("document.process", "document.reprocess"):
                result: dict[str, Any] = document_process.handle(
                    conn, storage, ocr, cfg.ocr_languages, job.project_id, job.payload, on_progress
                )
            elif job.kind == "revision.impact":
                result = revision_impact.handle(conn, job.project_id, job.payload, on_progress)
            elif job.kind == "productivity.import":
                result = productivity_import.handle(
                    conn, storage, job.project_id, job.payload, on_progress
                )
            else:
                raise ValueError(f"Tipo de job nao suportado por este worker: {job.kind}")

            complete(conn, job.id)
            log.info("job %s concluido em %.2fs: %s", job.id, time.time() - started, result)
        except Exception as e:
            conn.rollback()
            detail = f"{type(e).__name__}: {e}"
            log.error("job %s falhou: %s\n%s", job.id, detail, traceback.format_exc())
            will_retry = fail(conn, job, detail)
            if not will_retry:
                _mark_document_failed(conn, job.payload, detail)

    conn.close()
    log.info("worker encerrado")


def _mark_document_failed(conn, payload: dict[str, Any], detail: str) -> None:
    version_id = payload.get("versionId")
    if not version_id:
        return
    try:
        with conn.cursor() as cur:
            cur.execute(
                'UPDATE "DocumentVersion" SET status = %s, "statusMessage" = %s WHERE id = %s',
                (
                    "FAILED",
                    f"O processamento falhou apos todas as tentativas: {detail[:800]}. "
                    "O arquivo original permanece integro e pode ser reprocessado.",
                    version_id,
                ),
            )
        conn.commit()
    except Exception:
        log.exception("nao foi possivel marcar a versao %s como FAILED", version_id)


if __name__ == "__main__":
    run()
