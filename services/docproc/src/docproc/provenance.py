"""
Tipos de proveniencia — espelho do modelo do pacote `core`.

Motivo de existir em Python tambem: o worker e quem CRIA a informacao extraida.
Se ele puder produzir um valor sem evidencia, toda a garantia do sistema cai aqui.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Optional

DataClass = Literal[
    "EXTRACTED_FACT", "USER_INPUT", "AI_INFERENCE", "PLANNING_ASSUMPTION",
    "CONFIGURABLE_RULE", "PENDING_INFO", "SOURCE_CONFLICT",
]

ExtractionMethod = Literal[
    "PDF_VECTOR_TEXT", "OCR", "TABLE_PARSER", "REGEX_RULE", "LLM",
    "CAD_ATTRIBUTE", "MODEL_PROPERTY", "MANUAL_ENTRY", "COMPUTED",
]


@dataclass
class Evidence:
    """Localizacao exata que sustenta um valor. Sem isso, nao ha fato."""
    page: Optional[int] = None
    sheet: Optional[str] = None
    bbox: Optional[tuple[float, float, float, float]] = None
    snippet: Optional[str] = None
    method: ExtractionMethod = "PDF_VECTOR_TEXT"
    confidence: float = 0.0


class ProvenanceError(ValueError):
    pass


@dataclass
class Extracted:
    """Valor extraido com sua origem. `value=None` significa pendencia, nao zero."""
    value: Any
    data_class: DataClass
    method: ExtractionMethod
    confidence: float
    evidence: list[Evidence] = field(default_factory=list)
    note: Optional[str] = None

    def __post_init__(self) -> None:
        if self.data_class in ("EXTRACTED_FACT", "AI_INFERENCE"):
            if not self.evidence:
                raise ProvenanceError(
                    f"{self.data_class} exige evidencia de origem. Valor recebido: {self.value!r}"
                )
            if not 0.0 <= self.confidence <= 1.0:
                raise ProvenanceError(f"Confianca fora de 0..1: {self.confidence}")


def pending(reason: str, evidence: Optional[list[Evidence]] = None) -> Extracted:
    """A unica forma legitima de "nao saber": pendencia declarada."""
    return Extracted(
        value=None, data_class="PENDING_INFO", method="MANUAL_ENTRY",
        confidence=0.0, evidence=evidence or [], note=reason,
    )
