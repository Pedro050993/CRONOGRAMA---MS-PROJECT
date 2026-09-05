"""
Extração de tabela de produtividade a partir de PDF.

Tabela em PDF não tem célula: tem texto posicionado. Este módulo agrupa por
coordenada Y (linha) e por faixa de X (coluna), usando as posições reais das
palavras. Onde o agrupamento não é confiável, a linha sai como estava e o
importador do `core` a recusa com motivo — nada é adivinhado aqui.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import fitz

from ..pdf.extract import Document


@dataclass
class TableExtraction:
    rows: list[list[str]] = field(default_factory=list)
    page: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
    method: str = "WORD_CLUSTERING"


# Duas palavras na mesma linha quando o topo difere menos que isto (em pontos).
ROW_TOLERANCE = 3.5
# Coluna nova quando o vão horizontal entre palavras passa disto.
COLUMN_GAP = 12.0


def extract_table_from_pdf(data: bytes, page_hint: Optional[int] = None) -> TableExtraction:
    """
    Devolve as linhas da página que mais se parece com uma tabela.

    "Mais se parece" = maior número de linhas com pelo menos três colunas. Não é
    uma escolha inteligente; é uma heurística declarada. Se ela errar, o usuário
    indica a página na importação.
    """
    doc = fitz.open(stream=data, filetype="pdf")
    best: TableExtraction = TableExtraction(warnings=["Nenhuma tabela reconhecida no PDF."])
    best_score = 0

    pages = [page_hint - 1] if page_hint else range(doc.page_count)
    for index in pages:
        if index < 0 or index >= doc.page_count:
            continue
        page = doc.load_page(index)
        words = page.get_text("words") or []
        if not words:
            continue

        rows = _cluster_words(words)
        score = sum(1 for r in rows if len(r) >= 3)
        if score > best_score:
            best_score = score
            best = TableExtraction(rows=rows, page=index + 1, warnings=[])

    doc.close()

    if best_score == 0:
        best.warnings = [
            "Nenhuma estrutura tabular foi reconhecida neste PDF. "
            "Se a tabela existe mas e uma imagem digitalizada, e preciso OCR configurado. "
            "Nenhuma linha foi inventada."
        ]
    elif best_score < 3:
        best.warnings.append(
            f"Apenas {best_score} linha(s) com tres ou mais colunas foram reconhecidas. "
            "Confira o resultado contra o original antes de aprovar."
        )
    return best


def _cluster_words(words: list) -> list[list[str]]:
    """Agrupa palavras (x0, y0, x1, y1, texto, ...) em linhas e colunas."""
    items = [
        {"x0": float(w[0]), "y0": float(w[1]), "x1": float(w[2]), "text": str(w[4]).strip()}
        for w in words
        if str(w[4]).strip()
    ]
    items.sort(key=lambda w: (round(w["y0"], 1), w["x0"]))

    lines: list[list[dict]] = []
    for item in items:
        if lines and abs(lines[-1][0]["y0"] - item["y0"]) <= ROW_TOLERANCE:
            lines[-1].append(item)
        else:
            lines.append([item])

    rows: list[list[str]] = []
    for line in lines:
        line.sort(key=lambda w: w["x0"])
        cells: list[str] = []
        current = line[0]["text"]
        previous_end = line[0]["x1"]
        for word in line[1:]:
            if word["x0"] - previous_end > COLUMN_GAP:
                cells.append(current)
                current = word["text"]
            else:
                current = f"{current} {word['text']}"
            previous_end = word["x1"]
        cells.append(current)
        rows.append(cells)
    return rows


def rows_from_document(doc: Document) -> list[list[str]]:
    """Alternativa quando já se tem o Document extraído: divide por linha de texto."""
    rows: list[list[str]] = []
    for page in doc.pages:
        for block in page.blocks:
            for raw in block.text.splitlines():
                if not raw.strip():
                    continue
                cells = [c.strip() for c in raw.split("  ") if c.strip()]
                if cells:
                    rows.append(cells)
    return rows
