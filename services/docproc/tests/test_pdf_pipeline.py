import pytest

from docproc.adapters.ocr import NullOcr, OcrResult, OcrUnavailable, OcrWord, build_ocr
from docproc.classify import classify
from docproc.pdf.extract import extract_pdf
from docproc.pdf.markdown import document_to_markdown, page_to_markdown

from fixtures import ISOMETRIC_TEXT, LINE_LIST_TEXT, make_pdf, make_scanned_pdf


class FakeOcr:
    name = "fake"

    def available(self) -> bool:
        return True

    def recognize(self, image_bytes, languages):
        return OcrResult(
            words=[OcrWord(text="TEXTO", bbox=(10, 10, 60, 25), confidence=0.42)],
            text="TEXTO", provider=self.name, confidence=0.42,
        )


class TestDeteccaoDeNaturezaDaPagina:
    def test_pdf_com_camada_de_texto_e_VETORIAL_e_dispensa_OCR(self):
        doc = extract_pdf(make_pdf([LINE_LIST_TEXT]), NullOcr())
        assert doc.pages[0].kind == "VECTOR"
        assert doc.pages[0].blocks
        assert all(b.method == "PDF_VECTOR_TEXT" for b in doc.pages[0].blocks)
        assert doc.warnings == []

    def test_pdf_digitalizado_SEM_provedor_de_OCR_vira_pendencia_explicita(self):
        doc = extract_pdf(make_scanned_pdf(), NullOcr())
        page = doc.pages[0]
        assert page.kind in ("SCANNED", "UNKNOWN")
        assert page.blocks == []
        assert any("NAO foi interpretado" in w for w in page.warnings)
        assert doc.warnings, "a limitacao precisa subir para o nivel do documento"

    def test_pdf_digitalizado_COM_OCR_marca_baixa_confianca(self):
        doc = extract_pdf(make_scanned_pdf(), FakeOcr())
        page = doc.pages[0]
        assert page.blocks
        assert page.blocks[0].method == "OCR"
        assert page.blocks[0].confidence == pytest.approx(0.42)

    def test_adaptador_padrao_e_o_nulo_e_ele_falha_alto(self):
        ocr = build_ocr("none")
        assert ocr.available() is False
        with pytest.raises(OcrUnavailable) as exc:
            ocr.recognize(b"", "por")
        assert "NAO foram interpretadas" in str(exc.value)

    def test_provedor_inexistente_cai_para_o_nulo_em_vez_de_quebrar(self):
        assert build_ocr("provedor-que-nao-existe").available() is False


class TestMarkdownRastreavel:
    def test_cada_bloco_carrega_ancora_com_documento_pagina_e_regiao(self):
        doc = extract_pdf(make_pdf([LINE_LIST_TEXT]), NullOcr())
        md = page_to_markdown(doc.pages[0], "CPM-20.501", "B")
        assert "<!--@ doc=CPM-20.501 rev=B page=1 bbox=[" in md
        assert "method=pdf_vector_text" in md

    def test_markdown_do_documento_declara_que_nao_substitui_o_original(self):
        doc = extract_pdf(make_pdf([ISOMETRIC_TEXT]), NullOcr())
        md = document_to_markdown(doc, "CPM-20.701.pdf", "CPM-20.701", "C", "PIPING_ISOMETRIC", 0.9)
        assert "NAO substitui o documento original" in md
        assert "| Revisao | C |" in md

    def test_pagina_ilegivel_aparece_como_aviso_no_markdown_e_nao_em_branco(self):
        doc = extract_pdf(make_scanned_pdf(), NullOcr())
        md = page_to_markdown(doc.pages[0], "X", None)
        assert "AVISO — conteudo nao interpretado" in md
        assert "Nenhum texto extraido" in md

    def test_bloco_de_OCR_com_baixa_confianca_e_sinalizado(self):
        doc = extract_pdf(make_scanned_pdf(), FakeOcr())
        md = page_to_markdown(doc.pages[0], "X", "A")
        assert "BAIXA CONFIANCA" in md


class TestClassificacao:
    def test_reconhece_lista_de_linhas_e_isometrico(self):
        lista = classify("LISTA-DE-LINHAS.pdf", LINE_LIST_TEXT)
        assert lista.doc_type == "LINE_LIST"
        assert lista.confidence > 0.3
        assert lista.reasons

        iso = classify("CPM-20.701.pdf", ISOMETRIC_TEXT)
        assert iso.doc_type == "PIPING_ISOMETRIC"

    def test_documento_irreconhecivel_NAO_recebe_palpite(self):
        r = classify("arquivo.pdf", "conteudo generico sem nenhum indicador tecnico")
        assert r.doc_type == "UNCLASSIFIED"
        assert r.confidence == 0.0
        assert "Nenhum indicador reconhecido" in r.reasons[0]

    def test_empate_tecnico_rebaixa_a_confianca_em_vez_de_escolher_com_firmeza(self):
        ambiguo = classify("doc.pdf", "MATERIAL LIST\nBILL OF MATERIAL\nISOMETRIC\nSPOOL")
        assert ambiguo.runner_up is not None
        limpo = classify("doc.pdf", "ISOMETRIC\nSPOOL\nWELD MAP\nCUT LENGTH")
        assert ambiguo.confidence < limpo.confidence
