# 09 — Implantação e segurança

## 1. Topologia mínima em produção

```
Internet → TLS (proxy/ingress) → nginx (frontend + /api) → API (2+ réplicas)
                                                              ↓
                          PostgreSQL (gerenciado, backup PITR)  ·  S3/MinIO
                                                              ↓
                                              docproc (N réplicas, sem porta exposta)
```

A API é sem estado: escale por réplicas. O worker também — a fila em `SKIP LOCKED`
garante que dois workers nunca peguem o mesmo job.

## 2. Segredos

- Gere `JWT_SECRET` com `openssl rand -base64 48`. Trocá-lo invalida todas as sessões.
- Nenhum segredo vai para o frontend. O build recebe apenas `VITE_API_URL`.
- Use o gerenciador de segredos do ambiente (Docker secrets, Vault, SSM). O `.env`
  serve a desenvolvimento.
- Rotacione as credenciais de S3 e do banco em cadência definida pelo cliente.

## 3. Controles implementados

| Controle | Onde | Observação |
|---|---|---|
| Senha com scrypt + sal por usuário | `packages/api/src/lib/auth.ts` | sem dependência nativa |
| JWT HS256 com expiração | idem | padrão 8 h |
| Autorização por projeto e capacidade | `lib/rbac.ts` | quem não é membro recebe 404, não 403 |
| Concorrência otimista | `lib/concurrency.ts` | 409 com o estado atual |
| Auditoria com antes/depois | `lib/audit.ts` | toda mutação relevante |
| Proteção do realizado | rota `/actuals` | exige ADMIN e justificativa |
| Validação de tamanho e tipo | `routes/documents.ts` | limites por env |
| Anti *zip bomb* e *path traversal* | idem | testado |
| URLs temporárias | `storage/index.ts` | TTL configurável (padrão 300 s) |
| Log sem conteúdo de documento | `app.ts` (`redact`) | apenas metadados |
| Consentimento para IA externa | `Project.allowExternalAi` | falso por padrão |

## 4. LGPD e soberania do dado

- Documentos de engenharia podem conter dado pessoal (nomes de responsáveis técnicos,
  assinaturas). Trate o bucket como base de dados pessoais.
- `Project.allowExternalAi = false` por padrão: sem consentimento explícito, o
  documento não sai do perímetro para nenhum provedor externo.
- Região de armazenamento: `S3_REGION` e `S3_ENDPOINT`. Para exigência de dado em
  território nacional, aponte para provedor local ou MinIO on-premise.
- Retenção e expurgo: `onDelete: Cascade` a partir de `Project` remove todo o conteúdo
  derivado. Os binários no S3 exigem política de ciclo de vida no bucket — **isso não
  está automatizado nesta fase** e está registrado em `docs/10-limitacoes-conhecidas.md`.

## 5. Backup e recuperação

- **Banco**: backup diário + WAL contínuo (PITR). É a fonte de verdade da rastreabilidade.
- **Objetos**: versionamento no bucket + replicação. Os originais são imutáveis, então
  um backup incremental é barato.
- **Teste de restauração**: trimestral, com verificação de que uma exportação MSPDI
  gerada antes do backup continua idêntica depois da restauração.
- RPO sugerido: 15 min. RTO sugerido: 4 h. Ambos são **premissas** — o cliente define.

## 6. Observabilidade

- `GET /api/health` para *liveness*.
- Log estruturado (JSON) da API via Fastify.
- Fila: `ProcessingJob` com `status`, `attempts`, `lastError`, `progress`. Alerte em
  `FAILED` acumulando ou `RUNNING` parado além de 30 min (a função `reapStale` recoloca
  na fila, mas o alerta é o que traz um humano).

## 7. Antes de ir a produção

- [ ] TLS terminado no proxy, HSTS ativo
- [ ] `JWT_SECRET` forte e no gerenciador de segredos
- [ ] `CORS_ORIGIN` restrito ao domínio real
- [ ] Backup do banco testado com restauração real
- [ ] Versionamento do bucket ativo
- [ ] Antivírus/varredura de arquivo enviado (**ver limitações**)
- [ ] Política de retenção acordada com o cliente
- [ ] Papéis revisados: quem realmente precisa de ADMIN
