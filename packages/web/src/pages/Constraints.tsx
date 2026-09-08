import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';

interface Constraint {
  id: string; description: string; category: string; owner: string;
  neededBy: string; promisedBy: string | null; status: string;
  removalEvidence: string | null; potentialImpact: string; origin: string; version: number;
}

interface LookaheadEntry {
  activityId: string; name: string; plannedStart: string; canCommit: boolean; reason: string;
  readiness: { score: string; ready: boolean; dimensions: { dimension: string; label: string; verdict: string; blockers: string[] }[] };
}

const CATEGORIES = [
  ['ENGINEERING', 'Engenharia'], ['MATERIAL', 'Material'], ['ACCESS', 'Acesso e area'],
  ['LABOR', 'Mao de obra'], ['EQUIPMENT', 'Equipamentos e ferramentas'], ['SCAFFOLD_RIGGING', 'Andaime e icamento'],
  ['SAFETY_PERMIT', 'Seguranca e permissoes'], ['QUALITY_INSPECTION', 'Qualidade e inspecao'],
  ['PREDECESSOR', 'Predecessoras'], ['INTERFACE', 'Interfaces'], ['OPERATIONAL', 'Condicao operacional'],
  ['DOCUMENTATION', 'Documentacao'], ['CONTRACTUAL', 'Contratual'], ['WEATHER', 'Clima'],
];

export function Constraints(): JSX.Element {
  const { projectId } = useParams();
  const list = useApi<Constraint[]>(`/api/projects/${projectId}/constraints`);
  const lookahead = useApi<LookaheadEntry[]>(`/api/projects/${projectId}/lookahead?weeks=6`);
  const [creating, setCreating] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [form, setForm] = useState({
    description: '', category: 'MATERIAL', owner: '', neededBy: '', promisedBy: '',
    potentialImpact: '', origin: '',
  });

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post(`/api/projects/${projectId}/constraints`, {
        ...form,
        neededBy: new Date(`${form.neededBy}T00:00:00Z`).toISOString(),
        promisedBy: form.promisedBy ? new Date(`${form.promisedBy}T00:00:00Z`).toISOString() : undefined,
      });
      setCreating(false);
      setMsg({ tone: 'ok', text: 'Restricao registrada.' });
      list.reload();
      lookahead.reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof Error ? err.message : 'Falha ao registrar.' });
    }
  };

  const remove = async (c: Constraint): Promise<void> => {
    const evidence = prompt('Evidencia de remocao (nota fiscal, termo, registro):');
    if (!evidence) return;
    try {
      await api.patch(`/api/projects/${projectId}/constraints/${c.id}`, {
        status: 'REMOVED', removalEvidence: evidence, version: c.version,
      });
      list.reload();
      lookahead.reload();
    } catch (err) {
      setMsg({ tone: 'danger', text: err instanceof Error ? err.message : 'Falha ao atualizar.' });
    }
  };

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const open = (list.data ?? []).filter((c) => c.status === 'OPEN' || c.status === 'IN_PROGRESS');

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Restricoes e prontidao</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setCreating(!creating)}>
          {creating ? 'Cancelar' : 'Nova restricao'}
        </button>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'danger'}>{msg.text}</Notice>}

      {creating && (
        <Card title="Nova restricao">
          <form onSubmit={create}>
            <Field label="Descricao *"><input value={form.description} onChange={set('description')} required minLength={5} /></Field>
            <div className="grid grid--3">
              <Field label="Categoria">
                <select value={form.category} onChange={set('category')}>
                  {CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Responsavel *"><input value={form.owner} onChange={set('owner')} required /></Field>
              <Field label="Origem *" hint="Onde a restricao apareceu."><input value={form.origin} onChange={set('origin')} required minLength={3} /></Field>
              <Field label="Data necessaria *"><input type="date" value={form.neededBy} onChange={set('neededBy')} required /></Field>
              <Field label="Data prometida"><input type="date" value={form.promisedBy} onChange={set('promisedBy')} /></Field>
            </div>
            <Field label="Impacto potencial *"><textarea rows={2} value={form.potentialImpact} onChange={set('potentialImpact')} required minLength={5} /></Field>
            <button className="primary">Registrar</button>
          </form>
        </Card>
      )}

      <AsyncBoundary
        loading={list.loading} error={list.error} empty={!list.data?.length}
        emptyTitle="Nenhuma restricao registrada"
        emptyHint="Registre o que impede o inicio de cada pacote."
      >
        <Card title={`Restricoes (${open.length} aberta(s) de ${list.data?.length ?? 0})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Status</th><th>Categoria</th><th>Descricao</th><th>Responsavel</th>
                    <th>Necessaria</th><th>Prometida</th><th>Impacto</th><th>Evidencia</th><th></th></tr>
              </thead>
              <tbody>
                {list.data?.map((c) => {
                  const late = c.promisedBy && new Date(c.promisedBy) > new Date(c.neededBy);
                  return (
                    <tr key={c.id}>
                      <td>
                        <span className={`badge ${c.status === 'REMOVED' ? 'badge--fact' : c.status === 'ACCEPTED_RISK' ? 'badge--assumption' : 'badge--pending'}`}>
                          {c.status}
                        </span>
                      </td>
                      <td className="small">{CATEGORIES.find(([k]) => k === c.category)?.[1] ?? c.category}</td>
                      <td>{c.description}</td>
                      <td className="small">{c.owner}</td>
                      <td className="nowrap">{fmtDate(c.neededBy)}</td>
                      <td className="nowrap" style={late ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>
                        {fmtDate(c.promisedBy)}{late && ' (apos o necessario)'}
                      </td>
                      <td className="small">{c.potentialImpact}</td>
                      <td className="small">{c.removalEvidence ?? '—'}</td>
                      <td>
                        {c.status !== 'REMOVED' && (
                          <button className="sm" onClick={() => void remove(c)}>Marcar removida</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </AsyncBoundary>

      <Card title="Lookahead de 6 semanas — o que pode virar compromisso">
        <Notice tone="info">
          Uma atividade so vira compromisso quando TODAS as dimensoes de prontidao foram avaliadas e
          nenhuma restricao tem promessa posterior ao inicio. "Nao avaliado" nao equivale a "pronto".
        </Notice>
        <AsyncBoundary
          loading={lookahead.loading} error={lookahead.error} empty={!lookahead.data?.length}
          emptyTitle="Nenhuma atividade na janela"
          emptyHint="Calcule o cronograma para popular o lookahead."
        >
          <table className="data">
            <thead><tr><th>Atividade</th><th>Inicio planejado</th><th>Prontidao</th><th>Compromisso</th><th>Motivo</th></tr></thead>
            <tbody>
              {lookahead.data?.map((l) => (
                <tr key={l.activityId}>
                  <td>{l.name}</td>
                  <td className="nowrap">{fmtDate(l.plannedStart)}</td>
                  <td className="mono">{l.readiness.score}</td>
                  <td>
                    <span className={`badge ${l.canCommit ? 'badge--fact' : 'badge--conflict'}`}>
                      {l.canCommit ? 'PODE COMPROMETER' : 'NAO PODE'}
                    </span>
                  </td>
                  <td className="small">{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncBoundary>
      </Card>
    </>
  );
}
