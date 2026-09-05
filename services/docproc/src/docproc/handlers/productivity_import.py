"""
Job `productivity.import`: extrai a tabela de produtividade de um PDF.

O worker NÃO decide se o índice é válido. Ele entrega as linhas; a regra de
aceitação é a mesma do `core`, replicada aqui de forma mínima para que o resultado
seja idêntico ao da importação de XLSX/CSV: unidade fora do registro derruba a
linha, valor não numérico derruba a linha, base e data têm de existir.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional

import psycopg

from ..db import new_id
from ..extractors.productivity_table import extract_table_from_pdf
from ..storage import Storage

UNIT_ALIASES = {
    "m": "m", "metro": "m", "metros": "m", "ml": "m",
    "kg": "kg", "t": "t", "ton": "t", "tonelada": "t",
    "un": "un", "und": "un", "unid": "un", "unidade": "un", "pc": "pc",
    "jt": "jt", "junta": "jt", "juntas": "jt",
    "in-dia": "in-dia", "pol-dia": "in-dia", "polegada-diametro": "in-dia", "di": "in-dia",
    "in-jt": "in-jt", "pol-junta": "in-jt",
    "m2": "m2", "m3": "m3", "h": "h", "hh": "hh",
}
BASIS_ALIASES = {
    "orcado": "BUDGETED", "orçado": "BUDGETED", "budget": "BUDGETED", "budgeted": "BUDGETED",
    "planejado": "PLANNED", "planned": "PLANNED",
    "observado": "OBSERVED", "historico": "OBSERVED", "histórico": "OBSERVED", "realizado": "OBSERVED",
    "projetado": "FORECAST", "forecast": "FORECAST", "previsto": "FORECAST",
}
HEADER_HINTS = {
    "code": ["codigo", "código", "code", "item"],
    "description": ["servico", "serviço", "descricao", "descrição", "atividade", "description"],
    "value": ["indice", "índice", "valor", "hh", "produtividade", "index"],
    "perUnit": ["unidade", "unid", "un", "uom", "unit"],
    "basis": ["base", "basis"],
    "sourceDate": ["data", "date"],
}


def _norm(s: str) -> str:
    import unicodedata

    return "".join(
        c for c in unicodedata.normalize("NFD", (s or "").strip().lower())
        if unicodedata.category(c) != "Mn"
    )


def _parse_number(raw: str) -> Optional[float]:
    s = (raw or "").strip().replace(" ", "")
    if not s:
        return None
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})*(,\d+)?", s):
        s = s.replace(".", "").replace(",", ".")
    else:
        s = s.replace(",", "")
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(raw: str) -> Optional[str]:
    s = (raw or "").strip()
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
    br = re.match(r"^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$", s)
    if br:
        d, m, y = int(br.group(1)), int(br.group(2)), br.group(3)
        if d > 31 or m > 12:
            return None
        return f"{y}-{m:02d}-{d:02d}"
    return None


def _detect_header(rows: list[list[str]]) -> tuple[int, dict[str, int]]:
    for i, row in enumerate(rows[:30]):
        mapping: dict[str, int] = {}
        taken: set[int] = set()
        for c, cell in enumerate(row):
            n = _norm(cell)
            if not n or c in taken:
                continue
            for field_name, hints in HEADER_HINTS.items():
                if field_name in mapping:
                    continue
                if any(n == _norm(h) for h in hints):
                    mapping[field_name] = c
                    taken.add(c)
                    break
        if "value" in mapping and "perUnit" in mapping:
            return i, mapping
    return -1, {}


def handle(
    conn: psycopg.Connection,
    storage: Storage,
    project_id: str,
    payload: dict[str, Any],
    on_progress,
) -> dict[str, Any]:
    import_id = payload["importId"]
    storage_key = payload["storageKey"]
    file_name = payload.get("fileName", "base-produtividade.pdf")
    declared_basis = payload.get("declaredBasis")
    declared_date = payload.get("declaredSourceDate")

    on_progress(10, "Baixando o arquivo")
    data = storage.get(storage_key)

    on_progress(35, "Reconhecendo a tabela no PDF")
    table = extract_table_from_pdf(data)
    warnings = list(table.warnings)

    header_index, mapping = _detect_header(table.rows)
    candidates: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []

    if header_index == -1:
        warnings.append(
            "Nenhum cabecalho com colunas de indice e unidade foi reconhecido no PDF. "
            "Nenhum indice foi importado. Envie a base em XLSX ou CSV para leitura confiavel."
        )
    else:
        on_progress(60, "Lendo as linhas")
        for r in range(header_index + 1, len(table.rows)):
            row = table.rows[r]

            def cell(field_name: str) -> str:
                i = mapping.get(field_name)
                return (row[i].strip() if i is not None and i < len(row) else "")

            raw_value = cell("value")
            raw_unit = cell("perUnit")
            if not raw_value and not raw_unit:
                continue

            value = _parse_number(raw_value)
            if value is None or value <= 0:
                rejected.append({"rowIndex": r + 1, "raw": row, "field": "value",
                                 "reason": f'Indice "{raw_value}" nao e um numero positivo reconhecivel.'})
                continue

            unit = UNIT_ALIASES.get(_norm(raw_unit))
            if not unit:
                rejected.append({"rowIndex": r + 1, "raw": row, "field": "perUnit",
                                 "reason": f'Unidade "{raw_unit}" nao esta no registro de unidades. Nenhuma unidade parecida foi assumida.'})
                continue

            basis = BASIS_ALIASES.get(_norm(cell("basis"))) or declared_basis
            if not basis:
                rejected.append({"rowIndex": r + 1, "raw": row, "field": "basis",
                                 "reason": 'Base do indice ausente (orcado, planejado, observado ou projetado) e nao declarada na importacao.'})
                continue

            source_date = _parse_date(cell("sourceDate")) or declared_date
            if not source_date:
                rejected.append({"rowIndex": r + 1, "raw": row, "field": "sourceDate",
                                 "reason": "Data da fonte ausente e nao declarada na importacao."})
                continue

            description = cell("description") or cell("code")
            if not description:
                rejected.append({"rowIndex": r + 1, "raw": row, "field": "description",
                                 "reason": "Linha sem servico identificado."})
                continue

            candidates.append({
                "code": cell("code") or f"IDX-PDF-{len(candidates) + 1:03d}",
                "description": description,
                "value": value,
                "perUnit": unit,
                "basis": basis,
                "sourceDate": source_date,
                "row": r + 1,
                # Tabela lida de PDF por agrupamento de coordenadas e menos confiavel
                # que uma planilha: o teto de confianca reflete isso.
                "confidence": 0.6,
            })

    on_progress(85, "Gravando os candidatos")
    with conn.cursor() as cur:
        cur.execute('SELECT code FROM "ProductivityIndex" WHERE "projectId" = %s', (project_id,))
        existing = {r["code"] for r in cur.fetchall()}

        created = 0
        for c in candidates:
            code = c["code"]
            if code in existing:
                n = 2
                while f"{code}-{n}" in existing:
                    n += 1
                code = f"{code}-{n}"
            existing.add(code)

            cur.execute(
                'INSERT INTO "ProductivityIndex" '
                '(id, "projectId", code, description, value, "perUnit", basis, source, "sourceDate", '
                '"approvalStatus", confidence, "importId", "importRow", "updatedAt") '
                "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())",
                (
                    new_id(), project_id, code, c["description"], c["value"], c["perUnit"], c["basis"],
                    f'Importado de {file_name} (tabela em PDF, pagina {table.page})',
                    c["sourceDate"], "PENDING", c["confidence"], import_id, c["row"],
                ),
            )
            created += 1

        cur.execute(
            'UPDATE "ProductivityImport" SET status = %s, "statusMessage" = %s, '
            '"candidatesCount" = %s, "rejectedCount" = %s, "rejectedRows" = %s, warnings = %s '
            "WHERE id = %s",
            (
                "DONE" if created > 0 else "PARTIAL",
                None if created > 0 else "Nenhum indice foi lido do PDF. Veja os avisos.",
                created, len(rejected), json.dumps(rejected), warnings, import_id,
            ),
        )
        cur.execute(
            'INSERT INTO "AuditLog" (id, "projectId", action, entity, "entityId", after) VALUES (%s,%s,%s,%s,%s,%s)',
            (
                new_id(), project_id, "PRODUCTIVITY_IMPORTED_FROM_PDF", "ProductivityImport", import_id,
                json.dumps({"imported": created, "rejected": len(rejected), "page": table.page, "warnings": warnings}),
            ),
        )
        if warnings:
            cur.execute(
                'INSERT INTO "OpenIssue" (id, "projectId", scope, description, severity, status) VALUES (%s,%s,%s,%s,%s,%s)',
                (new_id(), project_id, f"productivity.{import_id}", " | ".join(warnings)[:2000], "MEDIUM", "OPEN"),
            )

    conn.commit()
    on_progress(100, "Concluido")
    return {"imported": created, "rejected": len(rejected), "page": table.page, "warnings": warnings}
