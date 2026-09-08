"""
Extracao de PDF (§6.1).

Ordem obrigatoria: detectar a natureza da pagina, extrair o vetorial disponivel e
so entao aplicar OCR onde faltou texto. Rodar OCR sobre pagina vetorial degrada a
qualidade e destroi as coordenadas boas que ja existiam.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

import fitz  # PyMuPDF

from ..adapters.ocr import OcrAdapter, OcrUnavailable

PageKind = Literal["VECTOR", "SCANNED", "MIXED", "UNKNOWN"]


@dataclass
class TextBlock:
    text: str
    bbox: tuple[float, float, float, float]
    method: Literal["PDF_VECTOR_TEXT", "OCR"] = "PDF_VECTOR_TEXT"
    confidence: float = 1.0


@dataclass
class Page:
    number: int
    width: float
    height: float
    kind: PageKind
    blocks: list[TextBlock] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    image_area_ratio: float = 0.0
    char_count: int = 0

    @property
    def text(self) -> str:
        return "\n".join(b.text for b in self.blocks)


@dataclass
class Document:
    pages: list[Page]
    page_count: int
    warnings: list[str] = field(default_factory=list)
    title: Optional[str] = None


# Abaixo deste numero de caracteres a pagina nao tem texto util para trabalhar.
MIN_CHARS_FOR_VECTOR = 40


def classify_page(page: "fitz.Page") -> tuple[PageKind, float, int]:
    """Decide se a pagina e vetorial, digitalizada ou mista, com base em texto x area de imagem."""
    text = page.get_text("text") or ""
    char_count = len(text.strip())
    page_area = max(1.0, page.rect.width * page.rect.height)
    image_area = 0.0
    for img in page.get_images(full=True):
        try:
            for rect in page.get_image_rects(img[0]):
                image_area += rect.width * rect.height
        except Exception:
            continue
    ratio = min(1.0, image_area / page_area)

    if char_count >= MIN_CHARS_FOR_VECTOR and ratio < 0.5:
        return "VECTOR", ratio, char_count
    if char_count >= MIN_CHARS_FOR_VECTOR and ratio >= 0.5:
        return "MIXED", ratio, char_count
    if ratio > 0.2:
        return "SCANNED", ratio, char_count
    return "UNKNOWN", ratio, char_count


def extract_pdf(data: bytes, ocr: OcrAdapter, languages: str = "por+eng", ocr_dpi: int = 200) -> Document:
    doc = fitz.open(stream=data, filetype="pdf")
    pages: list[Page] = []
    warnings: list[str] = []

    for index in range(doc.page_count):
        fpage = doc.load_page(index)
        kind, ratio, chars = classify_page(fpage)
        page = Page(
            number=index + 1,
            width=float(fpage.rect.width),
            height=float(fpage.rect.height),
            kind=kind,
            image_area_ratio=round(ratio, 4),
            char_count=chars,
        )

        # 1) Vetorial primeiro, sempre que houver.
        if kind in ("VECTOR", "MIXED"):
            for block in fpage.get_text("blocks") or []:
                x0, y0, x1, y1, text = block[0], block[1], block[2], block[3], block[4]
                text = (text or "").strip()
                if not text:
                    continue
                page.blocks.append(
                    TextBlock(text=text, bbox=(float(x0), float(y0), float(x1), float(y1)))
                )

        # 2) OCR apenas onde faltou texto.
        needs_ocr = kind in ("SCANNED", "UNKNOWN") or (kind == "MIXED" and chars < MIN_CHARS_FOR_VECTOR * 3)
        if needs_ocr:
            if not ocr.available():
                msg = (
                    f"Pagina {page.number} classificada como {kind} e nao possui texto vetorial suficiente. "
                    "Nenhum provedor de OCR esta configurado, entao o conteudo NAO foi interpretado. "
                    "A pagina fica como pendencia."
                )
                page.warnings.append(msg)
                warnings.append(msg)
            else:
                try:
                    pix = fpage.get_pixmap(dpi=ocr_dpi)
                    result = ocr.recognize(pix.tobytes("png"), languages)
                    scale = 72.0 / ocr_dpi
                    for w in result.words:
                        page.blocks.append(
                            TextBlock(
                                text=w.text,
                                bbox=(
                                    w.bbox[0] * scale, w.bbox[1] * scale,
                                    w.bbox[2] * scale, w.bbox[3] * scale,
                                ),
                                method="OCR",
                                confidence=w.confidence,
                            )
                        )
                    if not result.words:
                        page.warnings.append(
                            f"Pagina {page.number}: OCR nao reconheceu nenhum texto. Conteudo ilegivel."
                        )
                except OcrUnavailable as e:
                    page.warnings.append(str(e))
                    warnings.append(str(e))
                except Exception as e:  # falha do provedor nao pode virar pagina vazia silenciosa
                    msg = f"Pagina {page.number}: OCR falhou ({e}). Conteudo NAO interpretado."
                    page.warnings.append(msg)
                    warnings.append(msg)

        if not page.blocks:
            page.warnings.append(
                f"Pagina {page.number} sem nenhum texto extraido. Nao ha base para afirmar seu conteudo."
            )
        pages.append(page)

    meta_title = (doc.metadata or {}).get("title") or None
    doc.close()
    return Document(pages=pages, page_count=len(pages), warnings=warnings, title=meta_title)


def extract_image(data: bytes, ocr: OcrAdapter, languages: str = "por+eng") -> Document:
    """
    Imagem (§6.2). O original nunca e alterado; o pre-processamento acontece
    sobre uma copia em memoria.
    """
    from PIL import Image
    import io

    img = Image.open(io.BytesIO(data))
    width, height = img.size
    page = Page(number=1, width=float(width), height=float(height), kind="SCANNED")

    if not ocr.available():
        msg = (
            "Imagem recebida, mas nenhum provedor de OCR esta configurado. "
            "O arquivo foi armazenado integro e NAO foi interpretado."
        )
        page.warnings.append(msg)
        return Document(pages=[page], page_count=1, warnings=[msg])

    processed = _preprocess(img)
    buf = io.BytesIO()
    processed.save(buf, format="PNG")
    try:
        result = ocr.recognize(buf.getvalue(), languages)
        for w in result.words:
            page.blocks.append(
                TextBlock(text=w.text, bbox=w.bbox, method="OCR", confidence=w.confidence)
            )
        if not result.words:
            page.warnings.append("OCR nao reconheceu texto na imagem. Conteudo ilegivel.")
    except Exception as e:
        page.warnings.append(f"OCR falhou na imagem ({e}). Conteudo NAO interpretado.")

    return Document(pages=[page], page_count=1)


def _preprocess(img):
    """Corrige o basico que atrapalha OCR de desenho: cor, contraste e ruido."""
    from PIL import ImageFilter, ImageOps

    out = img.convert("L")
    out = ImageOps.autocontrast(out)
    out = out.filter(ImageFilter.MedianFilter(size=3))
    return out
