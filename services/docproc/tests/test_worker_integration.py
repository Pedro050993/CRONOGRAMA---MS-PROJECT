"""
Integracao real: worker + PostgreSQL + armazenamento em arquivo.

Roda apenas quando DOCPROC_TEST_DATABASE_URL aponta para um banco ja migrado.
Sem isso, os testes sao pulados com mensagem clara em vez de falharem por ambiente.
"""
from __future__ import annotations

import json
import os
import tempfile
import time
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    not os.environ.get("DOCPROC_TEST_DATABASE_URL"),
    reason="Defina DOCPROC_TEST_DATABASE_URL apontando para o banco de teste ja migrado.",
)

from docproc.adapters.ocr import NullOcr  # noqa: E402
from docproc.db import connect, new_id  # noqa: E402
from docproc.handlers import document_process  # noqa: E402
from docproc.queue import claim, complete, fail  # noqa: E402
from docproc.storage import FsStorage  # noqa: E402

from fixtures import ISOMETRIC_TEXT, LINE_LIST_TEXT, make_pdf, make_scanned_pdf  # noqa: E402


@pytest.fixture()
def conn():
    c = connect(os.environ["DOCPROC_TEST_DATABASE_URL"])
    yield c
    c.close()


@pytest.fixture()
def storage_root():
    with tempfile.TemporaryDirectory() as d:
        yield d


def _bootstrap(conn, storage: FsStorage, file_name: str, pdf: bytes) -> dict:
    """Cria organizacao, projeto, documento e versao apontando para o arquivo gravado."""
    suffix = uuid.uuid4().hex[:8]
    org_id, project_id = new_id(), new_id()
    doc_id, version_id = new_id(), new_id()
    key = f"projects/{project_id}/originals/{suffix}.pdf"
    storage.put(key, pdf)

    with conn.cursor() as cur:
        cur.execute('INSERT INTO "Organization" (id, name) VALUES (%s,%s)', (org_id, f"Org {suffix}"))
        cur.execute(
            'INSERT INTO "Project" (id, "organizationId", name, "updatedAt") VALUES (%s,%s,%s, now())',
            (project_id, org_id, f"Projeto de teste {suffix}"),
        )
        cur.execute(
            'INSERT INTO "Document" (id, "projectId", "fileName", "folderPath", "updatedAt") '
            "VALUES (%s,%s,%s,%s, now())",
            (doc_id, project_id, file_name, "/TESTE"),
        )
        cur.execute(
            'INSERT INTO "DocumentVersion" (id, "documentId", sha256, "byteSize", "mimeType", '
            '"storageKey", "uploadedBy", status) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
            (version_id, doc_id, uuid.uuid4().hex * 2, len(pdf), "application/pdf", key, "tester", "PENDING"),
        )
        cur.execute('UPDATE "Document" SET "currentVersionId" = %s WHERE id = %s', (version_id, doc_id))
    conn.commit()
    return {
        "projectId": project_id, "documentId": doc_id, "versionId": version_id,
        "storageKey": key, "fileName": file_name,
    }


def _run(conn, storage, ctx) -> dict:
    return document_process.handle(
        conn, storage, NullOcr(), "por+eng", ctx["projectId"],
        {"documentId": ctx["documentId"], "versionId": ctx["versionId"],
         "storageKey": ctx["storageKey"], "fileName": ctx["fileName"]},
        lambda pct, note="": None,
    )


class TestProcessamentoDeListaDeLinhas:
    def test_grava_entidades_PENDENTES_com_evidencia_localizavel(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "LISTA-DE-LINHAS-CPM-20.501.pdf", make_pdf([LINE_LIST_TEXT]))
        result = _run(conn, storage, ctx)

        assert result["classification"] == "LINE_LIST"
        assert result["entities"] == 4

        with conn.cursor() as cur:
            cur.execute(
                'SELECT e."entityKey", e."reviewStatus", e."dataClass", e.confidence, ev.page, ev.bbox, ev.snippet '
                'FROM "TechEntity" e JOIN "Evidence" ev ON ev.id = e."evidenceId" '
                'WHERE e."projectId" = %s', (ctx["projectId"],),
            )
            rows = cur.fetchall()

        assert len(rows) == 4
        for r in rows:
            # Nada entra aprovado: revisao humana e obrigatoria.
            assert r["reviewStatus"] == "PENDING"
            assert r["dataClass"] == "EXTRACTED_FACT"
            assert 0 < r["confidence"] <= 1
            # Cada entidade aponta para uma regiao concreta do documento.
            assert r["page"] == 1
            assert len(r["bbox"]) == 4
            assert r["snippet"]

    def test_campo_ausente_gera_PENDENCIA_no_projeto(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "LISTA.pdf", make_pdf([LINE_LIST_TEXT]))
        _run(conn, storage, ctx)
        with conn.cursor() as cur:
            cur.execute(
                'SELECT description FROM "OpenIssue" WHERE "projectId" = %s', (ctx["projectId"],),
            )
            issues = [r["description"] for r in cur.fetchall()]
        assert any("nenhum valor foi assumido" in i for i in issues)


class TestProcessamentoDeIsometrico:
    def test_gera_quantitativos_de_junta_e_MTO_com_rastreabilidade(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "CPM-20.701_RC.pdf", make_pdf([ISOMETRIC_TEXT]))
        result = _run(conn, storage, ctx)

        assert result["classification"] == "PIPING_ISOMETRIC"
        assert result["quantities"] == 5  # 1 de juntas + 4 do MTO

        with conn.cursor() as cur:
            cur.execute(
                'SELECT q."entityKey", q.qty, q.unit, q."sourceKind", q."reviewStatus", q."documentRevision", '
                'q."nominalDiameterIn", ev.page FROM "QuantityItem" q '
                'LEFT JOIN "Evidence" ev ON ev.id = q."evidenceId" WHERE q."projectId" = %s',
                (ctx["projectId"],),
            )
            rows = {r["entityKey"]: r for r in cur.fetchall()}

        juntas = next(v for k, v in rows.items() if k.startswith("JOINTS|"))
        assert juntas["qty"] == 5
        assert juntas["unit"] == "jt"
        assert juntas["nominalDiameterIn"] == 10
        assert juntas["documentRevision"] == "C"
        assert all(r["reviewStatus"] == "PENDING" for r in rows.values())
        assert all(r["page"] == 1 for r in rows.values())

    def test_documento_recebe_tipo_SUGERIDO_e_nunca_confirmado_pelo_worker(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "CPM-20.701_RC.pdf", make_pdf([ISOMETRIC_TEXT]))
        _run(conn, storage, ctx)
        with conn.cursor() as cur:
            cur.execute(
                'SELECT "suggestedType", "typeConfidence", "confirmedType", "documentNumber" '
                'FROM "Document" WHERE id = %s', (ctx["documentId"],),
            )
            doc = cur.fetchone()
        assert doc["suggestedType"] == "PIPING_ISOMETRIC"
        assert doc["typeConfidence"] > 0
        assert doc["confirmedType"] is None, "somente um humano confirma o tipo"
        assert doc["documentNumber"] == "CPM-20.701"


class TestPaginaIlegivel:
    def test_sem_OCR_a_versao_fica_PARCIAL_e_a_pendencia_aparece(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "DIGITALIZADO.pdf", make_scanned_pdf())
        result = _run(conn, storage, ctx)

        assert result["status"] == "PARTIAL"
        with conn.cursor() as cur:
            cur.execute('SELECT status, "statusMessage", markdown FROM "DocumentVersion" WHERE id = %s', (ctx["versionId"],))
            v = cur.fetchone()
            cur.execute('SELECT description FROM "OpenIssue" WHERE "projectId" = %s', (ctx["projectId"],))
            issues = [r["description"] for r in cur.fetchall()]

        assert v["status"] == "PARTIAL"
        assert "nao interpretado" in v["statusMessage"]
        assert "AVISO — conteudo nao interpretado" in v["markdown"]
        assert any("Nenhum provedor de OCR" in i for i in issues)

    def test_nenhum_quantitativo_e_criado_a_partir_de_pagina_ilegivel(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "DIGITALIZADO.pdf", make_scanned_pdf())
        _run(conn, storage, ctx)
        with conn.cursor() as cur:
            cur.execute('SELECT count(*) AS n FROM "QuantityItem" WHERE "projectId" = %s', (ctx["projectId"],))
            assert cur.fetchone()["n"] == 0


class TestFila:
    def test_dois_workers_nao_pegam_o_mesmo_job(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "LISTA.pdf", make_pdf([LINE_LIST_TEXT]))
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "ProcessingJob" (id, "projectId", kind, payload) VALUES (%s,%s,%s,%s)',
                (new_id(), ctx["projectId"], "document.process", json.dumps({"versionId": ctx["versionId"]})),
            )
        conn.commit()

        outra = connect(os.environ["DOCPROC_TEST_DATABASE_URL"])
        try:
            primeiro = claim(conn, "worker-A", ["document.process"])
            segundo = claim(outra, "worker-B", ["document.process"])
            assert primeiro is not None
            assert segundo is None or segundo.id != primeiro.id
            complete(conn, primeiro.id)
        finally:
            outra.close()

    def test_falha_reagenda_com_backoff_ate_esgotar_as_tentativas(self, conn, storage_root):
        storage = FsStorage(storage_root)
        ctx = _bootstrap(conn, storage, "LISTA.pdf", make_pdf([LINE_LIST_TEXT]))
        job_id = new_id()
        with conn.cursor() as cur:
            cur.execute(
                'INSERT INTO "ProcessingJob" (id, "projectId", kind, payload, "maxAttempts") VALUES (%s,%s,%s,%s,%s)',
                (job_id, ctx["projectId"], "document.process", json.dumps({}), 2),
            )
        conn.commit()

        job = claim(conn, "worker-A", ["document.process"])
        assert fail(conn, job, "erro simulado") is True

        with conn.cursor() as cur:
            cur.execute('SELECT status, "lastError", "runAfter" > now() AS adiado FROM "ProcessingJob" WHERE id = %s', (job.id,))
            row = cur.fetchone()
        assert row["status"] == "QUEUED"
        assert row["adiado"] is True
        assert "erro simulado" in row["lastError"]

        job.attempts = 2
        assert fail(conn, job, "erro final") is False
        with conn.cursor() as cur:
            cur.execute('SELECT status FROM "ProcessingJob" WHERE id = %s', (job.id,))
            assert cur.fetchone()["status"] == "FAILED"
