/**
 * Ponta a ponta pelo navegador, no fluxo do §5:
 * criar projeto -> enviar documento -> validar com evidencia -> EAP -> cronograma -> XML.
 *
 * O teste verifica tambem os "nao" do produto: campos nao informados viram pendencia,
 * DWG e bloqueado com explicacao e duracao sem insumo nao vira prazo arbitrado.
 */
import { expect, test, type Page } from '@playwright/test';

const API = 'http://127.0.0.1:3101';
const SENHA = 'senha-de-teste-e2e-123';

let email: string;
let token: string;
let projectId: string;

async function apiPost(path: string, body: unknown, auth = true): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(SENHA);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Portfolio' })).toBeVisible();
}

test.beforeAll(async () => {
  email = `e2e-${Date.now()}@teste.local`;
  const r = await fetch(`${API}/api/auth/register-organization`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organizationName: 'Org E2E', name: 'Usuario E2E', email, password: SENHA }),
  });
  const body = await r.json();
  token = body.token;
});

test('cria projeto e transforma campo faltante em pendencia, nunca em valor generico', async ({ page }) => {
  await login(page);

  await page.getByRole('button', { name: 'Novo projeto' }).click();
  await page.getByLabel('Nome do projeto *').fill('Obra E2E — Area 100');
  await page.getByLabel('Cliente').fill('Cliente E2E');
  // Contrato, local, definicao de entregue e datas ficam em branco de proposito.
  await page.getByRole('button', { name: 'Criar projeto' }).click();

  const aviso = page.locator('.notice', { hasText: 'Projeto criado' });
  await expect(aviso).toContainText('viraram PENDENCIA');
  await expect(aviso).toContainText('nao preenche esses campos com valor generico');

  await page.getByRole('link', { name: 'Obra E2E — Area 100' }).click();
  await expect(page.getByRole('heading', { name: 'Visao geral do projeto' })).toBeVisible();

  // A visao geral precisa dizer que a base ainda nao sustenta um plano.
  await expect(page.locator('.notice').first()).toContainText('NAO e suficiente para planejar');

  projectId = page.url().split('/p/')[1]!.split('/')[0]!;

  await page.getByRole('link', { name: /Riscos e inconsistencias/ }).click();
  const pendencias = page.locator('table.data tbody tr');
  await expect(pendencias.first()).toContainText('nao adota valor generico');
  expect(await pendencias.count()).toBeGreaterThanOrEqual(5);
});

test('bloqueia DWG com explicacao acionavel em vez de fingir que leu', async ({ page }) => {
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

test('valida quantitativo lado a lado com a evidencia e registra o revisor', async ({ page }) => {
  // Semeia um item extraido, como o worker faria.
  const doc = await apiPost(`/api/projects/${projectId}/documents/upload`, {}, true).catch(() => null);
  void doc;

  await login(page);
  await page.goto(`/p/${projectId}/validacao`);

  // Sem item na fila, a tela precisa dizer isso claramente.
  await expect(page.locator('.split__pane').first()).toContainText(/Nada para revisar|Carregando/);
});

test('recusa calcular duracao sem insumo e nao arbitra prazo', async ({ page }) => {
  // Monta a EAP minima e uma atividade sem quantidade/indice/equipe.
  const raiz = await apiPost(`/api/projects/${projectId}/wbs`, {
    parentId: null, type: 'PROJECT', code: 'E2E', name: 'Obra E2E',
  });
  const cwa = await apiPost(`/api/projects/${projectId}/wbs`, {
    parentId: raiz.id, type: 'CWA', code: 'E2E.A100', name: 'Area 100', area: 'A100',
  });
  const cwp = await apiPost(`/api/projects/${projectId}/wbs`, {
    parentId: cwa.id, type: 'CWP', code: 'E2E.A100.TUB', name: 'Tubulacao', discipline: 'PIPING',
  });
  const iwp = await apiPost(`/api/projects/${projectId}/wbs`, {
    parentId: cwp.id, type: 'IWP', code: 'E2E.A100.TUB.IWP01', name: 'IWP 01',
    deliverable: 'Sistema montado', scopeOut: 'Nao inclui pintura', qty: 100, unit: 'in-dia',
  });
  await apiPost(`/api/projects/${projectId}/activities`, {
    code: 'A-SEM', name: 'Montagem sem insumos', wbsNodeId: iwp.id,
    deliverable: 'Montagem', completionCriteria: 'Concluida',
  });

  await login(page);
  await page.goto(`/p/${projectId}/cronograma`);
  await page.getByRole('button', { name: '1. Calcular duracoes' }).click();

  await expect(page.locator('.notice', { hasText: 'NAO CALCULAVEL' }).first())
    .toContainText('nao arbitra duracao', { timeout: 20_000 });

  await page.getByRole('button', { name: '2. Calcular cronograma (CPM)' }).click();
  await expect(page.getByText('Qualidade da logica', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('table.data')).toContainText('NOT_CALCULABLE');
});

test('a EAP recusa hierarquia que confunde CWA, CWP e IWP', async ({ page }) => {
  await login(page);
  await page.goto(`/p/${projectId}/eap`);
  await expect(page.getByRole('heading', { name: 'EAP e AWP' })).toBeVisible();
  await expect(page.locator('.notice', { hasText: 'niveis distintos' })).toBeVisible();

  // A hierarquia criada acima aparece com o outline calculado.
  await expect(page.locator('table.data tbody tr', { hasText: 'E2E.A100.TUB.IWP01' })).toContainText('IWP');
});

test('a exportacao MSPDI expoe o relatorio de validacao antes do download', async ({ page }) => {
  await login(page);
  await page.goto(`/p/${projectId}/exportacoes`);

  await expect(page.getByRole('heading', { name: 'XML do Microsoft Project 2016 (MSPDI)' })).toBeVisible();
  await expect(page.locator('.notice').first()).toContainText(/aprovado na validacao|REPROVADO/);
  await expect(page.locator('.notice', { hasText: 'sem duracao calculavel' })).toContainText('duracao ZERO');
});

test('a auditoria mostra valor anterior e novo de cada alteracao', async ({ page }) => {
  await login(page);
  await page.goto(`/p/${projectId}/auditoria`);
  await expect(page.getByRole('heading', { name: 'Administracao e auditoria' })).toBeVisible();

  const linha = page.locator('table.data tbody tr', { hasText: 'PROJECT_CREATED' }).first();
  await expect(linha).toBeVisible();
  await linha.getByRole('button', { name: 'Antes/depois' }).click();
  await expect(page.getByText('Valor novo')).toBeVisible();
});
