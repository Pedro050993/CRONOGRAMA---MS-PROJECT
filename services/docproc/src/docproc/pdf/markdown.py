"""
Geracao do Markdown rastreavel (§6.3).

O Markdown e representacao AUXILIAR para busca e leitura. Ele nao substitui a
geometria nem o documento original — e por isso cada bloco carrega uma ancora que
aponta de volta para a pagina e a regiao de onde veio.
"""
from __future__ import annotations

from .extract import Document, Page, TextBlock


def anchor(document_number: str, revision: str | None, page: int, block: TextBlock) -> str:
    x0, y0, x1, y1 = (round(v, 1) for v in block.bbox)
    rev = revision or "?"
    return (
        f"<!--@ doc={document_number} rev={rev} page={page} "
        f"bbox=[{x0},{y0},{x1},{y1}] method={block.method.lower()} conf={block.confidence:.2f} -->"
    )


def _looks_like_heading(text: str) -> bool:
    stripped = text.strip()
    return (
        0 < len(stripped) <= 80
        and "\n" not in stripped
        and stripped == stripped.upper()
        and any(c.isalpha() for c in stripped)
    )


def _looks_like_table_row(text: str) -> bool:
    line = text.strip()
    return line.count("  ") >= 2 or line.count("|") >= 2 or line.count("\t") >= 2


def page_to_markdown(page: Page, document_number: str, revision: str | None) -> str:
    parts: list[str] = [f"## Pagina {page.number}", ""]
    parts.append(
        f"<!--@ page={page.number} kind={page.kind} width={page.width:.0f} "
        f"height={page.height:.0f} chars={page.char_count} -->"
    )
    parts.append("")

    for w in page.warnings:
        parts.append(f"> **AVISO — conteudo nao interpretado:** {w}")
        parts.append("")

    if not page.blocks:
        parts.append("*(Nenhum texto extraido desta pagina. O conteudo permanece nao interpretado.)*")
        parts.append("")
        return "\n".join(parts)

    ordered = sorted(page.blocks, key=lambda b: (round(b.bbox[1], 1), round(b.bbox[0], 1)))
    for block in ordered:
        parts.append(anchor(document_number, revision, page.number, block))
        text = block.text.strip()
        if block.confidence < 0.6 and block.method == "OCR":
            parts.append(f"> **BAIXA CONFIANCA ({block.confidence:.0%})** — revisar contra o original.")
        if _looks_like_heading(text):
            parts.append(f"### {text}")
        elif _looks_like_table_row(text):
            parts.append("```text")
            parts.append(text)
            parts.append("```")
        else:
            parts.append(text)
        parts.append("")

    return "\n".join(parts)


def document_to_markdown(
    doc: Document,
    file_name: str,
    document_number: str,
    revision: str | None,
    doc_type: str,
    type_confidence: float,
) -> str:
    header = [
        f"# {file_name}",
        "",
        "| Metadado | Valor |",
        "| --- | --- |",
        f"| Numero do documento | {document_number} |",
        f"| Revisao | {revision or '(nao identificada)'} |",
        f"| Tipo sugerido | {doc_type} (confianca {type_confidence:.0%}) |",
        f"| Paginas | {doc.page_count} |",
        "",
        "> Este Markdown e uma representacao auxiliar para busca e leitura. "
        "Ele NAO substitui o documento original nem a geometria do desenho. "
        "Cada bloco carrega a ancora da regiao de origem.",
        "",
    ]
    if doc.warnings:
        header.append("## Avisos de processamento")
        header.append("")
        for w in doc.warnings:
            header.append(f"- {w}")
        header.append("")

    body = [page_to_markdown(p, document_number, revision) for p in doc.pages]
    return "\n".join(header + body)
