"""Reconhecedores compartilhados entre extratores de tubulacao."""
from __future__ import annotations

import re
from typing import Optional

# Numero de linha industrial. Cobre os formatos usuais:
#   10"-P-1201-A1A   |   10-P-1201-A1A   |   DN250-P-1201-A1A   |   P-1201-10"-A1A
LINE_NUMBER_PATTERNS = [
    re.compile(r'\b(\d{1,2}(?:\s*\d/\d)?)\s*"?\s*-\s*([A-Z]{1,3})\s*-\s*(\d{3,5})\s*-\s*([A-Z0-9]{2,6})\b'),
    re.compile(r'\bDN\s*(\d{2,4})\s*-\s*([A-Z]{1,3})\s*-\s*(\d{3,5})\s*-\s*([A-Z0-9]{2,6})\b'),
]

REV_PATTERNS = [
    re.compile(r"\bREV(?:IS[AÃ]O|ISION)?\.?\s*[:\-]?\s*([0-9]{1,2}|[A-Z]{1,2})\b", re.IGNORECASE),
    re.compile(r"\bREV\s*([0-9]{1,2}|[A-Z]{1,2})\b", re.IGNORECASE),
]

DOC_NUMBER_PATTERNS = [
    re.compile(r"\b([A-Z]{2,5}[-.][0-9]{2,3}[-.][0-9]{2,5}(?:[-.][A-Z0-9]{1,5})?)\b"),
    re.compile(r"\b([A-Z]{2,4}\s?-\s?[A-Z0-9]{2,6}\s?-\s?[0-9]{3,6})\b"),
]

# Fracoes e diametros em polegada.
DN_TABLE = {
    "15": 0.5, "20": 0.75, "25": 1.0, "32": 1.25, "40": 1.5, "50": 2.0, "65": 2.5,
    "80": 3.0, "90": 3.5, "100": 4.0, "125": 5.0, "150": 6.0, "200": 8.0, "250": 10.0,
    "300": 12.0, "350": 14.0, "400": 16.0, "450": 18.0, "500": 20.0, "600": 24.0,
    "650": 26.0, "700": 28.0, "750": 30.0, "800": 32.0, "900": 36.0, "1000": 40.0, "1200": 48.0,
}


def parse_diameter_inches(label: Optional[str]) -> Optional[float]:
    """Devolve None quando nao ha certeza. Chutar diametro falsifica polegada-diametro."""
    if not label:
        return None
    s = str(label).strip().upper().replace(",", ".")

    m = re.fullmatch(r"DN\s*(\d{2,4})", s)
    if m:
        return DN_TABLE.get(m.group(1))

    m = re.fullmatch(r'(\d+)\s+(\d+)/(\d+)\s*(?:"|IN|POL)?', s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))

    m = re.fullmatch(r'(\d+)/(\d+)\s*(?:"|IN|POL)?', s)
    if m:
        return int(m.group(1)) / int(m.group(2))

    m = re.fullmatch(r'(\d+(?:\.\d+)?)\s*(?:"|IN|POL)', s)
    if m:
        return float(m.group(1))

    m = re.fullmatch(r"(\d{1,4})", s)
    if m:
        n = float(m.group(1))
        if n <= 48:
            return n
        return DN_TABLE.get(m.group(1))
    return None


def find_line_numbers(text: str) -> list[tuple[str, Optional[float]]]:
    """Devolve (numero_da_linha, DN_em_polegadas) para cada ocorrencia distinta."""
    found: dict[str, Optional[float]] = {}
    for pattern in LINE_NUMBER_PATTERNS:
        for m in pattern.finditer(text):
            raw = m.group(0).strip()
            normalized = re.sub(r"\s+", "", raw)
            size = m.group(1)
            dn = parse_diameter_inches(f"DN{size}" if pattern is LINE_NUMBER_PATTERNS[1] else size)
            found.setdefault(normalized, dn)
    return list(found.items())


def find_revision(text: str) -> Optional[str]:
    for p in REV_PATTERNS:
        m = p.search(text)
        if m:
            return m.group(1).upper()
    return None


def find_document_number(text: str, file_name: str) -> Optional[str]:
    # O nome do arquivo costuma ser mais confiavel que o corpo do desenho.
    for source in (file_name, text):
        for p in DOC_NUMBER_PATTERNS:
            m = p.search(source.upper())
            if m:
                return m.group(1).replace(" ", "")
    return None
