# 10 — Limitações conhecidas

Este documento existe para que ninguém descubra em campo o que já se sabe aqui.
Cada limitação está declarada **no próprio produto**, não só nesta página.

## 1. Extração documental

| Limitação | Onde aparece ao usuário | Estado |
|---|---|---|
| Sem provedor de OCR, página digitalizada **não é interpretada** | aviso na página, `status = PARTIAL`, pendência no projeto, faixa no Markdown | intencional |
| Reconhecimento de tabela é por padrão de texto, não por geometria de célula | confiança baixa no item | Fase 2 |
| Símbolos de P&ID não são reconhecidos | P&ID cai em "sem extrator para este tipo" | Fase 4 |
| Carimbo em posição não usual pode não ser lido | campo vira pendência, nunca é adivinhado | intencional |
| Isométrico sem marcação de junta legível **não tem contagem de juntas** | aviso explícito: a contagem não é inferida da topologia | intencional |
| Conectividade entre linhas só é usada quando documentada | vira pergunta aberta, nunca vínculo | intencional |

## 2. Formatos

| Formato | Estado | Caminho |
|---|---|---|
| PDF vetorial, PNG/JPG/TIFF | suportado | — |
| PDF digitalizado | suportado **se** houver OCR configurado | `OCR_PROVIDER` |
| DXF | bloqueado com mensagem e alternativas | Fase 2 |
| DWG | bloqueado — formato proprietário, exige ODA/APS licenciado | Fase 2 + decisão D4 |
| NWD / NWC | bloqueado — proprietário, exige Autodesk APS | Fase 3 + decisão D5 |
| IFC | bloqueado | Fase 3 |
| XLSX/CSV | armazenado; extração estruturada é Fase 2 | Fase 2 |

O arquivo bloqueado **é armazenado íntegro e versionado**. Nada é perdido; apenas não
é interpretado, e isso é dito na tela.

## 3. Cronograma

- **Nivelamento de recursos não é feito.** O verificador aponta superalocação
  (`RESOURCE_OVERALLOCATION`), mas não redistribui. Fase 4.
- **Calendário por recurso não é aplicado no CPM.** O calendário é por atividade.
  Turnos distintos por equipe entram na Fase 4.
- **Defasagem (lag) é aplicada no calendário da sucessora.** É uma escolha explícita;
  o MS Project permite configurar outra base.
- **Restrições ALAP** são aceitas no modelo e exportadas, mas o cálculo trata a rede
  como *early-start*. Restrição ALAP isolada não altera o resultado.
- **Múltiplos caminhos críticos** não são separados; o caminho crítico devolvido é o
  mais longo entre as atividades de folga ≤ 0.

## 4. Exportação MSPDI

- Gerado para `SaveVersion 14` (formato Project 2010+, lido por 2016/2019/365).
- **Não há teste de importação no Microsoft Project neste ambiente.** A validação é
  rigorosa em duas camadas — modelo e releitura do XML — e cobre namespace,
  codificação, IDs, UIDs, vínculos órfãos, formato de data e de duração. Ainda assim,
  *validado* não é o mesmo que *aberto no Project*: a homologação com o arquivo real
  na máquina do cliente continua pendente. Isso é uma limitação de ambiente, não do código.
- Campos personalizados: `Text1..Text10` e `Number1..Number3`. Mais que isso exige
  ampliar o mapa de `FieldID`.
- Curva de custo, calendário de recurso e tarefas manuais não são exportados.

## 5. Colaboração

- Concorrência é otimista (409), não bloqueio pessimista. Duas pessoas editando o
  mesmo item ao mesmo tempo: a segunda recebe conflito e reenvia.
- Não há edição simultânea de campo (tipo documento colaborativo). O modelo é
  ler → alterar → salvar com versão.
- SSE entrega o evento; o cliente recarrega o dado. Não há sincronização incremental
  de estado.

## 6. Segurança e operação

- **Não há varredura antivírus do arquivo enviado.** Há validação de tamanho, extensão
  e proteção contra *zip bomb* e *path traversal*, mas nenhuma inspeção de conteúdo
  malicioso. Em ambiente de cliente, coloque um gateway de varredura antes do upload
  ou adicione ClamAV ao pipeline. **Pendência de segurança conhecida.**
- Política de retenção/expurgo dos objetos no S3 não está automatizada: depende de
  regra de ciclo de vida configurada no bucket.
- Sem SSO/OIDC. Autenticação é e-mail + senha. Fase 4.
- Sem *rate limiting* nas rotas de autenticação. Recomendado colocar no proxy.

## 7. Dados de demonstração

Os índices de produtividade do `seed` são **fictícios**, com fonte declarada como
"PREMISSA DE DEMONSTRAÇÃO". O projeto recebe `[DEMONSTRACAO]` no nome, os documentos
recebem `[TESTE]` e a interface exibe faixa fixa no topo. Não use em obra real.

## 8. O que este sistema deliberadamente não faz

- Não completa quantitativo "típico" quando a lista de materiais não foi lida.
- Não infere conexão entre linhas por proximidade no desenho.
- Não sequencia por diâmetro, ordem alfabética ou ordem de arquivo.
- Não adota fator de praticabilidade sem fonte e aprovação registradas.
- Não arbitra duração quando falta quantidade, índice, equipe ou calendário.
- Não escolhe fonte vencedora numa divergência sem regra aprovada.
- Não altera realizado nem linha de base em silêncio.
