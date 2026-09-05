# 12 — Base de produtividade: importação e conferência

Decisão **D6**: a base oficial do projeto vem de arquivo importado. Este documento
explica o que o sistema aceita, o que ele recusa e por quê.

## 1. A regra que governa tudo aqui

Um índice de produtividade decide o prazo. Em pleito, ele é o número que a outra parte
vai atacar primeiro. Por isso:

| Regra | Onde é imposta |
|---|---|
| Índice sem fonte não calcula duração | `core/schedule/duration.ts` — `source` obrigatório |
| Índice **lido de arquivo** não calcula duração antes de conferido | idem — `approvalStatus` |
| Índice digitado por humano identificado nasce conferido | `api/routes/projects.ts` |
| O arquivo importado **é** a fonte: nome, SHA-256, aba e linha ficam registrados | `api/routes/productivity.ts` |
| Unidade fora do registro derruba a linha | `core/productivity/import.ts` |
| Base (orçado × observado) e data nunca são adivinhadas | idem |

## 2. Formatos aceitos

| Formato | Como é lido | Confiança |
|---|---|---|
| **XLSX / XLSM** | ZIP + XML lidos diretamente; strings compartilhadas e valores em cache | alta |
| **CSV / TSV / TXT** | separador detectado (`;`, tab, `,`), aspas conforme RFC 4180, BOM tratado | alta |
| **PDF** | worker agrupa palavras por coordenada para reconstruir a tabela | **limitada a 0,60** |

PDF não tem célula: tem texto posicionado. O agrupamento por coordenada funciona bem
numa base emitida por sistema e mal numa digitalizada. Por isso o teto de confiança —
e por isso a conferência linha a linha importa mais nesse caso.

## 3. O que a planilha precisa ter

O sistema encontra o cabeçalho sozinho, mesmo com título e linhas em branco antes.
Ele reconhece, em português e inglês:

| Campo | Cabeçalhos reconhecidos | Obrigatório |
|---|---|---|
| Índice | `Índice`, `Indice`, `HH`, `Valor`, `Produtividade`, `Index`, `Rate` | **sim** |
| Unidade | `Unidade`, `Un`, `UOM`, `Unit`, `Por unidade` | **sim** |
| Serviço | `Serviço`, `Descrição`, `Atividade`, `Description` | **sim** |
| Base | `Base`, `Basis`, `Tipo` | sim, ou declarada na importação |
| Data | `Data`, `Date`, `Vigência` | sim, ou declarada na importação |
| Código | `Código`, `Code`, `Item` | não — é gerado |
| Fonte | `Fonte`, `Source`, `Referência` | não — é o arquivo |
| Disciplina | `Disciplina`, `Discipline` | não |

Unidades reconhecidas incluem os apelidos usuais de obra: `pol-dia`, `polegada-diâmetro`,
`in-dia`, `di`, `junta`, `jt`, `ml`, `m`, `kg`, `t`, `un`, `m2`, `m3`, e o formato `HH/m`.

Bases reconhecidas: `orçado`/`budget`, `planejado`/`planned`, `observado`/`histórico`/
`realizado`, `projetado`/`forecast`/`previsto`.

## 4. Quando o arquivo inteiro é recusado

Duas situações param a importação por completo, em vez de importar pela metade:

**Falta a base do índice** e ela não foi declarada. Orçado e observado não são a mesma
coisa: um é compromisso comercial, o outro é medição de campo. Confundir os dois num
pleito é entregar o argumento pronto para a outra parte.

**Falta a data da fonte** e ela não foi declarada. Um índice sem data não diz a que
período se refere, e produtividade de obra muda com efetivo, clima e curva de aprendizado.

Nos dois casos o sistema aceita que **você declare** o valor na tela de importação — e
registra que a declaração veio de você, não do arquivo. A confiança do índice cai
proporcionalmente.

## 5. Quando a linha é recusada

Linha recusada nunca some: ela aparece na tela com número da linha, conteúdo e motivo.

| Motivo | Exemplo |
|---|---|
| Índice não numérico | `"a definir"`, `"ver nota 3"` |
| Índice zero ou negativo | não calcula duração |
| Unidade fora do registro | `"vara"`, `"pol-diâmetro-equivalente"` |
| Base não reconhecida | `"médio"` |
| Data ilegível | `"janeiro de 2026"` |
| Linha sem serviço identificado | subtotal, rodapé |

Linha totalmente vazia é ignorada em silêncio — é separador, não erro.

## 6. Conflito de código

Se o código já existe no projeto, o sistema **renomeia o novo** (`IDX-SOLD` → `IDX-SOLD-2`)
e avisa. Nunca sobrescreve. Um índice aprovado que some porque outra planilha reusou o
código seria a pior forma de perder rastreabilidade.

## 7. Reimportação

O mesmo arquivo (mesmo SHA-256) já importado devolve **409** com a data da importação
anterior. É preciso confirmar explicitamente para importar de novo. Isso evita a base
duplicar por um clique repetido.

## 8. Conferência

Cada índice pendente aparece em **13. Premissas e decisões** com:

- o valor lido, a unidade, a base e a data;
- o arquivo, a aba e a linha de onde saiu;
- a confiança da leitura.

Três ações: **conferir** (aprova como está), **corrigir** (exige justificativa, e a
correção fica marcada na própria fonte do índice) e **rejeitar** (exige justificativa).

Há conferência em lote por importação, e ela exige a regra escrita — a mesma disciplina
da aprovação em lote de quantitativos.

## 9. O efeito no cronograma

Enquanto um índice estiver pendente, toda atividade que depende dele fica
`NOT_CALCULABLE`, e a tela de cronograma diz por quê:

> Índice "Importado de BASE-2026.xlsx (SHA-256 a1b2c3d4e5f6…)" foi importado de arquivo
> e ainda não foi confirmado por um revisor. Leitura de planilha é extração, não
> digitação: ela não calcula prazo antes de ser conferida.

Isso é intencional. O sistema não usa um número que ninguém olhou para dizer quando a
obra termina.
