"""
Adaptador de OCR.

Contrato central: quando NAO ha provedor configurado, o worker NAO tenta adivinhar
o conteudo. Ele devolve `OcrUnavailable`, e a regiao vira pendencia visivel.
Silenciar isso seria o pior tipo de bug deste sistema: um desenho ilegivel virando
um cronograma com aparencia de completo.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol


@dataclass
class OcrWord:
    text: str
    bbox: tuple[float, float, float, float]
    confidence: float


@dataclass
class OcrResult:
    words: list[OcrWord]
    text: str
    provider: str
    confidence: float


class OcrUnavailable(RuntimeError):
    """Sinaliza ausencia de provedor. Nao e erro de processamento: e limitacao declarada."""

    def __init__(self, provider: str) -> None:
        super().__init__(
            f'Nenhum provedor de OCR utilizavel (OCR_PROVIDER="{provider}"). '
            "As regioes sem texto vetorial foram marcadas como pendencia e NAO foram interpretadas. "
            "Configure OCR_PROVIDER (ex.: tesseract) ou envie um PDF com camada de texto."
        )
        self.provider = provider


class OcrAdapter(Protocol):
    name: str

    def available(self) -> bool: ...

    def recognize(self, image_bytes: bytes, languages: str) -> OcrResult: ...


class NullOcr:
    """Padrao do sistema. Existe para tornar a ausencia de OCR explicita, nao implicita."""

    name = "none"

    def available(self) -> bool:
        return False

    def recognize(self, image_bytes: bytes, languages: str) -> OcrResult:
        raise OcrUnavailable(self.name)


class TesseractOcr:
    """Usa pytesseract quando instalado. Nunca e ativado por padrao."""

    name = "tesseract"

    def __init__(self) -> None:
        self._ok: Optional[bool] = None

    def available(self) -> bool:
        if self._ok is None:
            try:
                import pytesseract  # noqa: F401
                from PIL import Image  # noqa: F401

                pytesseract.get_tesseract_version()
                self._ok = True
            except Exception:
                self._ok = False
        return self._ok

    def recognize(self, image_bytes: bytes, languages: str) -> OcrResult:
        if not self.available():
            raise OcrUnavailable(self.name)
        import io

        import pytesseract
        from PIL import Image

        img = Image.open(io.BytesIO(image_bytes))
        data = pytesseract.image_to_data(img, lang=languages, output_type=pytesseract.Output.DICT)
        words: list[OcrWord] = []
        confs: list[float] = []
        for i, text in enumerate(data["text"]):
            text = (text or "").strip()
            if not text:
                continue
            conf = float(data["conf"][i])
            if conf < 0:
                continue
            words.append(
                OcrWord(
                    text=text,
                    bbox=(
                        float(data["left"][i]),
                        float(data["top"][i]),
                        float(data["left"][i] + data["width"][i]),
                        float(data["top"][i] + data["height"][i]),
                    ),
                    confidence=conf / 100.0,
                )
            )
            confs.append(conf / 100.0)
        return OcrResult(
            words=words,
            text=" ".join(w.text for w in words),
            provider=self.name,
            confidence=(sum(confs) / len(confs)) if confs else 0.0,
        )


def build_ocr(provider: str) -> OcrAdapter:
    if provider == "tesseract":
        t = TesseractOcr()
        return t if t.available() else NullOcr()
    # Provedores de nuvem entram aqui quando configurados; ate la, ausencia declarada.
    return NullOcr()
