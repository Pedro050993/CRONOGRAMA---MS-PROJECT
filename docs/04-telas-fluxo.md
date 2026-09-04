# 04 — Mapa de telas e fluxo do usuário

## 1. Menu (15 itens, conforme §15)

| # | Tela | Rota | Fase 1 |
|---|---|---|---|
| 1 | Portfólio | `/` | ✅ |
| 2 | Visão geral do projeto | `/p/:id` | ✅ |
| 3 | Documentos | `/p/:id/documentos` | ✅ |
| 4 | Processamento | `/p/:id/processamento` | ✅ |
| 5 | Validação | `/p/:id/validacao` | ✅ |
| 6 | Escopo e quantitativos | `/p/:id/escopo` | ✅ |
| 7 | EAP e AWP | `/p/:id/eap` | ✅ |
| 8 | Mapas de controle | `/p/:id/mapas` | ✅ |
| 9 | Sequenciamento | `/p/:id/sequenciamento` | ✅ |
| 10 | Cronograma e Gantt | `/p/:id/cronograma` | ✅ |
| 11 | Restrições e prontidão | `/p/:id/restricoes` | ✅ |
| 12 | Riscos e inconsistências | `/p/:id/riscos` | ✅ |
| 13 | Premissas e decisões | `/p/:id/premissas` | ✅ |
| 14 | Relatórios e exportações | `/p/:id/exportacoes` | ✅ |
| 15 | Administração e auditoria | `/p/:id/auditoria` | ✅ |

## 2. Fluxo do primeiro caso de uso (isométricos + lista de linhas → XML)

```
1. Portfólio → "Novo projeto"
   ├─ campos obrigatórios preenchidos → registrados como DADO INFORMADO
   └─ campos vazios → geram PENDÊNCIA (openIssues), nunca default silencioso

2. Documentos → arrastar pasta/ZIP
   ├─ árvore preservada (folderPath)
   ├─ SHA-256 → DUPLICATE | NEW_REVISION | NEW_DOCUMENT
   └─ enfileira job `document.process`

3. Processamento (SSE ao vivo)
   ├─ detecta camada de texto → extrai vetorial
   ├─ OCR só nas regiões sem texto (se provedor configurado; senão marca LOW_CONFIDENCE + pendência)
   ├─ gera Markdown com âncora `<!--@ page=3 bbox=... -->`
   └─ classifica: LINE_LIST | PIPING_ISOMETRIC | ...  (confiança + confirmação humana)

4. Validação (split-pane)
   ├─ esquerda: página do PDF com bbox destacado
   ├─ direita: campos editáveis (linha, DN, classe, schedule, juntas, comprimento)
   ├─ ações: aprovar | corrigir | rejeitar | pendência (em lote só com regra visível)
   └─ mostra impacto antes de aplicar

5. Escopo e quantitativos
   ├─ reconciliação lista de linhas × isométrico × MTO → divergências listadas
   ├─ métricas: m, kg, un, junta, pol-diâmetro, pol-junta, HH/un
   └─ verificação anti-dupla-contagem por chave de entidade + precedência configurada

6. EAP e AWP
   └─ CWA (área) → CWP (disciplina/sistema) → IWP (pacote executável) → atividade

7. Mapas de controle → linhas/spools/juntas com etapas e semáforo de regra visível

8. Sequenciamento
   ├─ regras configuráveis geram vínculos SUGGESTED com motivo + fonte + confiança
   ├─ grafo navegável + "Por que esta atividade vem antes?"
   └─ planejador valida/rejeita → só VALIDATED entra no CPM aprovado

9. Cronograma
   ├─ HH = qtd × índice ; capacidade = Σrecursos × h produtivas ; duração = HH ÷ capacidade
   ├─ faltou insumo → NOT_CALCULABLE com lista do que falta (não inventa)
   ├─ CPM → datas, folga, caminho crítico
   └─ 16 verificações de qualidade

10. Exportações → XML MSPDI validado + relatório de validação + XLSX/CSV/JSON
```

## 3. Padrões de interface

- Fonte Arial (fallback Helvetica/system-ui). Densidade alta, cores sóbrias.
- **Todo valor exibido carrega um selo de origem**: `FATO` · `INFORMADO` · `IA` ·
  `PREMISSA` · `PENDENTE` · `CONFLITO`. Sem selo, o valor não é renderizado.
- Dados de demonstração exibem faixa `DEMONSTRAÇÃO` no topo e sufixo `[TESTE]` no nome.
- Estados obrigatórios em toda lista: carregando, vazio, erro, formato não suportado,
  processamento parcial.
