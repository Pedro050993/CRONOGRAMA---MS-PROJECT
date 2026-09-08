"""
Adaptador de IA generativa.

Regras que o adaptador impoe, independentemente do provedor:
  1. Toda resposta precisa citar o trecho de evidencia. Sem trecho, o valor e descartado.
  2. A saida entra sempre como AI_INFERENCE com reviewStatus PENDING.
  3. Sem provedor configurado, o worker usa apenas regras deterministicas.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional, Protocol


@dataclass
class LlmField:
    name: str
    value: Any
    evidence_span: Optional[str]
    confidence: float


class LlmUnavailable(RuntimeError):
    def __init__(self, provider: str) -> None:
        super().__init__(
            f'Nenhum provedor de IA configurado (LLM_PROVIDER="{provider}"). '
            "A extracao usou apenas regras deterministicas."
        )


class LlmAdapter(Protocol):
    name: str

    def available(self) -> bool: ...

    def extract(self, instruction: str, text: str, schema: dict[str, str]) -> list[LlmField]: ...


class NullLlm:
    name = "none"

    def available(self) -> bool:
        return False

    def extract(self, instruction: str, text: str, schema: dict[str, str]) -> list[LlmField]:
        raise LlmUnavailable(self.name)


def drop_unevidenced(fields: list[LlmField], source_text: str) -> tuple[list[LlmField], list[str]]:
    """
    Descarta campos sem trecho de evidencia ou cujo trecho nao existe no texto de origem.
    Um modelo que "lembra" de um valor sem poder aponta-lo no documento esta inventando.
    """
    kept: list[LlmField] = []
    dropped: list[str] = []
    for f in fields:
        if not f.evidence_span or f.evidence_span.strip() not in source_text:
            dropped.append(
                f'Campo "{f.name}" descartado: a IA nao apontou trecho verificavel no documento.'
            )
            continue
        kept.append(f)
    return kept, dropped


def build_llm(provider: str, endpoint: str, api_key: str, model: str) -> LlmAdapter:
    # Provedores reais entram aqui quando configurados. O padrao e nao usar IA.
    return NullLlm()
