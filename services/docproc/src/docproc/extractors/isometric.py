"""
Extrator de isometrico de tubulacao (§7.1).

Trabalha sobre o texto do desenho. O que este extrator NAO faz, deliberadamente:
nao infere conexao entre linhas por proximidade, nao deduz comprimento a partir da
escala e nao completa a lista de materiais com itens "tipicos".
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from ..pdf.extract import Document
from ..provenance import Evidence
from .common import find_document_number, find_line_numbers, find_revision, parse_diameter_inches

# Linha de MTO: item, quantidade, descricao, diametro.
MTO_ROW = re.compile(
    r"^\s*(\d{1,3})\s+(\d+(?:[.,]\d+)?)\s+(.{5,80}?)\s+"
    r'(DN\s*\d{2,4}|\d+\s+\d+/\d+\s*"?|\d+/\d+\s*"?|\d+(?:\.\d+)?\s*"?)\s*$',
    re.IGNORECASE,
)
# Marcacao de junta EXIGE identificador numerico. "BW" e "SW" soltos, em descricao
# de material ("ELBOW 90 LR BW"), sao tipo de extremidade, nao solda de campo:
# conta-los inflaria a polegada-diametro e, com ela, o HH de soldagem.
JOINT_TOKEN = re.compile(
    r"\b(?:(?:F|B|S)?W|J)\s*-\s*\d{1,4}\b|\b(?:SHOP|FIELD)\s*WELD\s*-?\s*\d{1,4}\b",
    re.IGNORECASE,
)
CUT_LENGTH = re.compile(r"\b(?:CUT\s*LENGTH|COMPRIMENTO)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(MM|M|IN)?\b", re.IGNORECASE)
SPOOL = re.compile(r"\bSPOOL\s*[:\-]?\s*([A-Z0-9\-]{2,20})\b", re.IGNORECASE)
TEST_PACK = re.compile(r"\b(?:TEST\s*PACK|TP)\s*[:\-]?\s*([A-Z0-9\-]{2,20})\b", re.IGNORECASE)


@dataclass
class MtoItem:
    item_no: str
    qty: float
    description: str
    nominal_diameter_in: Optional[float]
    evidence: Evidence
    confidence: float


@dataclass
class IsometricRecord:
    document_number: Optional[str]
    revision: Optional[str]
    line_number: Optional[str]
    nominal_diameter_in: Optional[float]
    spool_id: Optional[str]
    test_pack_id: Optional[str]
    joint_count: Optional[int]
    joint_tags: list[str] = field(default_factory=list)
    mto: list[MtoItem] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    confidence: float = 0.0
    evidence: Optional[Evidence] = None


def extract_isometric(doc: Document, file_name: str) -> IsometricRecord:
    full_text = "\n".join(p.text for p in doc.pages)
    first_page = doc.pages[0] if doc.pages else None

    document_number = find_document_number(full_text, file_name)
    revision = find_revision(full_text)

    lines = find_line_numbers(full_text)
    line_number = lines[0][0] if lines else None
    dn = lines[0][1] if lines else None

    spool = _first(SPOOL, full_text)
    test_pack = _first(TEST_PACK, full_text)

    joint_tags = sorted({m.group(0).upper().replace(" ", "") for m in JOINT_TOKEN.finditer(full_text)})
    joint_count = len(joint_tags) if joint_tags else None

    mto: list[MtoItem] = []
    for page in doc.pages:
        for block in page.blocks:
            for raw_line in block.text.splitlines():
                m = MTO_ROW.match(raw_line)
                if not m:
                    continue
                qty = float(m.group(2).replace(",", "."))
                item_dn = parse_diameter_inches(m.group(4))
                conf = 0.85 if block.method == "PDF_VECTOR_TEXT" else max(0.3, block.confidence)
                if item_dn is None:
                    conf = round(conf * 0.7, 3)
                mto.append(
                    MtoItem(
                        item_no=m.group(1), qty=qty, description=m.group(3).strip(),
                        nominal_diameter_in=item_dn, confidence=conf,
                        evidence=Evidence(
                            page=page.number, bbox=block.bbox, snippet=raw_line[:200],
                            method="PDF_VECTOR_TEXT" if block.method == "PDF_VECTOR_TEXT" else "OCR",
                            confidence=conf,
                        ),
                    )
                )

    missing = [
        name for name, value in (
            ("documentNumber", document_number), ("revision", revision),
            ("lineNumber", line_number), ("nominalDiameterIn", dn),
            ("spoolId", spool), ("testPackId", test_pack), ("jointCount", joint_count),
        ) if value is None
    ]

    warnings: list[str] = []
    if not mto:
        warnings.append(
            "Nenhuma linha de lista de materiais reconhecida neste isometrico. "
            "O quantitativo de materiais NAO foi extraido — nao ha base para afirma-lo."
        )
    if joint_count is None:
        warnings.append(
            "Nenhuma marcacao de junta reconhecida. A contagem de juntas NAO foi inferida "
            "a partir do numero de conexoes: isso exigiria supor a topologia do desenho."
        )

    base = 0.85 if first_page and first_page.kind in ("VECTOR", "MIXED") else 0.4
    confidence = round(max(0.15, base - 0.08 * len(missing)), 3)

    return IsometricRecord(
        document_number=document_number, revision=revision, line_number=line_number,
        nominal_diameter_in=dn, spool_id=spool, test_pack_id=test_pack,
        joint_count=joint_count, joint_tags=joint_tags, mto=mto,
        missing=missing, warnings=warnings, confidence=confidence,
        evidence=Evidence(
            page=1,
            bbox=first_page.blocks[0].bbox if first_page and first_page.blocks else None,
            snippet=full_text[:400], method="PDF_VECTOR_TEXT", confidence=confidence,
        ) if first_page else None,
    )


def _first(pattern: re.Pattern[str], text: str) -> Optional[str]:
    m = pattern.search(text)
    return m.group(1).upper() if m else None
