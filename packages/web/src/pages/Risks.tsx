import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import type { OpenIssue } from '../lib/types';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';

export function Risks(): JSX.Element {
  const { projectId } = useParams();
  const [status, setStatus] = useState<'OPEN' | 'RESOLVED'>('OPEN');
  const issues = useApi<OpenIssue[]>(`/api/projects/${projectId}/issues?status=${status}`);
  const dc = useApi<{ summary: { confirmed: number; suspected: number } }>(`/api/projects/${projectId}/quantities/double-count`);
  const promotion = useApi<{ canPromote: boolean; blocked: { id: string; stage: string; label: string; reason: string }[]; note: string }>(
    `/api/projects/${projectId}/schedule/promotion-check`,
  );
  const [msg, setMsg] = useState<string | null>(null);

  const resolve = async (issue: OpenIssue): Promise<void> => {
    const resolution = prompt(`Como esta pendencia foi resolvida?\n\n${issue.description}`);
    if (!resolution || resolution.length < 5) return;
    await api.post(`/api/projects/${projectId}/issues/${issue.id}/resolve`, { resolution });
    setMsg('Pendencia resolvida com justificativa registrada.');
    issues.reload();
  };

  const bySeverity = (s: string): number => (issues.data ?? []).filter((i) => i.severity === s).length;

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Riscos e inconsistencias</h1>
      </div>

      {msg && <Notice tone="ok">{msg}</Notice>}

      {promotion.data && (
        <Notice
          tone={promotion.data.canPromote ? 'ok' : 'warn'}
          title={promotion.data.canPromote ? 'Cadeia de rastreabilidade completa' : `${promotion.data.blocked.length} item(ns) impedem a aprovacao do plano`}
        >
          {promotion.data.note}
        </Notice>
      )}

      <div className="grid grid--4">
        <div className="kpi"><div className="kpi__label">Pendencias altas</div><div className="kpi__value">{bySeverity('HIGH')}</div></div>
        <div className="kpi"><div className="kpi__label">Pendencias medias</div><div className="kpi__value">{bySeverity('MEDIUM')}</div></div>
        <div className="kpi"><div className="kpi__label">Dupla contagem confirmada</div><div className="kpi__value">{dc.data?.summary.confirmed ?? '—'}</div></div>
        <div className="kpi"><div className="kpi__label">Dupla contagem suspeita</div><div className="kpi__value">{dc.data?.summary.suspected ?? '—'}</div></div>
      </div>

      {promotion.data && promotion.data.blocked.length > 0 && (
        <Card title={`Bloqueios de promocao ao plano aprovado (${promotion.data.blocked.length})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Etapa</th><th>Item</th><th>Motivo do bloqueio</th></tr></thead>
              <tbody>
                {promotion.data.blocked.slice(0, 100).map((b) => (
                  <tr key={b.id}>
                    <td><span className="badge badge--rule">{b.stage}</span></td>
                    <td className="small">{b.label}</td>
                    <td className="small">{b.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="toolbar">
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="OPEN">Abertas</option>
            <option value="RESOLVED">Resolvidas</option>
          </select>
        </Field>
      </div>

      <AsyncBoundary
        loading={issues.loading} error={issues.error} empty={!issues.data?.length}
        emptyTitle="Nenhuma pendencia com este filtro"
        emptyHint="Pendencias aparecem quando falta informacao, o formato nao e legivel ou fontes divergem."
      >
        <Card title={`Pendencias (${issues.data?.length ?? 0})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Severidade</th><th>Escopo</th><th>Descricao</th><th>Registrada</th><th></th></tr></thead>
              <tbody>
                {issues.data?.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <span className={`badge ${i.severity === 'HIGH' ? 'badge--conflict' : i.severity === 'MEDIUM' ? 'badge--pending' : 'badge--rule'}`}>
                        {i.severity}
                      </span>
                    </td>
                    <td className="mono small">{i.scope}</td>
                    <td className="small">{i.description}</td>
                    <td className="small nowrap">{fmtDateTime(i.createdAt)}</td>
                    <td>{status === 'OPEN' && <button className="sm" onClick={() => void resolve(i)}>Resolver</button>}</td>
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
