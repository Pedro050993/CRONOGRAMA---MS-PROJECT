# 08 — Instalação e execução

## 1. Requisitos

| Componente | Versão | Obrigatório |
|---|---|---|
| Node.js | ≥ 20.11 (testado em 22) | sim |
| PostgreSQL | ≥ 14 (testado em 16) | sim |
| Python | ≥ 3.11 | sim, para o worker |
| Docker + Compose | recente | só para o caminho conteinerizado |
| Tesseract OCR | 5.x | **não** — sem ele o sistema declara a limitação |

## 2. Caminho rápido: Docker

```bash
cp .env.example .env
# Preencha, no mínimo:
#   JWT_SECRET             → openssl rand -base64 48
#   POSTGRES_PASSWORD      → senha do banco
#   S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY → credenciais do MinIO

docker compose up --build
```

- Interface: <http://localhost:8080>
- API: <http://localhost:3001/api/health>
- Console do MinIO: <http://localhost:9001>

As migrações rodam sozinhas no serviço `migrate` antes da API subir.

Para habilitar OCR local: `WITH_OCR=true OCR_PROVIDER=tesseract docker compose up --build`.

Para escalar o processamento: `DOCPROC_REPLICAS=4 docker compose up -d`. Cada worker
reivindica jobs distintos via `SKIP LOCKED`; não há configuração adicional.

## 3. Caminho de desenvolvimento

```bash
npm install

# Banco
createdb cronograma
cp .env.example .env      # ajuste DATABASE_URL e JWT_SECRET
npm run prisma:migrate -w @cronograma/api

# Dados de demonstração (opcional, tudo marcado como [DEMONSTRACAO])
npm run seed -w @cronograma/api

# API + frontend
npm run dev
```

Worker, em outro terminal:

```bash
cd services/docproc
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
export $(grep -v '^#' ../../.env | xargs)
python -m docproc.worker
```

## 4. Testes

```bash
npm test                  # core (142) + api (60), API contra PostgreSQL real
npm run test:core         # só o domínio, sem banco
npm run test:api          # integração; exige DATABASE_URL de teste
npm run test:e2e          # Playwright: navegador contra API e frontend reais

cd services/docproc && pytest                       # 24 testes de unidade
DOCPROC_TEST_DATABASE_URL=... pytest                # + 8 de integração
```

Os testes da API criam e limpam o schema do banco apontado por `TEST_DATABASE_URL`
(padrão `cronograma_test`). **Nunca aponte para o banco de produção**: a suíte
executa `TRUNCATE ... CASCADE` entre os casos.

## 5. Primeiro uso

1. Abra a interface e clique em **Criar organização**. O primeiro usuário é o dono.
2. **Portfólio → Novo projeto.** Campos deixados em branco viram pendências
   rastreáveis, visíveis em *Riscos e inconsistências*.
3. **Administração e auditoria** → adicione os demais usuários e defina papéis.
4. **Documentos** → arraste a lista de linhas e os isométricos (arquivo, pasta ou ZIP).
5. **Processamento** → acompanhe a fila. O quadro de capacidades mostra o que este
   ambiente realmente tem (OCR, IA, CAD, 3D).
6. **Validação** → aprove ou corrija cada item com a evidência ao lado.
7. **EAP e AWP** → monte Projeto → CWA → CWP → IWP.
8. **Cronograma** → *Calcular durações* → *Calcular CPM* → *Congelar linha de base*.
9. **Exportações** → confira o relatório de validação e baixe o XML.

## 6. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| API não sobe: "Variável de ambiente obrigatória ausente" | `.env` incompleto | preencha `DATABASE_URL` e `JWT_SECRET` |
| Documento fica `PENDING` para sempre | worker parado | verifique o log do `docproc` |
| Página vira pendência de OCR | `OCR_PROVIDER=none` | comportamento pretendido; configure um provedor ou envie PDF vetorial |
| 409 ao salvar | outra pessoa alterou o registro | recarregue, compare e reenvie |
| DWG/NWD bloqueado | Fase 2/3 não configurada | envie DXF, IFC ou PDF vetorial |
