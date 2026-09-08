"""Leitura de tabela de produtividade em PDF."""
from docproc.extractors.productivity_table import extract_table_from_pdf
from docproc.handlers.productivity_import import _detect_header, _parse_date, _parse_number

from fixtures import make_productivity_pdf, make_scanned_pdf


class TestReconhecimentoDeTabela:
    def test_reconhece_linhas_e_colunas_pela_posicao_das_palavras(self):
        t = extract_table_from_pdf(make_productivity_pdf())
        assert t.page == 1
        assert t.warnings == []
        # cabecalho + 4 linhas de dados
        com_colunas = [r for r in t.rows if len(r) >= 5]
        assert len(com_colunas) >= 5

    def test_o_cabecalho_e_localizado_pelas_colunas_de_indice_e_unidade(self):
        t = extract_table_from_pdf(make_productivity_pdf())
        idx, mapping = _detect_header(t.rows)
        assert idx >= 0
        assert "value" in mapping and "perUnit" in mapping
        assert "basis" in mapping

    def test_pagina_sem_tabela_avisa_em_vez_de_inventar_linhas(self):
        t = extract_table_from_pdf(make_scanned_pdf())
        assert t.rows == [] or all(len(r) < 3 for r in t.rows)
        assert any("Nenhuma" in w for w in t.warnings)
        assert any("nao foi inventada" in w or "Nenhuma linha foi inventada" in w for w in t.warnings)


class TestConversores:
    def test_numero_brasileiro_e_ingles(self):
        assert _parse_number("0,90") == 0.9
        assert _parse_number("1.234,56") == 1234.56
        assert _parse_number("4.5") == 4.5
        assert _parse_number("a definir") is None

    def test_data_iso_e_brasileira(self):
        assert _parse_date("15/01/2026") == "2026-01-15"
        assert _parse_date("2026-01-15") == "2026-01-15"
        assert _parse_date("janeiro/2026") is None
