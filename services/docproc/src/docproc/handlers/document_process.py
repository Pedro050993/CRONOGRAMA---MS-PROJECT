"""
Processamento de um documento (job `document.process`).

Contrato de saida, sem excecao:
  - todo registro criado nasce com reviewStatus = 'PENDING';
  - todo registro criado aponta para uma Evidence com pagina e regiao;
  - o que nao pode ser lido vira OpenIssue, nunca um valor plausivel.
"""
from __future__ import annotations

import json
from typing import Any

import psycopg

from ..adapters.ocr import OcrAdapter
from ..classify import classify
from ..db import new_id
from ..extractors.common import find_document_number, find_revision
from ..extractors.isometric import extract_isometric
from ..extractors.line_list import extract_line_list
from ..pdf.extract import extract_image, extract_pdf
from ..pdf.markdown import document_to_markdown
from ..storage import Storage

IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "tif", "tiff"}


def handle(
    conn: psycopg.Connection,
    storage: Storage,
    ocr: OcrAdapter,
    languages: str,
    project_id: str,
    payload: dict[str, Any],
    on_progress,
) -> dict[str, Any]:
    version_id = payload["versionId"]
    document_id = payload["documentId"]
    storage_key = payload["storageKey"]
    file_name = payload.get("fileName", "documento")

    on_progress(5, "Baixando o arquivo original")
    data = storage.get(storage_key)
    extension = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""

    on_progress(15, "Detectando texto vetorial e regioes digitalizadas")
    if extension == "pdf":
        doc = extract_pdf(data, ocr, languages)
    elif extension in IMAGE_EXTENSIONS:
        doc = extract_image(data, ocr, languages)
    else:
        raise ValueError(
            f'Formato ".{extension}" nao processavel por este worker. '
            "A API deveria ter bloqueado o arquivo antes de enfileirar."
        )

    full_text = "\n".join(p.text for p in doc.pages)
    on_progress(40, "Classificando o documento")
    classification = classify(file_name, full_text)
    document_number = find_document_number(full_text, file_name) or file_name.rsplit(".", 1)[0]
    revision = find_revision(full_text)

    on_progress(55, "Gerando Markdown rastreavel")
    markdown = document_to_markdown(
        doc, file_name, document_number, revision, classification.doc_type, classification.confidence
    )

    entity_count = 0
    quantity_count = 0
    issues: list[str] = []

    with conn.cursor() as cur:
        # Paginas e avisos
        for page in doc.pages:
            cur.execute(
                'INSERT INTO "DocumentPage" (id, "versionId", "pageNumber", sheet, kind, "widthPt", "heightPt", markdown, warnings) '
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                'ON CONFLICT ("versionId","pageNumber") DO UPDATE SET kind = EXCLUDED.kind, markdown = EXCLUDED.markdown, warnings = EXCLUDED.warnings',
                (new_id(), version_id, page.number, None, page.kind, page.width, page.height, None, page.warnings),
            )
            for w in page.warnings:
                issues.append(w)

        on_progress(70, "Extraindo entidades tecnicas")

        # --- Lista de linhas ---
        if classification.doc_type == "LINE_LIST":
            for rec in extract_line_list(doc):
                evidence_id = _insert_evidence(cur, version_id, rec.evidence)
                attributes = {
                    "lineNumber": rec.line_number,
                    "objectKey": f"LINE|{rec.line_number}",
                    "nominalDiameterIn": rec.nominal_diameter_in,
                    "pipeClass": rec.pipe_class,
                    "schedule": rec.schedule,
                    "service": rec.service,
                    "missingFields": rec.missing,
                }
                _insert_entity(
                    cur, project_id, document_id, evidence_id,
                    entity_key=f"LINE|{rec.line_number}", kind="PIPING_LINE", discipline="PIPING",
                    attributes=attributes, confidence=rec.confidence,
                )
                entity_count += 1
                for field_name in rec.missing:
                    issues.append(
                        f'Linha "{rec.line_number}": campo "{field_name}" nao localizado no documento. '
                        "Registrado como pendencia — nenhum valor foi assumido."
                    )

        # --- Isometrico ---
        elif classification.doc_type == "PIPING_ISOMETRIC":
            iso = extract_isometric(doc, file_name)
            evidence_id = _insert_evidence(cur, version_id, iso.evidence) if iso.evidence else None
            object_key = f"ISO|{iso.document_number or document_number}"
            _insert_entity(
                cur, project_id, document_id, evidence_id,
                entity_key=object_key, kind="PIPING_ISOMETRIC", discipline="PIPING",
                attributes={
                    "documentNumber": iso.document_number,
                    "revision": iso.revision,
                    "lineNumber": iso.line_number,
                    "objectKey": f"LINE|{iso.line_number}" if iso.line_number else object_key,
                    "nominalDiameterIn": iso.nominal_diameter_in,
                    "spoolId": iso.spool_id,
                    "testPackId": iso.test_pack_id,
                    "jointCount": iso.joint_count,
                    "jointTags": iso.joint_tags,
                    "missingFields": iso.missing,
                },
                confidence=iso.confidence,
            )
            entity_count += 1
            issues.extend(iso.warnings)

            # Juntas: quantidade so entra se as marcacoes foram REALMENTE lidas.
            if iso.joint_count and iso.line_number:
                _insert_quantity(
                    cur, project_id, document_id, evidence_id,
                    entity_key=f"JOINTS|{iso.line_number}", discipline="PIPING",
                    source_kind="PIPING_ISOMETRIC", revision=iso.revision,
                    line_number=iso.line_number, dn=iso.nominal_diameter_in,
                    item_type="JUNTA", qty=float(iso.joint_count), unit="jt",
                    confidence=iso.confidence,
                )
                quantity_count += 1

            for item in iso.mto:
                item_evidence = _insert_evidence(cur, version_id, item.evidence)
                _insert_quantity(
                    cur, project_id, document_id, item_evidence,
                    entity_key=f"MTO|{iso.document_number or document_number}|{item.item_no}",
                    discipline="PIPING", source_kind="MTO", revision=iso.revision,
                    line_number=iso.line_number, dn=item.nominal_diameter_in,
                    item_type=item.description[:60], qty=item.qty, unit="un",
                    confidence=item.confidence,
                )
                quantity_count += 1

        else:
            issues.append(
                f'Documento classificado como "{classification.doc_type}" (confianca '
                f"{classification.confidence:.0%}). Nao ha extrator de entidades para este tipo na Fase 1. "
                "O Markdown rastreavel foi gerado para leitura e busca."
            )

        on_progress(85, "Gravando resultado")

        status = "DONE" if not doc.warnings else "PARTIAL"
        status_message = (
            None if status == "DONE"
            else f"{len(doc.warnings)} aviso(s) de conteudo nao interpretado. Veja as pendencias do projeto."
        )
        cur.execute(
            'UPDATE "DocumentVersion" SET status = %s, "statusMessage" = %s, markdown = %s, '
            '"pageCount" = %s, revision = COALESCE(revision, %s), "extractionJson" = %s WHERE id = %s',
            (
                status, status_message, markdown, doc.page_count, revision,
                json.dumps({
                    "classification": {
                        "type": classification.doc_type,
                        "confidence": classification.confidence,
                        "reasons": classification.reasons,
                        "runnerUp": classification.runner_up,
                    },
                    "pages": [
                        {"number": p.number, "kind": p.kind, "chars": p.char_count,
                         "imageAreaRatio": p.image_area_ratio, "warnings": p.warnings}
                        for p in doc.pages
                    ],
                    "entities": entity_count,
                    "quantities": quantity_count,
                }),
                version_id,
            ),
        )
        cur.execute(
            'UPDATE "Document" SET "suggestedType" = %s, "typeConfidence" = %s, '
            '"documentNumber" = COALESCE("documentNumber", %s) WHERE id = %s',
            (classification.doc_type, classification.confidence, document_number, document_id),
        )

        for issue in issues[:200]:
            cur.execute(
                'INSERT INTO "OpenIssue" (id, "projectId", scope, description, severity, status) '
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (new_id(), project_id, f"document.{document_id}", issue[:2000], "MEDIUM", "OPEN"),
            )

        cur.execute(
            'INSERT INTO "AuditLog" (id, "projectId", action, entity, "entityId", after) '
            "VALUES (%s,%s,%s,%s,%s,%s)",
            (
                new_id(), project_id, "DOCUMENT_PROCESSED", "DocumentVersion", version_id,
                json.dumps({
                    "classification": classification.doc_type,
                    "confidence": classification.confidence,
                    "entities": entity_count, "quantities": quantity_count,
                    "pages": doc.page_count, "issues": len(issues),
                }),
            ),
        )

    conn.commit()
    on_progress(100, "Concluido")
    return {
        "classification": classification.doc_type,
        "confidence": classification.confidence,
        "pages": doc.page_count,
        "entities": entity_count,
        "quantities": quantity_count,
        "issues": len(issues),
        "status": status,
    }


def _insert_evidence(cur, version_id: str, ev) -> str | None:
    if ev is None:
        return None
    evidence_id = new_id()
    cur.execute(
        'INSERT INTO "Evidence" (id, "versionId", page, sheet, bbox, layer, "objectId", snippet, method, confidence) '
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (
            evidence_id, version_id, ev.page, ev.sheet, list(ev.bbox) if ev.bbox else [],
            None, None, (ev.snippet or "")[:2000], ev.method, ev.confidence,
        ),
    )
    return evidence_id


def _insert_entity(cur, project_id, document_id, evidence_id, entity_key, kind, discipline, attributes, confidence) -> None:
    # `updatedAt` e mantido pelo Prisma na camada de aplicacao; em SQL direto
    # precisamos preenche-lo explicitamente.
    cur.execute(
        'INSERT INTO "TechEntity" (id, "projectId", "documentId", "evidenceId", "entityKey", kind, discipline, '
        'attributes, "dataClass", confidence, "reviewStatus", "updatedAt") '
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now()) "
        'ON CONFLICT ("projectId","entityKey","documentId") DO UPDATE '
        "SET attributes = EXCLUDED.attributes, confidence = EXCLUDED.confidence, "
        'version = "TechEntity".version + 1, "updatedAt" = now()',
        (
            new_id(), project_id, document_id, evidence_id, entity_key, kind, discipline,
            json.dumps(attributes), "EXTRACTED_FACT", confidence, "PENDING",
        ),
    )


def _insert_quantity(
    cur, project_id, document_id, evidence_id, entity_key, discipline, source_kind,
    revision, line_number, dn, item_type, qty, unit, confidence,
) -> None:
    cur.execute(
        'INSERT INTO "QuantityItem" (id, "projectId", "documentId", "evidenceId", "entityKey", discipline, '
        '"sourceKind", "documentRevision", "lineNumber", "nominalDiameterIn", "itemType", qty, unit, '
        '"dataClass", confidence, "reviewStatus", "updatedAt") '
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())",
        (
            new_id(), project_id, document_id, evidence_id, entity_key, discipline, source_kind,
            revision, line_number, dn, item_type, qty, unit, "EXTRACTED_FACT", confidence, "PENDING",
        ),
    )
