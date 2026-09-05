# 07 — Decisões

Registro das decisões tomadas e das que continuam abertas. Premissa adotada é
premissa, nunca dado de projeto.

## Decisões tomadas (05/09/2026)

| # | Decisão | O que foi decidido | Consequência |
|---|---|---|---|
| **D4** | Conversor CAD (DWG/DXF) | **Não há orçamento** para ODA File Converter nem para Autodesk APS | DWG não será convertido. A Fase 2 deixa de ser "conversão" e passa a ser: parser DXF próprio + exigência de DXF na entrega documental |
| **D5** | Derivação BIM (NWD/NWC) | **Não há orçamento** para Autodesk APS | NWD não será lido. A Fase 3 passa a depender de o emissor exportar IFC ou CSV de propriedades do Navisworks |
| **D6** | Base de produtividade | A base vem de **arquivo importado**, com campo de importação no produto | Implementado: XLSX, CSV e PDF. O arquivo passa a ser a fonte do índice, com hash, aba e linha registrados |

### O conflito que essas decisões criam

Os formatos que a obra vai enviar incluem DWG e NWD, e não há orçamento para
convertê-los. Isso não é um impasse técnico — é uma **decisão de processo documental**
que precisa ser tomada com o cliente:

- **DWG** → exigir DXF junto na entrega. Custo zero para nós; um passo a mais para o
  projetista, que exporta DXF em um comando. Alternativa sem custo e sem pedido ao
  cliente: LibreDWG (GPL-3), viável do lado do servidor sem obrigação de distribuição,
  porém com cobertura incompleta das versões recentes de DWG. É opção com risco, não
  solução pronta.
- **NWD** → exigir IFC, ou o CSV de propriedades e o relatório de clash exportados do
  próprio Navisworks. Não existe leitor aberto de NWD; nenhuma engenharia contorna isso.

Enquanto essa exigência não estiver no procedimento de entrega documental do contrato,
DWG e NWD continuam sendo armazenados íntegros e **declarados como não interpretados**.

## Decisões ainda abertas

| # | Decisão | Premissa adotada | Impacto se mudar |
|---|---|---|---|
| **D1** | **Onde o dado pode residir** — nuvem pública, nuvem privada do cliente ou on-premise sem saída de internet | on-premise/VPS, região configurável, sem provedor externo de OCR ou IA | **alto**: decide se OCR e IA de nuvem são sequer possíveis |
| D2 | Provedor de OCR | nenhum (adaptador vazio → pendência explícita) | médio |
| D3 | Provedor de LLM | `null` (extração só por regra determinística) | médio |
| D7 | Precedência documental na reconciliação | nenhuma; conflito fica exposto até regra ser aprovada | médio |
| D8 | Versão do MS Project | 2016 (MSPDI, `SaveVersion=14`) | baixo |
| D9 | Idioma da interface | pt-BR | baixo |
| D10 | SSO corporativo | e-mail+senha; OIDC previsto na Fase 4 | médio |

| # | Decisão | Premissa adotada | Impacto se mudar |
|---|---|---|---|
| D1 | Hospedagem e soberania do dado | Docker em VPS/on-premise; região configurável | baixo (env) |
| D2 | Provedor de OCR | nenhum (adaptador vazio → pendência explícita) | médio |
| D3 | Provedor de LLM | `null` (extração só por regra determinística) | médio |
| D4 | Conversor CAD (Fase 2) | ODA File Converter | alto (custo/licença) |
| D5 | Derivação BIM (Fase 3) | Autodesk APS | alto (custo por conversão) |
| D6 | Índices de produtividade de referência | **nenhum embutido**; o sistema exige fonte e data | alto se alguém quiser default |
| D7 | Precedência documental na reconciliação | nenhuma; conflito fica exposto até regra ser aprovada | médio |
| D8 | Versão do MS Project | 2016 (MSPDI, `SaveVersion=14`) | baixo |
| D9 | Idioma da interface | pt-BR | baixo |
| D10 | SSO corporativo | e-mail+senha; OIDC previsto na Fase 4 | médio |

## A pergunta que continua aberta

**Onde o dado pode residir?** A resposta recebida listou os formatos que vão chegar
(PDF, DWG, NWD), não o local onde eles podem ser processados. A distinção importa:

- Se o documento **pode sair** do perímetro do cliente, OCR e IA de nuvem entram em
  discussão (custo por página, contrato de tratamento de dados).
- Se **não pode**, o OCR precisa ser local (Tesseract, custo zero, qualidade menor em
  prancha) e a IA sai de cena. O produto já funciona assim — é o padrão de fábrica.

Enquanto não houver resposta, vale a premissa mais conservadora: nada sai do perímetro.
`Project.allowExternalAi` continua `false` por padrão.
