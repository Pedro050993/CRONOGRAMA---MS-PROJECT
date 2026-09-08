"""
Classificacao documental por regras (§5, etapa 3).

A classificacao e SUGESTAO. Ela entra no banco como `suggestedType` com confianca,
e so vira fato quando um revisor confirma. O worker nunca preenche `confirmedType`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

DOC_TYPES = {
    "LINE_LIST": {
        "keywords": ["lista de linhas", "line list", "line designation", "listado de lineas"],
        "patterns": [r"\bLINE\s*(?:NO|N[ºO]|NUMBER)\b", r"\bLINHA\b.*\bSERVI[CÇ]O\b"],
        "weight": 1.0,
    },
    "PIPING_ISOMETRIC": {
        "keywords": ["isometric", "isometrico", "iso drawing", "spool", "cut length", "erection"],
        "patterns": [r"\bISOMETRIC\b", r"\bMATERIAL\s+LIST\b.*\bNPS\b", r"\bSPOOL\b", r"\bWELD\s*(?:NO|MAP)\b"],
        "weight": 1.0,
    },
    "PID": {
        "keywords": ["p&id", "piping and instrumentation", "fluxograma de engenharia"],
        "patterns": [r"\bP\s*&\s*ID\b", r"\bPIPING\s+AND\s+INSTRUMENT"],
        "weight": 1.0,
    },
    "PFD": {"keywords": ["process flow diagram", "fluxograma de processo"], "patterns": [r"\bPFD\b"], "weight": 0.9},
    "MATERIAL_LIST": {
        "keywords": ["material list", "bill of material", "lista de materiais", "mto"],
        "patterns": [r"\bBILL\s+OF\s+MATERIAL", r"\bM\.?T\.?O\.?\b"],
        "weight": 0.9,
    },
    "CABLE_LIST": {"keywords": ["cable list", "lista de cabos", "cable schedule"], "patterns": [r"\bCABLE\s+(?:LIST|SCHEDULE)\b"], "weight": 1.0},
    "INSTRUMENT_LIST": {"keywords": ["instrument list", "lista de instrumentos", "instrument index"], "patterns": [r"\bINSTRUMENT\s+(?:LIST|INDEX)\b"], "weight": 1.0},
    "SINGLE_LINE_DIAGRAM": {"keywords": ["single line", "diagrama unifilar", "unifilar"], "patterns": [r"\bUNIFILAR\b", r"\bSINGLE\s+LINE\b"], "weight": 1.0},
    "SUPPORT_DRAWING": {"keywords": ["support", "suporte", "caderno de suportes"], "patterns": [r"\bSUPPORT\s+(?:DETAIL|DRAWING)\b", r"\bSUPORTE\b"], "weight": 0.8},
    "STRUCTURAL_DRAWING": {"keywords": ["structural", "estrutura metalica", "steel structure"], "patterns": [r"\bSTRUCTURAL\b", r"\bESTRUTURA\b"], "weight": 0.8},
    "EQUIPMENT_LIST": {"keywords": ["equipment list", "lista de equipamentos"], "patterns": [r"\bEQUIPMENT\s+LIST\b"], "weight": 1.0},
    "DATASHEET": {"keywords": ["data sheet", "datasheet", "folha de dados"], "patterns": [r"\bDATA\s*SHEET\b"], "weight": 0.9},
    "PROCEDURE": {"keywords": ["procedimento", "procedure", "instrucao de trabalho"], "patterns": [r"\bPROCEDIMENTO\b", r"\bPROCEDURE\b"], "weight": 0.7},
    "INSPECTION_PLAN": {"keywords": ["plano de inspecao", "inspection test plan", "itp"], "patterns": [r"\bI\.?T\.?P\.?\b", r"\bPLANO\s+DE\s+INSPE"], "weight": 0.9},
    "COMMISSIONING_PLAN": {"keywords": ["comissionamento", "commissioning"], "patterns": [r"\bCOMISSIONAMENTO\b", r"\bCOMMISSIONING\b"], "weight": 0.8},
    "CONTRACT": {"keywords": ["contrato", "contract", "clausula"], "patterns": [r"\bCONTRATO\b", r"\bCL[AÁ]USULA\b"], "weight": 0.8},
    "SPECIFICATION": {"keywords": ["especificacao tecnica", "memorial descritivo", "specification"], "patterns": [r"\bESPECIFICA[CÇ][AÃ]O\b", r"\bMEMORIAL\b"], "weight": 0.8},
    "EXISTING_SCHEDULE": {"keywords": ["cronograma", "schedule", "gantt"], "patterns": [r"\bCRONOGRAMA\b"], "weight": 0.7},
}


@dataclass
class Classification:
    doc_type: str
    confidence: float
    reasons: list[str]
    runner_up: str | None = None


def classify(file_name: str, text: str) -> Classification:
    haystack = f"{file_name}\n{text}".upper()
    scores: dict[str, float] = {}
    reasons: dict[str, list[str]] = {}

    for doc_type, spec in DOC_TYPES.items():
        score = 0.0
        why: list[str] = []
        for kw in spec["keywords"]:
            if kw.upper() in haystack:
                score += 0.35 * float(spec["weight"])
                why.append(f'termo "{kw}" encontrado')
        for pat in spec["patterns"]:
            if re.search(pat, haystack, re.IGNORECASE):
                score += 0.4 * float(spec["weight"])
                why.append(f"padrao /{pat}/ encontrado")
        if score > 0:
            scores[doc_type] = min(0.95, score)
            reasons[doc_type] = why

    if not scores:
        return Classification(
            doc_type="UNCLASSIFIED", confidence=0.0,
            reasons=["Nenhum indicador reconhecido no nome do arquivo nem no texto extraido."],
        )

    ordered = sorted(scores.items(), key=lambda kv: kv[1], reverse=True)
    best, best_score = ordered[0]
    runner_up = ordered[1][0] if len(ordered) > 1 else None

    # Empate tecnico rebaixa a confianca: duas hipoteses fortes significam incerteza.
    if runner_up and abs(scores[runner_up] - best_score) < 0.15:
        best_score *= 0.7
        reasons[best].append(f'hipotese concorrente "{runner_up}" com pontuacao proxima')

    return Classification(
        doc_type=best, confidence=round(best_score, 3), reasons=reasons[best], runner_up=runner_up,
    )
