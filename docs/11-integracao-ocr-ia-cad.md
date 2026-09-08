# 11 — Conectando OCR, IA e conversão CAD/BIM

Todos os provedores externos são **adaptadores**. O padrão de fábrica é "nenhum", e o
sistema funciona assim — declarando o que não consegue fazer.

## 1. OCR

Interface: `services/docproc/src/docproc/adapters/ocr.py`.

```python
class OcrAdapter(Protocol):
    name: str
    def available(self) -> bool: ...
    def recognize(self, image_bytes: bytes, languages: str) -> OcrResult: ...
```

**Tesseract (local, sem custo por página):**

```bash
apt-get install -y tesseract-ocr tesseract-ocr-por tesseract-ocr-eng
pip install pytesseract opencv-python-headless
# .env
OCR_PROVIDER=tesseract
OCR_LANGUAGES=por+eng
```

Ou, no Docker: `WITH_OCR=true docker compose up --build`.

**Provedor de nuvem (Azure Document Intelligence, Google Document AI):** implemente
uma classe com o mesmo protocolo e registre em `build_ocr()`. O contrato a respeitar:

1. Devolver `confidence` **por palavra**, não só do documento. A tela de validação
   prioriza o pior caso, e uma confiança média esconde a linha ruim.
2. Devolver `bbox` na mesma escala da imagem enviada. O worker converte para pontos PDF.
3. Levantar `OcrUnavailable` quando não puder operar. **Nunca devolver texto vazio
   como se fosse sucesso** — é assim que uma prancha ilegível vira um cronograma
   aparentemente completo.

Antes de mandar documento para fora, confirme `Project.allowExternalAi`.

## 2. IA generativa

Interface: `services/docproc/src/docproc/adapters/llm.py`.

O adaptador impõe três regras, independentemente do provedor:

1. **Sem trecho de evidência, o campo é descartado.** `drop_unevidenced()` verifica que
   o trecho citado existe literalmente no texto de origem. Um modelo que "sabe" o valor
   mas não consegue apontá-lo no documento está inventando.
2. Toda saída entra como `AI_INFERENCE` com `reviewStatus = PENDING`. Ela não alimenta
   quantitativo, EAP nem cronograma aprovado até um humano revisar.
3. Sem provedor configurado, a extração usa apenas regras determinísticas.

Para conectar, implemente `LlmAdapter` e registre em `build_llm()`. Sugestão de uso
onde a regra determinística é fraca: normalizar descrição de material heterogênea,
propor a disciplina de um documento ambíguo, sugerir agrupamento de IWP. Não use para
ler número: regex e parser de tabela erram de forma previsível e auditável.

## 3. Conversão CAD (Fase 2)

Interface prevista: `CadConverter`, com `FORMAT_SUPPORT` em
`packages/core/src/formats/index.ts` já declarando o bloqueio.

**ODA File Converter** (licença comercial da Open Design Alliance): container isolado,
converte DWG → DXF; o parser de DXF é próprio. Custo: licença por servidor.

**Autodesk APS (Model Derivative):** converte DWG e publica SVF2 para visualização web.
Custo por conversão. Exige que o arquivo suba para a nuvem da Autodesk — verifique
`allowExternalAi` e o contrato do cliente antes.

O que a Fase 2 precisa extrair: layers, blocos e atributos, textos e cotas, coordenadas,
polilinhas, XREFs, unidades, carimbo e revisão.

## 4. Derivação de modelo 3D (Fase 3)

`ModelDeriver` → Autodesk APS. NWD e NWC são proprietários e não têm leitura nativa;
qualquer promessa em contrário é falsa.

Extrair: árvore do modelo, propriedades por objeto, disciplina e categoria, coordenadas
e *bounding box*, *viewpoints*, dados de *clash*, quantitativos sem duplicar elementos
agregados.

Atenção ao quantitativo de modelo: um elemento agregado (um "sistema" que contém suas
linhas) somado junto com seus filhos duplica tudo. A verificação de dupla contagem por
`entityKey` já cobre isso, mas a extração precisa marcar o nível de agregação.

## 5. Armazenamento

`StorageAdapter` (`packages/api/src/storage/index.ts`) tem `fs` e `s3`. Qualquer
serviço compatível com S3 serve: MinIO, AWS, Wasabi, Backblaze, ou um MinIO
on-premise quando o dado não pode sair da planta.

## 6. Custo dependente de terceiros

| Serviço | Modelo de cobrança | Impacto |
|---|---|---|
| OCR local (Tesseract) | zero | CPU do servidor |
| OCR de nuvem | por página | relevante em lote de milhares de pranchas |
| LLM | por token | controlável: use só onde a regra falha |
| ODA File Converter | licença por servidor | custo fixo |
| Autodesk APS | por conversão + armazenamento | **maior risco de custo do produto** |

Recomendação: comece sem nenhum. Meça onde a extração determinística realmente falha e
só então contrate o provedor que resolve aquele gargalo específico.
