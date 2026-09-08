# 01 — Arquitetura

## 1. Visão geral

```
                    ┌───────────────────────────────────────────────┐
                    │  Navegador (React 19 + TS + Vite)             │
                    │  Gantt SVG · Grafo DAG · Split-pane validação │
                    └───────┬───────────────────────────┬───────────┘
                            │ REST/JSON (JWT)           │ SSE (eventos)
                    ┌───────▼───────────────────────────▼───────────┐
                    │  API  (Node 22 · Fastify 5 · TypeScript)      │
                    │  authz por projeto · auditoria · versionamento│
                    │  ┌────────────────────────────────────────┐   │
                    │  │ @cronograma/core  (domínio puro, 0 dep)│   │
                    │  │ unidades · quantitativos · EAP · CPM   │   │
                    │  │ duração · sequenciamento · MSPDI XML   │   │
                    │  └────────────────────────────────────────┘   │
                    └──┬──────────────┬─────────────────┬───────────┘
                       │ Prisma       │ StorageAdapter  │ jobs (SKIP LOCKED)
                    ┌──▼────────┐  ┌──▼─────────────┐ ┌─▼──────────────────┐
                    │PostgreSQL │  │ fs:// ou s3://  │ │ Worker docproc     │
                    │  16       │  │ (MinIO/S3)      │ │ Python 3.11        │
                    └───────────┘  └─────────────────┘ │ PDF→MD · OCR · IA  │
                                                       │ classificação      │
                                                       └────────────────────┘
```

## 2. Decisões arquiteturais (ADR resumido)

| # | Decisão | Alternativa descartada | Motivo |
|---|---|---|---|
| A1 | Monorepo npm workspaces | polirepo | domínio compartilhado entre API e testes; menos atrito na Fase 1 |
| A2 | **Domínio puro em `@cronograma/core`, zero dependências** | lógica dentro da API | testável sem banco; portável para worker/CLI; garante que a regra de negócio não depende de framework |
| A3 | Fila em **tabela Postgres com `FOR UPDATE SKIP LOCKED`** | Redis+BullMQ; Celery | fila precisa ser consumida por **Node e Python**; evita 2 brokers e 1 serviço a mais; transacional com o dado |
| A4 | **SSE** para tempo real | WebSocket | fluxo é servidor→cliente (progresso, mudança aprovada); atravessa proxy corporativo; reconexão nativa |
| A5 | `StorageAdapter` (fs \| s3) | S3 obrigatório | dev e piloto on-premise sem MinIO; produção usa S3/MinIO por env |
| A6 | Adaptadores `Ocr`, `Llm`, `CadConverter`, `ModelDeriver` com implementação `null`/`unsupported` | acoplar a um fornecedor | §3 exige substituibilidade; **o padrão é não inventar**: sem provedor configurado, o campo vira pendência, não um chute |
| A7 | Autenticação JWT + scrypt (node:crypto) | argon2/bcrypt nativos | zero dependência nativa, build reproduzível; scrypt é KDF aprovado |
| A8 | Prisma como ORM/migrations | SQL puro | migrações versionadas e tipagem ponta a ponta |
| A9 | Gantt e grafo em SVG próprio | biblioteca comercial | controle total de baseline × plano × realizado; sem licença |

## 3. Fronteiras de responsabilidade

- **core**: não conhece HTTP, banco, nem arquivo. Entrada e saída são objetos.
  É onde vivem as regras que **não podem** ser burladas (bloqueio de duração,
  proibição de somar unidades incompatíveis, detecção de ciclo).
- **api**: autoriza, persiste, audita, publica evento, orquestra job.
  Nunca calcula regra de negócio própria — delega ao core.
- **docproc**: transforma bytes em evidência estruturada com confiança.
  Nunca escreve em tabela de cronograma; só em documento/entidade com `reviewStatus=PENDING`.
- **web**: nunca decide. Mostra proveniência, coleta aprovação humana.

## 4. Fluxo de aprovação (invariante do sistema)

```
extração (IA/regra)  →  PENDING          ← não afeta nada
        ↓ revisão humana
     APPROVED / CORRECTED / REJECTED     ← registra usuário, antes/depois, justificativa
        ↓ só APPROVED
   quantitativo → pacote → atividade → cronograma → baseline
```

Regra implementada em `core/src/governance/promotion.ts`: uma atividade só pode
ser promovida a plano aprovado se **todas** as suas quantidades de origem tiverem
`reviewStatus ∈ {APPROVED, USER_INPUT}`.

## 5. Tempo real e concorrência

- Cada projeto tem um canal SSE (`/projects/:id/events`).
- Eventos: `document.processed`, `entity.updated`, `quantity.approved`,
  `wbs.changed`, `schedule.recalculated`, `revision.impact.ready`.
- Concorrência otimista: toda entidade editável tem `version` (int).
  `PATCH` exige `If-Match: <version>`; divergência retorna **409** com o valor atual
  e o autor da alteração — nunca sobrescrita silenciosa (§16).

## 6. Segurança (resumo — detalhe em `docs/09-implantacao.md`)

- Segredos só no servidor; frontend recebe apenas `VITE_API_URL`.
- URLs de arquivo são temporárias e assinadas (padrão 300 s).
- Validação de MIME real (magic bytes) + limite de tamanho + limite de entradas do ZIP
  (proteção contra *zip bomb* e *path traversal*, testada).
- Log estruturado sem conteúdo de documento.
- Flag por projeto `allowExternalAiTraining=false` por padrão.
