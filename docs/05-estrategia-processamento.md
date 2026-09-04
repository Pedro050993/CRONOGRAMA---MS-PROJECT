# 05 — Estratégia de processamento por formato

## Princípio comum

1. O binário original é **imutável** (`content-addressed` por SHA-256).
2. Toda derivação registra `method`, `providerVersion`, `confidence`, `processedAt`.
3. Falha de conversão é **bloqueio visível**, nunca fallback silencioso para "texto vazio".

## PDF

| Etapa | Implementação | Fallback |
|---|---|---|
| Classificar página | `VECTOR` \| `SCANNED` \| `MIXED` por razão de caracteres/área | — |
| Extrair texto vetorial | PyMuPDF, com bbox por bloco/linha/palavra | — |
| OCR | apenas regiões sem texto, via `OcrAdapter` | sem provedor → região marcada `OCR_UNAVAILABLE` + pendência |
| Carimbo/título/revisão | heurística de região (canto inferior direito, maior densidade de rótulos) + regex de revisão | campo fica `PENDING_INFO` |
| Desenho grande | tesselado em regiões com coordenadas preservadas | — |
| Markdown | por página/folha, com âncora de região | — |

Âncora de rastreabilidade embutida no Markdown:

```markdown
<!--@ doc=DOC-0007 rev=B page=2 bbox=[812,140,1466,372] method=vector conf=0.98 -->
| ITEM | QTY | DESCRIPTION | NPS | SCH |
```

## Imagens (PNG/JPG/JPEG/TIFF)

Pré-processamento (Pillow/OpenCV): correção de rotação (Hough), deskew, contraste
(CLAHE), remoção de ruído (mediana), binarização adaptativa → OCR → Markdown + JSON.
Original nunca é alterado; derivados vão para `derived/`.

## DWG / DXF — Fase 2

- **DXF**: parser próprio (ASCII/binário) → layers, blocos, atributos, textos, cotas,
  polilinhas, coordenadas, unidades, XREFs.
- **DWG**: `CadConverterAdapter` → ODA File Converter (container isolado) ou APS.
- Fase 1 retorna `UNSUPPORTED_FORMAT` com mensagem acionável pedindo DXF/DWF/PDF vetorial.

## NWD / NWC — Fase 3

`ModelDeriverAdapter` → Autodesk APS Model Derivative (SVF2 + propriedades).
Extrai árvore, propriedades, disciplina, coordenadas, bounding box, viewpoints, clashes.
Fase 1 e 2 retornam `UNSUPPORTED_FORMAT`. **Nunca** é prometida leitura nativa.

## Camada de IA

`LlmAdapter` com provedores: `null` (padrão), `openai-compat`, `anthropic`.
Regras de uso:
- IA **nunca** preenche campo numérico sem trecho de evidência citado.
- Resposta sem `evidenceSpan` é descartada e vira pendência.
- Toda saída entra como `reviewStatus=PENDING`.
- `project.allowExternalAi=false` por padrão: sem consentimento explícito, o documento
  não sai do perímetro.
