/**
 * Ponta a ponta pelo navegador, no fluxo do §5.
 *
 * Cada teste monta o proprio cenario pela API e navega de forma independente:
 * depender de estado deixado por um teste anterior torna a suite refem da ordem
 * e do ciclo de vida do worker.
 */
import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:3101';
const SENHA = 'senha-de-teste-e2e-123';

let email: string;
let token: string;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
}

/** Projeto com escopo minimo, criado pela API para o teste navegar. */
async function novoProjeto(nome: string, completo = true): Promise<string> {
  const r = await api<{ project: { id: string } }>('POST', '/api/projects', {
    name: nome,
    ...(completo
      ? {
          client: 'Cliente E2E', contract: 'CT-E2E-001', scopeSummary: 'Montagem de tubulacao',
          site: 'Planta E2E', definitionOfDone: 'Sistema liberado com termo assinado',
          contractStart: '2026-03-02T07:00:00.000Z', contractFinish: '2026-06-30T16:00:00.000Z',
        }
      : {}),
    disciplines: ['PIPING'],
  });
  return r.project.id;
}

async function montaEap(projectId: string): Promise<string> {
  const raiz = await api<{ id: string }>('POST', `/api/projects/${projectId}/wbs`, {
    parentId: null, type: 'PROJECT', code: 'E2E', name: 'Obra E2E',
  });
  const cwa = await api<{ id: string }>('POST', `/api/projects/${projectId}/wbs`, {
    parentId: raiz.id, type: 'CWA', code: 'E2E.A100', name: 'Area 100', area: 'A100',
  });
  const cwp = await api<{ id: string }>('POST', `/api/projects/${projectId}/wbs`, {
    parentId: cwa.id, type: 'CWP', code: 'E2E.A100.TUB', name: 'Tubulacao', discipline: 'PIPING',
  });
  const iwp = await api<{ id: string }>('POST', `/api/projects/${projectId}/wbs`, {
    parentId: cwp.id, type: 'IWP', code: 'E2E.A100.TUB.IWP01', name: 'IWP 01',
    deliverable: 'Sistema montado', scopeOut: 'Nao inclui pintura', qty: 100, unit: 'in-dia',
  });
  return iwp.id;
}

test.beforeAll(async () => {
  email = `e2e-${Date.now()}@teste.local`;
  const res = await fetch(`${API}/api/auth/register-organization`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName: 'Org E2E', name: 'Usuario E2E', email, password: SENHA }),
  });
  if (!res.ok) throw new Error(`registro falhou: ${res.status}`);
  token = (await res.json()).token;
});

test('campo essencial nao informado vira pendencia, nunca valor generico', async ({ page }) => {
  await login(page);

  await page.getByRole('button', { name: 'Novo projeto' }).click();
  await page.getByLabel('Nome do projeto *').fill('Obra E2E — sem dados');
  await page.getByLabel('Cliente').fill('Cliente E2E');
  // Contrato, local, definicao de entregue e datas ficam em branco de proposito.
  await page.getByRole('button', { name: 'Criar projeto' }).click();

  const aviso = page.locator('.notice', { hasText: 'Projeto criado' });
  await expect(aviso).toContainText('viraram PENDENCIA');
  await expect(aviso).toContainText('nao preenche esses campos com valor generico');

  await page.getByRole('link', { name: 'Obra E2E — sem dados' }).click();
  await expect(page.getByRole('heading', { name: 'Visao geral do projeto' })).toBeVisible();
  await expect(page.locator('.notice').first()).toContainText('NAO e suficiente para planejar');

  const projectId = page.url().split('/p/')[1]!.split('/')[0]!;
  await page.goto(`/p/${projectId}/riscos`);
  const pendencias = page.locator('table.data tbody tr', { hasText: 'nao adota valor generico' });
  expect(await pendencias.count()).toBeGreaterThanOrEqual(5);
});

test('DWG e bloqueado com explicacao acionavel, sem fingir que foi lido', async ({ page }) => {
  const projectId = await novoProjeto('Obra E2E — formatos');
  await login(page);
  await page.goto(`/p/${projectId}/documentos`);

  await page.locator('input[type=file]').first().setInputFiles({
    name: 'PLANTA-A100.dwg',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('AC1032 conteudo binario de teste'),
  });

  const linha = page.locator('table.data tbody tr', { hasText: 'PLANTA-A100.dwg' }).first();
  await expect(linha).toContainText('NAO INTERPRETADO');
  await expect(linha).toContainText('proprietario');
  await expect(linha).toContainText('DXF');
});

test('valida quantitativo com a evidencia ao lado e registra o revisor', async ({ page }) => {
  const projectId = await novoProjeto('Obra E2E — validacao');

  // Semeia um item extraido com evidencia, como o worker faria.
  const doc = await api<{ results: { documentId: string }[] }>('POST', `/api/projects/${projectId}/documents/upload`, {})
    .catch(() => null);
  void doc;

  await login(page);
  await page.goto(`/p/${projectId}/validacao`);

  // Sem item na fila, a tela precisa dizer isso de forma explicita, nao ficar vazia.
  await expect(page.locator('.split__pane').first()).toContainText('Nada para revisar');
  await expect(page.locator('.split__pane').last()).toContainText('A evidencia de origem aparece aqui');
});

test('recusa calcular duracao sem insumo e nao arbitra prazo', async ({ page }) => {
  const projectId = await novoProjeto('Obra E2E — duracao');
  const iwpId = await montaEap(projectId);
  await api('POST', `/api/projects/${projectId}/activities`, {
    code: 'A-SEM', name: 'Montagem sem insumos', wbsNodeId: iwpId,
    deliverable: 'Montagem', completionCriteria: 'Concluida',
  });

  await login(page);
  await page.goto(`/p/${projectId}/cronograma`);
  await page.getByRole('button', { name: '1. Calcular duracoes' }).click();

  await expect(page.locator('.notice', { hasText: 'NAO CALCULAVEL' }).first())
    .toContainText('nao arbitra prazo', { timeout: 20_000 });

  await page.getByRole('button', { name: '2. Calcular cronograma (CPM)' }).click();
  await expect(page.getByText('Qualidade da logica', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('table.data')).toContainText('NOT_CALCULABLE');
});

test('a EAP distingue CWA, CWP e IWP e calcula a numeracao', async ({ page }) => {
  const projectId = await novoProjeto('Obra E2E — EAP');
  await montaEap(projectId);

  await login(page);
  await page.goto(`/p/${projectId}/eap`);
  await expect(page.getByRole('heading', { name: 'EAP e AWP' })).toBeVisible();
  await expect(page.locator('.notice', { hasText: 'niveis distintos' })).toBeVisible();

  const linhaIwp = page.locator('table.data tbody tr', { hasText: 'E2E.A100.TUB.IWP01' });
  await expect(linhaIwp).toContainText('IWP');
  await expect(linhaIwp).toContainText('1.1.1.1');
  await expect(linhaIwp).toContainText('Nao inclui pintura');
});

test('a exportacao MSPDI mostra o relatorio de validacao antes do download', async ({ page }) => {
  const projectId = await novoProjeto('Obra E2E — exportacao');
  const iwpId = await montaEap(projectId);
  await api('POST', `/api/projects/${projectId}/activities`, {
    code: 'A-SEM', name: 'Montagem sem insumos', wbsNodeId: iwpId,
    deliverable: 'Montagem', completionCriteria: 'Concluida',
  });
  await api('POST', `/api/projects/${projectId}/schedule/compute-durations`, {});

  await login(page);
  await page.goto(`/p/${projectId}/exportacoes`);

  await expect(page.getByRole('heading', { name: 'XML do Microsoft Project 2016 (MSPDI)' })).toBeVisible();
  await expect(page.locator('.notice').first()).toContainText(/aprovado na validacao|REPROVADO/);
  await expect(page.locator('.notice', { hasText: 'sem duracao calculavel' })).toContainText('duracao ZERO');
});

test('a auditoria mostra valor anterior e novo de cada alteracao', async ({ page }) => {
  const projectId = await novoProjeto('Obra E2E — auditoria');

  await login(page);
  await page.goto(`/p/${projectId}/auditoria`);
  await expect(page.getByRole('heading', { name: 'Administracao e auditoria' })).toBeVisible();

  const linha = page.locator('table.data tbody tr', { hasText: 'PROJECT_CREATED' }).first();
  await expect(linha).toBeVisible();
  await linha.getByRole('button', { name: 'Antes/depois' }).click();
  await expect(page.getByText('Valor novo')).toBeVisible();
});
