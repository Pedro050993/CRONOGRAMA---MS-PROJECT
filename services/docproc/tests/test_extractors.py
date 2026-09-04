import pytest

from docproc.extractors.common import find_document_number, find_line_numbers, find_revision, parse_diameter_inches
from docproc.extractors.isometric import extract_isometric
from docproc.extractors.line_list import extract_line_list
from docproc.pdf.extract import extract_pdf
from docproc.adapters.ocr import NullOcr

from fixtures import ISOMETRIC_TEXT, LINE_LIST_TEXT, make_pdf


class TestReconhecedores:
    def test_diametro_em_formatos_usuais(self):
        assert parse_diameter_inches('6"') == 6
        assert parse_diameter_inches("DN150") == 6
        assert parse_diameter_inches('1 1/2"') == 1.5
        assert parse_diameter_inches('3/4"') == 0.75
        assert parse_diameter_inches("600") == 24

    def test_devolve_none_em_vez_de_chutar(self):
        assert parse_diameter_inches("??") is None
        assert parse_diameter_inches("") is None
        assert parse_diameter_inches(None) is None

    def test_numero_de_linha_e_revisao(self):
        linhas = dict(find_line_numbers(LINE_LIST_TEXT))
        assert '10"-P-1201-A1A' in linhas
        assert linhas['10"-P-1201-A1A'] == 10
        assert find_revision(LINE_LIST_TEXT) == "B"
        assert find_document_number(LINE_LIST_TEXT, "arquivo.pdf") == "CPM-20.501"


class TestListaDeLinhas:
    @pytest.fixture()
    def doc(self):
        return extract_pdf(make_pdf([LINE_LIST_TEXT]), NullOcr())

    def test_extrai_as_quatro_linhas(self, doc):
        registros = extract_line_list(doc)
        numeros = sorted(r.line_number for r in registros)
        assert len(registros) == 4
        assert '10"-P-1201-A1A' in numeros

    def test_cada_registro_carrega_evidencia_com_pagina_e_regiao(self, doc):
        for r in extract_line_list(doc):
            assert r.evidence.page == 1
            assert r.evidence.bbox is not None
            assert r.evidence.snippet

    def test_campo_ausente_vira_PENDENCIA_e_derruba_a_confianca(self, doc):
        registros = {r.line_number: r for r in extract_line_list(doc)}
        vapor = registros['4"-P-1204-B2B']
        completa = registros['10"-P-1201-A1A']
        assert "schedule" in vapor.missing
        assert vapor.schedule is None            # nao herdou "STD" da linha anterior
        assert vapor.confidence < completa.confidence

    def test_nao_inventa_classe_nem_servico(self, doc):
        for r in extract_line_list(doc):
            if r.pipe_class is not None:
                assert r.pipe_class in LINE_LIST_TEXT
            if r.service is not None:
                assert r.service in LINE_LIST_TEXT.upper()


class TestIsometrico:
    @pytest.fixture()
    def iso(self):
        doc = extract_pdf(make_pdf([ISOMETRIC_TEXT]), NullOcr())
        return extract_isometric(doc, "CPM-20.701_RC.pdf")

    def test_le_carimbo_linha_spool_e_test_pack(self, iso):
        assert iso.document_number == "CPM-20.701"
        assert iso.revision == "C"
        assert iso.line_number == '10"-P-1201-A1A'
        assert iso.spool_id == "SP-0114"
        assert iso.test_pack_id == "TP-0007"
        assert iso.nominal_diameter_in == 10

    def test_conta_juntas_apenas_pelas_marcacoes_lidas(self, iso):
        assert iso.joint_count == 5
        assert set(iso.joint_tags) == {"FW-01", "FW-02", "FW-03", "SW-04", "W-005"}

    def test_extrai_a_lista_de_materiais_com_evidencia(self, iso):
        assert len(iso.mto) == 4
        tubo = next(i for i in iso.mto if "PIPE" in i.description)
        assert tubo.qty == 6.0
        assert tubo.nominal_diameter_in == 10
        assert tubo.evidence.page == 1
        assert tubo.evidence.bbox is not None

    def test_sem_marcacao_de_junta_NAO_infere_contagem(self):
        texto = ISOMETRIC_TEXT.replace("WELD MAP: FW-01  FW-02  FW-03  SW-04  W-005", "")
        doc = extract_pdf(make_pdf([texto]), NullOcr())
        iso = extract_isometric(doc, "x.pdf")
        assert iso.joint_count is None
        assert "jointCount" in iso.missing
        assert any("NAO foi inferida" in w for w in iso.warnings)

    def test_sem_lista_de_materiais_avisa_em_vez_de_completar(self):
        texto = ISOMETRIC_TEXT.split("MATERIAL LIST")[0]
        doc = extract_pdf(make_pdf([texto]), NullOcr())
        iso = extract_isometric(doc, "x.pdf")
        assert iso.mto == []
        assert any("NAO foi extraido" in w for w in iso.warnings)
