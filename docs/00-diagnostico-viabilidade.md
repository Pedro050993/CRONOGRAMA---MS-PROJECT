# 00 — Diagnóstico de viabilidade

> Documento de premissas de engenharia de software. Nenhum número aqui é dado de obra.
> Classificação: **Premissa técnica** salvo indicação contrária.

## 1. Compreensão objetiva do problema

O pedido não é "um app de cronograma". É uma **cadeia de custódia da informação de engenharia**:

```
documento → evidência → entidade técnica → quantitativo → pacote (EAP/AWP)
   → sequência → duração → cronograma → XML MS Project
```

Cada elo precisa ser rastreável até o anterior, revisável por humano e reversível.
O cronograma é a **saída**, não o produto. O produto é a confiabilidade do dado que
sustenta a data. Um cronograma bonito com quantitativo inventado é pior que nenhum
cronograma, porque cria confiança falsa e destrói posição contratual em pleito.

Consequência de projeto: o núcleo do sistema é o **modelo de proveniência**
(`Evidence`, `confidence`, `reviewStatus`, `approvedBy`), não o Gantt.

## 2. O que é viável no navegador × o que exige backend

| Capacidade | Navegador puro | Exige backend/serviço | Observação |
|---|---|---|---|
| Renderizar UI, Gantt, grafo, tabelas | ✅ | — | SVG/Canvas resolve |
| Upload de arquivo/pasta/ZIP | ✅ (captura) | ✅ (persistência, hash, antivírus) | `webkitdirectory` captura pasta; o navegador não guarda |
| Hash SHA-256 para deduplicação | ✅ (WebCrypto) | ✅ (fonte da verdade) | hash no cliente é otimização, não autoridade |
| PDF com camada de texto → Markdown | ⚠️ parcial (pdf.js) | ✅ | ordem de leitura e regiões exigem processamento pesado |
| OCR de PDF escaneado / imagem | ❌ prático | ✅ | Tesseract WASM é lento e não auditável em lote |
| DWG / DXF | DXF ⚠️ / DWG ❌ | ✅ | DWG é formato proprietário; exige ODA File Converter ou APS |
| NWD / NWC | ❌ | ✅ | proprietário Navisworks; exige APS Model Derivative ou export intermediário |
| CPM, cálculo de duração, XML MSPDI | ✅ | ✅ (autoridade) | lógica é determinística; roda nos dois lados, mas a versão aprovada é do servidor |
| Colaboração, RBAC, auditoria, baseline | ❌ | ✅ | por definição |
| IA/LLM | ❌ (chave no cliente = vazamento) | ✅ | §19 proíbe chave no frontend |

**Conclusão:** HTML estático está descartado por 6 requisitos independentes
(persistência, OCR, CAD/BIM, RBAC, auditoria, IA). Arquitetura cliente-servidor é obrigatória.

## 3. Os cinco maiores riscos do produto

| # | Risco | Por que mata o produto | Mitigação adotada |
|---|---|---|---|
| R1 | **Alucinação com aparência de dado de obra** | destrói confiança e posição em pleito; irreversível reputacionalmente | toda entidade nasce com `Evidence` obrigatória; sem evidência o registro é `PENDING_INFO`, nunca valor default. Duração sem insumo retorna `NOT_CALCULABLE` (testado) |
| R2 | **Extração de isométrico é o gargalo real, não o cronograma** | isométrico é desenho vetorial com convenções por projetista; taxa de acerto varia muito | pipeline com confiança por campo + tela de validação obrigatória + take-off manual sempre disponível; nunca bloqueia o fluxo |
| R3 | **Dependência de terceiros para CAD/BIM (custo e licença)** | ODA/APS têm custo por conversão e termos de uso; pode inviabilizar comercialmente | adaptador `CadConverter`/`ModelDeriver` com implementação `unsupported` explícita na Fase 1; bloqueio visível ao usuário, nunca silencioso |
| R4 | **Sequenciamento tratado como verdade** | rede de precedências errada gera caminho crítico falso e decisão errada de efetivo | toda ligação carrega `reason`, `sourceRef`, `confidence` e nasce `SUGGESTED`; só `VALIDATED` entra na baseline; função "Por que esta atividade vem antes?" |
| R5 | **Aceitação: planejador não confia e volta para o Excel** | produto morre por adoção, não por técnica | exportação total (XLSX/CSV/JSON/XML) sem lock-in; import de XML existente para auditoria; edição manual sempre permitida com registro |

Riscos secundários registrados: dupla contagem entre MTO/isométrico/modelo 3D;
mistura de unidades (pol-diâmetro × junta × kg); LGPD/soberania de dado do cliente.

## 4. Viabilidade por fase

| Fase | Viabilidade técnica | Dependência externa | Confiança |
|---|---|---|---|
| 1 — PDF/imagem, validação, EAP, cronograma, XML | Alta | nenhuma obrigatória (OCR e LLM são opcionais e plugáveis) | Alta |
| 2 — DWG/DXF | Média | ODA File Converter (licença) ou APS | Média |
| 3 — NWD/NWC | Média-baixa | Autodesk APS (custo por conversão) | Baixa |
| 4 — Demais disciplinas, LPS, portfólio | Alta | nenhuma | Média-alta |

## 5. O que este repositório entrega hoje

Fase 1 implementada de ponta a ponta (frontend → API → banco → worker), com
motores determinísticos cobertos por teste automatizado e limitações declaradas
em `docs/10-limitacoes-conhecidas.md`.
