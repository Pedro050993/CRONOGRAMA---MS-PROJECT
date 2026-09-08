"""Gera PDFs de teste com camada de texto, sem depender de arquivo externo."""
from __future__ import annotations

import fitz


def make_pdf(pages: list[str], font_size: int = 9) -> bytes:
    doc = fitz.open()
    for content in pages:
        page = doc.new_page(width=842, height=595)  # A4 paisagem, formato de prancha
        y = 40
        for line in content.splitlines():
            page.insert_text((40, y), line, fontsize=font_size, fontname="cour")
            y += font_size + 3
        # Carimbo no canto inferior direito, como em prancha real.
    data = doc.tobytes()
    doc.close()
    return data


def make_scanned_pdf() -> bytes:
    """PDF cuja pagina e apenas uma imagem — sem camada de texto."""
    doc = fitz.open()
    page = doc.new_page(width=842, height=595)
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 842, 595))
    pix.clear_with(220)
    page.insert_image(fitz.Rect(0, 0, 842, 595), pixmap=pix)
    data = doc.tobytes()
    doc.close()
    return data


LINE_LIST_TEXT = """LISTA DE LINHAS - LINE LIST
DOCUMENTO: CPM-20.501   REV. B
LINE NO           SERVICE        CLASS   SCHEDULE   FROM        TO
10"-P-1201-A1A    PROPILENO      A1A     SCH 40     V-101       P-201A
8"-P-1202-A1A     PROPILENO      A1A     SCH 40     P-201A      E-301
6"-P-1203-A1A     AGUA           A1A     STD        E-301       TQ-401
4"-P-1204-B2B     VAPOR                             TQ-401      V-101
"""

ISOMETRIC_TEXT = """PIPING ISOMETRIC DRAWING
DWG CPM-20.701   REV. C   SPOOL: SP-0114   TEST PACK: TP-0007
LINE 10"-P-1201-A1A
WELD MAP: FW-01  FW-02  FW-03  SW-04  W-005
MATERIAL LIST
1   6.0    PIPE SMLS ASTM A106 GR B      10"
2   4      ELBOW 90 LR BW A234 WPB       10"
3   2      FLANGE WN RF 300#             10"
4   1      GATE VALVE 300#               10"
"""


PRODUCTIVITY_TABLE_TEXT = """BASE DE PRODUTIVIDADE - TUBULACAO
Emitida em 15/01/2026

Codigo        Servico                        Indice     Unidade    Base         Data
IDX-MONT      Montagem de tubulacao          0,90       in-dia     Orcado       15/01/2026
IDX-SOLD      Soldagem carbono               1,40       in-dia     Historico    15/01/2026
IDX-SUP       Instalacao de suporte          4,50       un         Observado    15/01/2026
IDX-RUIM      Servico com unidade estranha   2,00       vara       Orcado       15/01/2026
"""


def make_productivity_pdf() -> bytes:
    """PDF com a tabela posicionada em colunas, como uma base real emitida em PDF."""
    import fitz

    doc = fitz.open()
    page = doc.new_page(width=842, height=595)
    columns = [40, 150, 400, 480, 570, 680]
    rows = [
        ["Codigo", "Servico", "Indice", "Unidade", "Base", "Data"],
        ["IDX-MONT", "Montagem de tubulacao", "0,90", "in-dia", "Orcado", "15/01/2026"],
        ["IDX-SOLD", "Soldagem carbono", "1,40", "in-dia", "Historico", "15/01/2026"],
        ["IDX-SUP", "Instalacao de suporte", "4,50", "un", "Observado", "15/01/2026"],
        ["IDX-RUIM", "Servico estranho", "2,00", "vara", "Orcado", "15/01/2026"],
    ]
    page.insert_text((40, 40), "BASE DE PRODUTIVIDADE - TUBULACAO", fontsize=11, fontname="cour")
    y = 80
    for row in rows:
        for x, cell in zip(columns, row):
            page.insert_text((x, y), cell, fontsize=9, fontname="cour")
        y += 20
    data = doc.tobytes()
    doc.close()
    return data
