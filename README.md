# Cronograma — planejamento de obras industriais eletromecânicas

Plataforma colaborativa que recebe documentos de engenharia, interpreta-os **com
rastreabilidade até a região do desenho**, estrutura o escopo e gera uma proposta
tecnicamente justificável de EAP/AWP, mapas de controle, sequência construtiva e
cronograma exportável em XML do Microsoft Project 2016.

> **A premissa do produto:** um cronograma é tão confiável quanto o dado que o
> sustenta. Por isso o núcleo do sistema não é o Gantt — é a cadeia de custódia da
> informação. Onde o dado não existe, o sistema diz que não existe.

## O que o sistema se recusa a fazer

Estas não são recomendações: são regras impostas por código e cobertas por teste.

| Regra | Onde é imposta |
|---|---|
| Duração sem quantidade, índice com fonte, equipe e calendário → `NOT_CALCULABLE`, nunca um número | `core/schedule/duration.ts` |
| Fator de praticabilidade sem fonte e aprovação → erro, não default | idem |
| Somar ou converter grandezas incompatíveis → erro, não conversão silenciosa | `core/units` |
| Mesma entidade física em duas fontes → conflito exposto, sem vencedor automático | `core/quantities/rollup.ts` |
| Inferência de IA sem revisão humana → não entra em plano aprovado, e o bloqueio se propaga | `core/governance/promotion.ts` |
| CWA, CWP e IWP confundidos na hierarquia → EAP inválida | `core/wbs` |
| Vínculo de precedência sem motivo, fonte e confiança → não é criado | `core/sequencing` |
| Interferência sem evidência → vira pergunta aberta, não precedência | idem |
| Alterar realizado já registrado → exige ADMIN e justificativa | `api/routes/planning.ts` |
| XML que não passa na validação → não é entregue | `api/routes/exports.ts` |
| DWG/NWD → bloqueio explícito com alternativas, sem fingir leitura | `core/formats` |
| Página sem OCR disponível → pendência visível, nunca página vazia | `docproc/pdf/extract.py` |

## Arquitetura

```
React 19 + TS  ──REST/SSE──  Fastify + @cronograma/core  ──  PostgreSQL 16
   (Vite)                          (domínio puro)              S3 / MinIO
                                        │
                                fila em tabela (SKIP LOCKED)
                                        │
                          worker Python: PDF/imagem → Markdown rastreável
```

`@cronograma/core` não tem **nenhuma dependência externa**. É onde vivem as regras
que não podem ser burladas, testáveis sem banco e sem HTTP.

## Início rápido

```bash
cp .env.example .env      # preencha JWT_SECRET e POSTGRES_PASSWORD
docker compose up --build
# interface: http://localhost:8080
```

Desenvolvimento, testes e primeiro uso: [`docs/08-instalacao.md`](docs/08-instalacao.md).

## Estado

**Fase 1 implementada de ponta a ponta** — PDF e imagem, validação humana, tubulação,
EAP/AWP, mapas de controle, sequenciamento, cronograma e XML MSPDI.

| Suíte | Casos | Como roda |
|---|---|---|
| Domínio (`@cronograma/core`) | 142 | puro, sem infraestrutura |
| API | 60 | integração contra PostgreSQL real |
| Worker (`docproc`) | 32 | 24 unidade + 8 integração com banco e fila |
| Navegador (Playwright) | 7 | API e frontend reais |

Fases 2 (DWG/DXF), 3 (NWD/IFC) e 4 (demais disciplinas, LPS, portfólio) estão
especificadas em [`docs/03-backlog-fases.md`](docs/03-backlog-fases.md) e **declaradas
como não implementadas dentro do próprio produto**.

## Documentação

| # | Documento |
|---|---|
| 00 | [Diagnóstico de viabilidade e riscos](docs/00-diagnostico-viabilidade.md) |
| 01 | [Arquitetura e decisões](docs/01-arquitetura.md) |
| 02 | [Modelo de dados](docs/02-modelo-dados.md) |
| 03 | [Backlog por fase](docs/03-backlog-fases.md) |
| 04 | [Telas e fluxo do usuário](docs/04-telas-fluxo.md) |
| 05 | [Estratégia de processamento por formato](docs/05-estrategia-processamento.md) |
| 06 | [Critérios de aceite e onde são verificados](docs/06-criterios-aceite.md) |
| 07 | [Decisões pendentes](docs/07-decisoes-pendentes.md) |
| 08 | [Instalação e execução](docs/08-instalacao.md) |
| 09 | [Implantação e segurança](docs/09-implantacao.md) |
| 10 | [**Limitações conhecidas**](docs/10-limitacoes-conhecidas.md) |
| 11 | [Conectando OCR, IA e CAD/BIM](docs/11-integracao-ocr-ia-cad.md) |

## Estrutura

```
packages/core/     domínio puro, zero dependências — a regra que não se burla
packages/api/      Fastify, Prisma, RBAC, auditoria, SSE, MSPDI
packages/web/      React, 15 telas, Gantt e grafo em SVG próprio
services/docproc/  worker Python: extração, OCR, classificação, entidades
infra/             Dockerfiles e nginx
docs/              os 12 documentos acima
tests/e2e/         Playwright
```

## Licença

Defina antes de distribuir.
