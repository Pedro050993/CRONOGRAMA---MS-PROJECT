# 06 — Critérios de aceite (§20) e onde são verificados

Cada linha aponta para um teste que **existe e roda**. Onde a verificação é parcial,
está dito.

| # | Critério | Verificação |
|---|---|---|
| 1 | Projeto e usuários com permissões distintas | `packages/api/test/rbac.test.ts` — 12 casos, inclusive VIEWER sem escrita e PLANNER sem baseline |
| 2 | Upload individual, múltiplo, pasta e ZIP | `packages/api/test/upload.test.ts` |
| 3 | Preservação da árvore de pastas | `packages/api/test/upload.test.ts` — verifica `folderPath` e os nós de `Folder` |
| 4 | Duplicata e nova revisão | `packages/core/test/revision.test.ts` (7 casos) + `packages/api/test/upload.test.ts` |
| 5 | PDF/imagem → Markdown rastreável | `services/docproc/tests/test_pdf_pipeline.py` — âncora com doc, revisão, página, bbox e método |
| 6 | Visualização lado a lado fonte × extração | `tests/e2e/fluxo-completo.spec.ts` (painel de evidência) + `packages/api/test/validation.test.ts` (a fila devolve a evidência) |
| 7 | Correção e aprovação humana | `packages/api/test/validation.test.ts` — 10 casos |
| 8 | Extração de entidades técnicas reais | `services/docproc/tests/test_extractors.py` — lista de linhas e isométrico |
| 9 | Quadro quantitativo sem dupla contagem | `packages/core/test/quantities.test.ts` |
| 10 | EAP editável | `packages/core/test/wbs.test.ts` + `packages/api/test/workflow.test.ts` |
| 11 | Mapa de controle editável | `packages/core/test/controlmap.test.ts` + `packages/api/test/collaboration.test.ts` |
| 12 | Sequência com justificativa por vínculo | `packages/core/test/sequencing.test.ts` (12 casos) + `packages/api/test/workflow.test.ts` |
| 13 | Cronograma calculado a partir dos insumos | `packages/core/test/duration.test.ts` + `packages/api/test/workflow.test.ts` |
| 14 | Bloqueio da duração sem dados essenciais | `packages/core/test/duration.test.ts`, `packages/api/test/workflow.test.ts`, `tests/e2e/fluxo-completo.spec.ts` |
| 15 | Atualização colaborativa visível a outro usuário | `packages/api/test/collaboration.test.ts` — SSE real, dois usuários |
| 16 | Histórico e auditoria | `packages/api/test/collaboration.test.ts` + `tests/e2e/fluxo-completo.spec.ts` |
| 17 | Análise de impacto de nova revisão | `packages/core/test/revision.test.ts` + `services/docproc/src/docproc/handlers/revision_impact.py` |
| 18 | XML validado para MS Project 2016 | `packages/core/test/mspdi.test.ts` (15 casos, com *round-trip*) + `packages/api/test/workflow.test.ts` |
| 19 | Mensagem clara para DWG/NWD não convertido | `packages/core/test/formats.test.ts`, `packages/api/test/upload.test.ts`, `tests/e2e/fluxo-completo.spec.ts` |
| 20 | Ausência de dado inventado como fato | `packages/core/test/provenance.test.ts` e `packages/core/test/governance.test.ts` — a invariante e o portão de promoção |

## Ressalva sobre o critério 18

Os testes verificam o XML em duas camadas: o modelo antes de serializar e o arquivo
relido do zero (namespace, codificação, IDs, UIDs, vínculos órfãos, formato de data e
de duração, acentuação e escape). O *round-trip* exporta, reimporta e compara.

**O que não foi feito:** abrir o arquivo no Microsoft Project. Não há Windows nem
licença do Project neste ambiente. Isso está registrado em
`docs/10-limitacoes-conhecidas.md` como pendência de homologação, não como item
concluído.

## Como rodar

```bash
npm test              # core (163) + api (76)
npm run test:e2e      # navegador (7)
cd services/docproc && pytest                        # 29 de unidade
DOCPROC_TEST_DATABASE_URL=... pytest                 # + 8 de integração
```

Total atual: **283 testes automatizados**.
