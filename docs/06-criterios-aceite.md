# 06 — Critérios de aceite (§20) e onde são verificados

| # | Critério | Verificação automatizada |
|---|---|---|
| 1 | Projeto e usuários com permissões distintas | `packages/api/test/rbac.test.ts` |
| 2 | Upload individual, múltiplo, pasta e ZIP | `packages/api/test/upload.test.ts` |
| 3 | Preservação da árvore de pastas | `packages/api/test/upload.test.ts` |
| 4 | Duplicata e nova revisão | `packages/core/test/revision.test.ts`, `api/test/upload.test.ts` |
| 5 | PDF/imagem → Markdown rastreável | `services/docproc/tests/test_pdf_pipeline.py` |
| 6 | Visualização lado a lado fonte × extração | `tests/e2e/validation.spec.ts` |
| 7 | Correção e aprovação humana | `packages/api/test/validation.test.ts` |
| 8 | Extração de entidades técnicas reais | `services/docproc/tests/test_extractors.py` |
| 9 | Quadro quantitativo sem dupla contagem | `packages/core/test/quantities.test.ts` |
| 10 | EAP editável | `packages/core/test/wbs.test.ts` |
| 11 | Mapa de controle editável | `packages/api/test/controlmap.test.ts` |
| 12 | Sequência com justificativa por vínculo | `packages/core/test/sequencing.test.ts` |
| 13 | Cronograma calculado a partir dos insumos | `packages/core/test/duration.test.ts` |
| 14 | Bloqueio da duração sem dados essenciais | `packages/core/test/duration.test.ts` |
| 15 | Atualização colaborativa visível a outro usuário | `packages/api/test/sse.test.ts` |
| 16 | Histórico e auditoria | `packages/api/test/audit.test.ts` |
| 17 | Análise de impacto de nova revisão | `packages/core/test/revision.test.ts` |
| 18 | XML validado para MS Project 2016 | `packages/core/test/mspdi.test.ts` |
| 19 | Mensagem clara para DWG/NWD não convertido | `packages/core/test/formats.test.ts` |
| 20 | Ausência de dado inventado como fato | `packages/core/test/provenance.test.ts` (invariante) |

Execução: `npm test` (core + api), `npm run test:e2e` (Playwright), `pytest` (docproc).
