# 07 — Decisões ainda necessárias

Nenhuma bloqueia a Fase 1. Todas têm **premissa padrão adotada e registrada** —
premissa, não dado de projeto.

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

## Três perguntas realmente bloqueantes (para a Fase 2 em diante)

1. **Onde o dado pode residir?** Nuvem pública, nuvem privada do cliente, ou on-premise
   sem saída de internet? Isso decide se OCR/LLM externos são sequer possíveis.
2. **Há orçamento para conversão CAD/BIM licenciada (ODA/APS)?** Sem isso, DWG e NWD
   permanecem bloqueados e o escopo de Fase 2/3 muda de "conversão" para "exigir DXF/IFC".
3. **Qual base de produtividade é a oficial?** Histórico próprio da empresa, orçamento
   contratual, ou norma/benchmark? Sem definir a fonte de verdade, o cronograma calcula,
   mas não é defensável em pleito.
