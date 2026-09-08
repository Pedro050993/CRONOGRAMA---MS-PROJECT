# 02 — Modelo de dados

Fonte da verdade: `packages/api/prisma/schema.prisma`. Este documento explica as
decisões, não repete os campos.

## 1. Princípio estruturante

```
Document → DocumentVersion → Evidence → TechEntity / QuantityItem
                                            ↓
                                        WbsNode → Activity → LogicLink
                                            ↓
                                   ControlMapItem · Constraint · Baseline
```

Todo item técnico guarda `evidenceId`. Um `QuantityItem` sem evidência só pode
existir com `dataClass = USER_INPUT` (alguém digitou e assinou) ou `PENDING_INFO`
(ninguém sabe ainda). **Não existe o terceiro caso.**

## 2. Blocos

| Bloco | Entidades | Por que existe assim |
|---|---|---|
| Identidade | `Organization`, `User`, `ProjectMember` | papel é por projeto, não global: um planejador pode ser revisor em outra obra |
| Arquivos | `Folder`, `Document`, `DocumentVersion` | o binário é endereçado por hash; nova revisão cria `DocumentVersion`, nunca sobrescreve |
| Evidência | `DocumentPage`, `Evidence` | `bbox`, página, método e confiança — o que permite voltar do número ao desenho |
| Técnico | `TechEntity`, `EntityRelation`, `QuantityItem` | `entityKey` é a chave da **coisa física**, não do registro: é ela que detecta dupla contagem |
| Governança | `OpenIssue`, `Assumption`, `SourceConflict`, `Decision` | pendência, premissa e conflito são registros de primeira classe, não observações em texto livre |
| AWP | `WbsNode` (`type` = PROJECT/PHASE/CWA/CWP/IWP/ACTIVITY) | um único tipo enumerado impede que CWA, CWP e IWP virem sinônimos |
| Cálculo | `WorkCalendarDef`, `ResourceDef`, `ProductivityIndex` | `ProductivityIndex.source` e `sourceDate` são **NOT NULL**: índice sem fonte não calcula duração |
| Cronograma | `Activity`, `LogicLink`, `Assignment` | `Activity.durationStatus` + `missingInputs` deixam o bloqueio explícito no banco |
| Controle | `ControlMapItem`, `ConstraintRecord`, `ReadinessAssessment` | estágios e prontidão em JSON versionado, configuráveis por disciplina |
| Linha de base | `Baseline`, `BaselineRow` | congelada por cópia; nenhuma rota atualiza `BaselineRow` |
| Operação | `ProcessingJob`, `AuditLog`, `ExportRecord`, `Comment` | a fila é tabela porque Node e Python precisam consumi-la |

## 3. Decisões que valem explicar

**`entityKey` em vez de FK para detectar duplicidade.** A mesma junta aparece no
isométrico, no MTO e no modelo 3D como três registros distintos. Amarrá-los por FK
exigiria decidir antes qual é o "verdadeiro" — exatamente a decisão que §7.5 proíbe
tomar sozinho. A chave natural deixa os três coexistirem e o conflito visível.

**`version: Int` em quase tudo.** Concorrência otimista. O `PATCH` manda a versão que
leu; divergiu, a API devolve 409 com o valor atual. Sem isso, dois planejadores
sobrescrevem um ao outro numa terça-feira e ninguém descobre.

**`durationStatus` e `missingInputs` na tabela.** O bloqueio precisa sobreviver a um
`SELECT`. Se ele só existisse na camada de cálculo, um relatório qualquer leria
`durationMinutes = 0` e trataria como "zero dias".

**`ProductivityIndex.source` NOT NULL.** É a diferença entre um cronograma defensável
em pleito e um número que ninguém sabe de onde veio.

**`Baseline` por cópia, não por flag.** Marcar "esta é a baseline" numa coluna de
`Activity` faz a baseline mudar junto com o plano. Copiar congela de verdade.

## 4. Índices

- `QuantityItem(projectId, entityKey)` — verificação de dupla contagem.
- `QuantityItem(projectId, discipline, area)` — quadros quantitativos.
- `DocumentVersion(sha256)` — deduplicação no upload.
- `ProcessingJob(status, runAfter, priority)` — a consulta do `SKIP LOCKED`.
- `AuditLog(entity, entityId)` — histórico de um item específico.

## 5. Integridade

- `onDelete: Cascade` a partir de `Project`: apagar o projeto leva junto tudo dele.
- `@@unique([projectId, code])` em `WbsNode`, `Activity`, `ResourceDef`,
  `ProductivityIndex`, `WorkCalendarDef` — códigos são estáveis e únicos.
- `@@unique([predecessorId, successorId])` em `LogicLink` — sem vínculo duplicado.
- `@@unique([documentId, sha256])` — a mesma revisão não entra duas vezes.
