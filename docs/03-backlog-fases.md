# 03 — Backlog priorizado por fase

Prioridade: **P0** = critério de aceite da fase; **P1** = necessário para uso real; **P2** = evolução.

## Fase 1 — MVP operacional (implementada neste repositório)

| ID | Item | Prio | Status |
|---|---|---|---|
| F1-01 | Organização, usuários, papéis (ADMIN/PLANNER/REVIEWER/VIEWER) | P0 | ✅ |
| F1-02 | Projeto com calendário, turnos, feriados, marcos, definição de "entregue" | P0 | ✅ |
| F1-03 | Pendência automática para campo de projeto não informado (sem valor genérico) | P0 | ✅ |
| F1-04 | Upload: arquivo, múltiplos, pasta (árvore preservada), ZIP | P0 | ✅ |
| F1-05 | Hash SHA-256, deduplicação, detecção de nova revisão | P0 | ✅ |
| F1-06 | Original imutável + versionamento de arquivo | P0 | ✅ |
| F1-07 | Fila de jobs com retry, progresso e erro visível | P0 | ✅ |
| F1-08 | PDF vetorial → Markdown rastreável (página + região) | P0 | ✅ |
| F1-09 | OCR sob demanda apenas onde não há texto (adaptador) | P0 | ✅ (adaptador; provedor opcional) |
| F1-10 | Imagem → pré-processamento + OCR + Markdown | P1 | ✅ (adaptador) |
| F1-11 | Classificação documental com confirmação humana | P0 | ✅ |
| F1-12 | Matriz documental com inconsistências | P1 | ✅ |
| F1-13 | Extração: lista de linhas | P0 | ✅ |
| F1-14 | Extração: isométrico (carimbo, linha, MTO, juntas) | P0 | ✅ |
| F1-15 | Tela de validação lado a lado com evidência destacada | P0 | ✅ |
| F1-16 | Reconciliação lista de linhas × isométrico × MTO | P0 | ✅ |
| F1-17 | Quantitativos multi-métrica sem dupla contagem | P0 | ✅ |
| F1-18 | Resumo executivo do escopo com grau de confiança | P0 | ✅ |
| F1-19 | EAP/AWP editável (Projeto→Fase→CWA→CWP→IWP→Atividade) | P0 | ✅ |
| F1-20 | Mapa de controle de tubulação configurável | P0 | ✅ |
| F1-21 | Sequenciamento com justificativa por vínculo + grafo | P0 | ✅ |
| F1-22 | Cálculo de duração (qtd × índice ÷ capacidade) e bloqueio `NOT_CALCULABLE` | P0 | ✅ |
| F1-23 | CPM, folga, caminho crítico, detecção de ciclo | P0 | ✅ |
| F1-24 | 16 verificações de qualidade da lógica | P0 | ✅ |
| F1-25 | Baseline, plano atual, realizado, saldo, tendência | P0 | ✅ |
| F1-26 | Exportação XML MSPDI (Project 2016) + relatório de validação | P0 | ✅ |
| F1-27 | Importação de XML para auditoria/comparação | P1 | ✅ |
| F1-28 | Exportação XLSX/CSV/JSON | P1 | ✅ |
| F1-29 | SSE + concorrência otimista (409) | P0 | ✅ |
| F1-30 | Trilha de auditoria com valor anterior/novo | P0 | ✅ |
| F1-31 | Análise de impacto de nova revisão | P0 | ✅ |
| F1-32 | Registro de restrições e prontidão de IWP | P1 | ✅ |
| F1-33 | Testes unitários, integração e e2e | P0 | ✅ |
| F1-34 | Curva S física ponderada por HH | P1 | ✅ |
| F1-35 | Nivelamento de recursos | P2 | ⛔ Fase 4 |

## Fase 2 — CAD 2D

DXF nativo (parser próprio: layers, blocos, textos, cotas, coordenadas) → P0.
DWG via ODA File Converter em container isolado → P0.
Visualizador 2D (SVG derivado) → P1. Reconciliação CAD × PDF → P1.
Extração de atributos de bloco para tag/linha/suporte → P0.

## Fase 3 — Modelo 3D / Navisworks

Integração Autodesk APS (Model Derivative) → P0. Árvore e propriedades → P0.
Visualizador 3D (APS Viewer) → P1. Bounding box e relação espacial → P0.
Quantitativo de modelo com anti-dupla-contagem por elemento agregado → P0.
Apoio ao sequenciamento por geometria (acesso, fechamento de espaço) → P1.

## Fase 4 — Expansão

Elétrica, instrumentação, estruturas. Apontamento de campo (mobile).
Lookahead/LPS/PPC com causas de não cumprimento. Cenários e simulação.
Dashboard de portfólio. Integração ERP/SAP. Nivelamento de recursos.
