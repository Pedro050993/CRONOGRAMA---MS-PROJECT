"""
Analise de impacto de nova revisao (job `revision.impact`).

O worker NAO aplica a revisao. Ele produz a comparacao e registra a proposta.
Aplicar exige aprovacao humana (§16).
"""
from __future__ import annotations

import json
from typing import Any

import psycopg

from ..db import new_id


def handle(conn: psycopg.Connection, project_id: str, payload: dict[str, Any], on_progress) -> dict[str, Any]:
    document_id = payload["documentId"]
    new_version_id = payload["newVersionId"]

    on_progress(20, "Carregando revisoes")
    with conn.cursor() as cur:
        cur.execute(
            'SELECT id, revision FROM "DocumentVersion" WHERE "documentId" = %s ORDER BY "uploadedAt" DESC',
            (document_id,),
        )
        versions = cur.fetchall()
        if len(versions) < 2:
            return {"skipped": True, "reason": "Nao ha revisao anterior para comparar."}

        previous_id = next(v["id"] for v in versions if v["id"] != new_version_id)

        cur.execute(
            'SELECT "entityKey", attributes, confidence FROM "TechEntity" '
            'WHERE "documentId" = %s AND "evidenceId" IN (SELECT id FROM "Evidence" WHERE "versionId" = %s)',
            (document_id, previous_id),
        )
        before = {r["entityKey"]: r["attributes"] for r in cur.fetchall()}

        cur.execute(
            'SELECT "entityKey", attributes, confidence FROM "TechEntity" '
            'WHERE "documentId" = %s AND "evidenceId" IN (SELECT id FROM "Evidence" WHERE "versionId" = %s)',
            (document_id, new_version_id),
        )
        after = {r["entityKey"]: r["attributes"] for r in cur.fetchall()}

        on_progress(60, "Comparando entidades")
        added = sorted(set(after) - set(before))
        removed = sorted(set(before) - set(after))
        modified: list[dict[str, Any]] = []
        for key in sorted(set(before) & set(after)):
            changes = []
            fields = set(before[key] or {}) | set(after[key] or {})
            for f in sorted(fields):
                b = (before[key] or {}).get(f)
                a = (after[key] or {}).get(f)
                if b != a:
                    changes.append({"field": f, "before": b, "after": a})
            if changes:
                modified.append({"entityKey": key, "changes": changes})

        changed_keys = set(added) | set(removed) | {m["entityKey"] for m in modified}

        # O que consome essas entidades e, portanto, sera impactado.
        impacted_quantities: list[dict[str, Any]] = []
        impacted_activities: list[dict[str, Any]] = []
        if changed_keys:
            cur.execute(
                'SELECT id, "entityKey", qty, unit, "reviewStatus" FROM "QuantityItem" '
                'WHERE "projectId" = %s AND "entityKey" = ANY(%s)',
                (project_id, list(changed_keys)),
            )
            impacted_quantities = [dict(r) for r in cur.fetchall()]

            quantity_ids = [q["id"] for q in impacted_quantities]
            if quantity_ids:
                cur.execute(
                    'SELECT id, code, name, "durationStatus" FROM "Activity" '
                    'WHERE "projectId" = %s AND "quantityItemIds" && %s',
                    (project_id, quantity_ids),
                )
                impacted_activities = [dict(r) for r in cur.fetchall()]

        on_progress(85, "Registrando proposta de atualizacao")
        summary = {
            "documentId": document_id,
            "previousVersionId": previous_id,
            "newVersionId": new_version_id,
            "added": added,
            "removed": removed,
            "modified": modified,
            "impactedQuantities": impacted_quantities,
            "impactedActivities": impacted_activities,
            "requiresApproval": bool(changed_keys),
        }

        cur.execute(
            'INSERT INTO "AuditLog" (id, "projectId", action, entity, "entityId", after) VALUES (%s,%s,%s,%s,%s,%s)',
            (new_id(), project_id, "REVISION_IMPACT_ANALYZED", "Document", document_id, json.dumps(summary, default=str)),
        )

        if changed_keys:
            cur.execute(
                'INSERT INTO "OpenIssue" (id, "projectId", scope, description, severity, status) '
                "VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    new_id(), project_id, f"revision.{document_id}",
                    (
                        f"Nova revisao do documento alterou {len(modified)} entidade(s), incluiu {len(added)} "
                        f"e removeu {len(removed)}. {len(impacted_quantities)} quantitativo(s) e "
                        f"{len(impacted_activities)} atividade(s) podem ser impactados. "
                        "A revisao NAO foi aplicada: aprove a proposta de atualizacao."
                    ),
                    "HIGH", "OPEN",
                ),
            )

    conn.commit()
    on_progress(100, "Concluido")
    return summary
