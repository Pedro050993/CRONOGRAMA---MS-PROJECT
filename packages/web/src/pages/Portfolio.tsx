import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import type { Project } from '../lib/types';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';

const EMPTY = {
  name: '', client: '', contract: '', scopeSummary: '', site: '',
  definitionOfDone: '', contractStart: '', contractFinish: '', disciplines: 'PIPING',
};

export function Portfolio(): JSX.Element {
  const { data, loading, error, reload } = useApi<Project[]>('/api/projects');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [result, setResult] = useState<{ openIssuesCreated: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post<{ project: Project; openIssuesCreated: number }>('/api/projects', {
        name: form.name,
        client: form.client || undefined,
        contract: form.contract || undefined,
        scopeSummary: form.scopeSummary || undefined,
        site: form.site || undefined,
        definitionOfDone: form.definitionOfDone || undefined,
        contractStart: form.contractStart ? new Date(`${form.contractStart}T07:00:00Z`).toISOString() : undefined,
        contractFinish: form.contractFinish ? new Date(`${form.contractFinish}T16:00:00Z`).toISOString() : undefined,
        disciplines: form.disciplines.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setResult({ openIssuesCreated: r.openIssuesCreated });
      setForm(EMPTY);
      setCreating(false);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Portfolio</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setCreating(!creating)}>
          {creating ? 'Cancelar' : 'Novo projeto'}
        </button>
      </div>

      {result && (
        <Notice tone={result.openIssuesCreated > 0 ? 'warn' : 'ok'} title="Projeto criado">
          {result.openIssuesCreated > 0
            ? `${result.openIssuesCreated} campo(s) essencial(is) nao foram informados e viraram PENDENCIA. ` +
              'O sistema nao preenche esses campos com valor generico.'
            : 'Todos os campos essenciais foram informados.'}
        </Notice>
      )}

      {creating && (
        <Card title="Novo projeto">
          <Notice tone="info" title="Campos nao informados viram pendencia">
            Nada e preenchido automaticamente. O que faltar sera registrado como pendencia rastreavel
            na tela de Riscos e inconsistencias.
          </Notice>
          <form onSubmit={create}>
            <div className="grid grid--2">
              <Field label="Nome do projeto *"><input value={form.name} onChange={set('name')} required minLength={2} /></Field>
              <Field label="Cliente"><input value={form.client} onChange={set('client')} /></Field>
              <Field label="Contrato"><input value={form.contract} onChange={set('contract')} /></Field>
              <Field label="Local da obra"><input value={form.site} onChange={set('site')} /></Field>
              <Field label="Inicio contratual"><input type="date" value={form.contractStart} onChange={set('contractStart')} /></Field>
              <Field label="Marco final contratual"><input type="date" value={form.contractFinish} onChange={set('contractFinish')} /></Field>
              <Field label="Disciplinas" hint="Separadas por virgula."><input value={form.disciplines} onChange={set('disciplines')} /></Field>
            </div>
            <Field label="Escopo contratado"><textarea rows={2} value={form.scopeSummary} onChange={set('scopeSummary')} /></Field>
            <Field
              label='Definicao objetiva de "entregue"'
              hint="O criterio que encerra a obrigacao contratual. Sem ele, o cronograma nao tem alvo verificavel."
            >
              <textarea rows={2} value={form.definitionOfDone} onChange={set('definitionOfDone')} />
            </Field>
            <button className="primary" disabled={busy}>{busy ? 'Criando…' : 'Criar projeto'}</button>
          </form>
        </Card>
      )}

      <AsyncBoundary
        loading={loading} error={error} empty={!data?.length}
        emptyTitle="Nenhum projeto ainda"
        emptyHint="Crie o primeiro projeto para comecar a receber documentos."
      >
        <div className="grid grid--3">
          {data?.map((p) => (
            <Card key={p.id} title={<Link to={`/p/${p.id}`}>{p.name}</Link>}>
              <div className="stack small">
                <div><span className="muted">Cliente:</span> {p.client ?? <em className="muted">nao informado</em>}</div>
                <div><span className="muted">Contrato:</span> {p.contract ?? <em className="muted">nao informado</em>}</div>
                <div><span className="muted">Prazo:</span> {fmtDate(p.contractStart)} a {fmtDate(p.contractFinish)}</div>
                <div className="row" style={{ marginTop: 6 }}>
                  <span className="badge badge--rule">{p.myRole}</span>
                  {p.isDemo && <span className="badge badge--assumption">DEMONSTRACAO</span>}
                </div>
                <div className="row small muted" style={{ marginTop: 6 }}>
                  <span>{p._count?.documents ?? 0} documentos</span>
                  <span>{p._count?.activities ?? 0} atividades</span>
                  <span>{p._count?.openIssues ?? 0} pendencias</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </AsyncBoundary>
    </>
  );
}
