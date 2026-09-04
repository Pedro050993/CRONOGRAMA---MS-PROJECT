"""
Extrator de lista de linhas (§7.1).

Extrai apenas o que consegue localizar. Campo nao encontrado vira pendencia, nunca
valor herdado da linha anterior nem default de classe.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from ..pdf.extract import Document, TextBlock
from ..provenance import Evidence
from .common import find_line_numbers, parse_diameter_inches

CLASS_PATTERN = re.compile(r"\b([A-Z]\d{1,2}[A-Z]{1,2})\b")
SCHEDULE_PATTERN = re.compile(r"\b(SCH\s?\d{1,3}|STD|XS|XXS|S-?\d{2}S?)\b", re.IGNORECASE)
SERVICE_HINTS = [
    "PROPILENO", "PROPYLENE", "AMONIA", "AMMONIA", "VAPOR", "STEAM", "AGUA", "WATER",
    "AR COMPRIMIDO", "INSTRUMENT AIR", "NITROGENIO", "NITROGEN", "OLEO", "OIL", "GAS",
    "CONDENSADO", "CONDENSATE", "DRENO", "DRAIN",
]


@dataclass
class LineRecord:
    line_number: str
    nominal_diameter_in: Optional[float]
    pipe_class: Optional[str]
    schedule: Optional[str]
    service: Optional[str]
    confidence: float
    evidence: Evidence
    missing: list[str] = field(default_factory=list)


def extract_line_list(doc: Document) -> list[LineRecord]:
    records: dict[str, LineRecord] = {}

    for page in doc.pages:
        for block in page.blocks:
            # O extrator trabalha LINHA A LINHA, nao por bloco.
            # PyMuPDF costuma devolver a tabela inteira num unico bloco; procurar
            # classe e schedule no bloco todo faria uma linha herdar o dado da vizinha,
            # que e exatamente o tipo de invencao que este sistema nao pode cometer.
            for text in block.text.splitlines():
                if not text.strip():
                    continue
                for line_number, dn_from_tag in find_line_numbers(text):
                    if line_number in records:
                        continue
                    # Remove o proprio tag da linha antes de procurar classe:
                    # o sufixo do numero de linha (A1A) nao e evidencia de classe.
                    rest = text.replace(line_number, " ")
                    pipe_class = _first(CLASS_PATTERN, rest)
                    schedule = _first(SCHEDULE_PATTERN, rest)
                    service = next((s for s in SERVICE_HINTS if s in rest.upper()), None)
                    dn = dn_from_tag if dn_from_tag is not None else _diameter_near(rest)

                    missing = [
                        name for name, value in (
                            ("nominalDiameterIn", dn), ("pipeClass", pipe_class),
                            ("schedule", schedule), ("service", service),
                        ) if value is None
                    ]

                    # A confianca cai com o numero de campos que nao foram encontrados.
                    base = 0.9 if block.method == "PDF_VECTOR_TEXT" else max(0.3, block.confidence)
                    confidence = round(max(0.2, base - 0.1 * len(missing)), 3)

                    records[line_number] = LineRecord(
                        line_number=line_number,
                        nominal_diameter_in=dn,
                        pipe_class=pipe_class,
                        schedule=schedule.upper().replace(" ", "") if schedule else None,
                        service=service,
                        confidence=confidence,
                        evidence=Evidence(
                            page=page.number, bbox=block.bbox, snippet=text[:400],
                            method="PDF_VECTOR_TEXT" if block.method == "PDF_VECTOR_TEXT" else "OCR",
                            confidence=confidence,
                        ),
                        missing=missing,
                    )
    return list(records.values())


def _first(pattern: re.Pattern[str], text: str) -> Optional[str]:
    m = pattern.search(text)
    return m.group(1) if m else None


def _diameter_near(text: str) -> Optional[float]:
    for token in re.findall(r'(DN\s*\d{2,4}|\d+\s+\d+/\d+\s*"|\d+/\d+\s*"|\d+(?:\.\d+)?\s*")', text.upper()):
        dn = parse_diameter_inches(token)
        if dn is not None:
            return dn
    return None
