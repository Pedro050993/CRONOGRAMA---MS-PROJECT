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

## Fase 2 — CAD 2D  *(recortada em 05/09/2026: sem orçamento de licença — D4)*

O conversor licenciado saiu do escopo. O que resta é viável a custo zero de licença:

| Item | Prio | Observação |
|---|---|---|
| Parser DXF próprio: layers, blocos, atributos, textos, cotas, coordenadas, XREFs | P0 | DXF é formato aberto e documentado; nenhuma licença envolvida |
| Extração de atributos de bloco → tag, linha, suporte | P0 | é daqui que sai a entidade técnica |
| Visualizador 2D por SVG derivado do DXF | P1 | render próprio, sem viewer comercial |
| Reconciliação CAD × PDF | P1 | mesma máquina de divergências já usada em lista × isométrico |
| **DWG** | — | **fora de escopo.** Exigir DXF na entrega documental. LibreDWG (GPL-3) fica registrado como opção de risco, não como plano |

## Fase 3 — Modelo 3D  *(recortada em 05/09/2026: sem orçamento de licença — D5)*

Sem APS, não há leitura de NWD. A fase passa a depender de formato aberto:

| Item | Prio | Observação |
|---|---|---|
| Importação de IFC (parser próprio ou biblioteca aberta) | P0 | árvore, propriedades, coordenadas |
| Importação de CSV de propriedades exportado do Navisworks | P0 | caminho mais barato e imediato: o emissor exporta, nós lemos |
| Importação de relatório de clash (XML/HTML do Navisworks) | P0 | alimenta a regra `SEQ.ACCESS_BLOCKING`, hoje sem fonte de interferência |
| Quantitativo de modelo com anti-dupla-contagem por elemento agregado | P0 | a verificação por `entityKey` já existe; falta marcar o nível de agregação |
| Visualizador 3D | P2 | sem viewer comercial, é trabalho grande para benefício menor que o resto |
| **NWD/NWC** | — | **fora de escopo.** Não existe leitor aberto |

## Fase 4 — Expansão

Elétrica, instrumentação, estruturas. Apontamento de campo (mobile).
Lookahead/LPS/PPC com causas de não cumprimento. Cenários e simulação.
Dashboard de portfólio. Integração ERP/SAP. Nivelamento de recursos.
