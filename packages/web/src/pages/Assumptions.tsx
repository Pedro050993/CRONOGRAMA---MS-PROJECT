import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';
import { Productivity } from '../components/Productivity';

interface Assumption {
  id: string; statement: string; rationale: string | null; source: string | null;
  approvedBy: string | null; approvedAt: string | null; active: boolean; createdAt: string;
}
interface Decision {
  id: string; stage: string; targetId: string; decision: string; by: string;
  justification: string; createdAt: string;
}

export function Assumptions(): JSX.Element {
  const { projectId } = useParams();
  const assumptions = useApi<Assumption[]>(`/api/projects/${projectId}/assumptions`);
  const decisions = useApi<Decision[]>(`/api/projects/${projectId}/decisions`);
  const [form, setForm] = useState({ statement: '', rationale: '', source: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const create = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    await api.post(`/api/projects/${projectId}/assumptions`, {
      statement: form.statement,
      rationale: form.rationale || undefined,
      source: form.source || undefined,
    });
    setForm({ statement: '', rationale: '', source: '' });
    setMsg('Premissa registrada. Ela permanece visivel enquanto estiver ativa.');
    assumptions.reload();
  };

  const approve = async (a: Assumption): Promise<void> => {
    await api.post(`/api/projects/${projectId}/assumptions/${a.id}/approve`);
    assumptions.reload();
  };

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Premissas e decisoes</h1>
      </div>

      {msg && <Notice tone="ok">{msg}</Notice>}

      <Productivity projectId={projectId!} />

      <Notice tone="info" title="Premissa nao e fato">
        Uma premissa e uma condicao adotada para permitir a analise. Ela nunca vira dado do projeto
        sozinha e aparece explicitamente em todo calculo que dela depende.
      </Notice>

      <Card title="Registrar premissa">
        <form onSubmit={create}>
          <Field label="Premissa *"><input value={form.statement} onChange={(e) => setForm({ ...form, statement: e.target.value })} required minLength={5} /></Field>
          <div className="grid grid--2">
            <Field label="Justificativa"><input value={form.rationale} onChange={(e) => setForm({ ...form, rationale: e.target.value })} /></Field>
            <Field label="Fonte" hint="Historico, orcamento, norma, decisao de reuniao."><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></Field>
          </div>
          <button className="primary">Registrar</button>
        </form>
      </Card>

      <AsyncBoundary
        loading={assumptions.loading} error={assumptions.error} empty={!assumptions.data?.length}
        emptyTitle="Nenhuma premissa registrada"
        emptyHint="Toda condicao adotada sem documento deve estar aqui."
      >
        <Card title={`Premissas (${assumptions.data?.length ?? 0})`} flush>
          <table className="data">
            <thead><tr><th>Premissa</th><th>Justificativa</th><th>Fonte</th><th>Aprovacao</th><th></th></tr></thead>
            <tbody>
              {assumptions.data?.map((a) => (
                <tr key={a.id}>
                  <td>{a.statement}</td>
                  <td className="small">{a.rationale ?? '—'}</td>
                  <td className="small">{a.source ?? <em className="muted">sem fonte</em>}</td>
                  <td className="small">
                    {a.approvedAt
                      ? <span className="badge badge--fact">APROVADA</span>
                      : <span className="badge badge--pending">NAO APROVADA</span>}
                  </td>
                  <td>{!a.approvedAt && <button className="sm" onClick={() => void approve(a)}>Aprovar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AsyncBoundary>

      <AsyncBoundary
        loading={decisions.loading} error={decisions.error} empty={!decisions.data?.length}
        emptyTitle="Nenhuma decisao registrada"
        emptyHint="Aprovacoes, correcoes e rejeicoes aparecem aqui com o responsavel."
      >
        <Card title={`Decisoes registradas (${decisions.data?.length ?? 0})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Data</th><th>Etapa</th><th>Decisao</th><th>Alvo</th><th>Justificativa</th></tr></thead>
              <tbody>
                {decisions.data?.map((d) => (
                  <tr key={d.id}>
                    <td className="small nowrap">{fmtDateTime(d.createdAt)}</td>
                    <td><span className="badge badge--rule">{d.stage}</span></td>
                    <td>
                      <span className={`badge ${d.decision === 'APPROVED' ? 'badge--fact' : d.decision === 'REJECTED' ? 'badge--conflict' : 'badge--user'}`}>
                        {d.decision}
                      </span>
                    </td>
                    <td className="mono small">{d.targetId}</td>
                    <td className="small">{d.justification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </AsyncBoundary>
    </>
  );
}
