import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import type { Project } from '../lib/types';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';

interface AuditRow {
  id: string; action: string; entity: string; entityId: string | null;
  before: unknown; after: unknown; justification: string | null; createdAt: string;
  user: { id: string; name: string; email: string } | null;
}

export function Audit(): JSX.Element {
  const { projectId } = useParams();
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const audit = useApi<{ total: number; rows: AuditRow[] }>(
    `/api/projects/${projectId}/audit?take=300${entity ? `&entity=${entity}` : ''}${action ? `&action=${action}` : ''}`,
  );
  const project = useApi<Project & { members: { id: string; role: string; user: { id: string; name: string; email: string } }[] }>(
    `/api/projects/${projectId}`,
  );
  const users = useApi<{ id: string; name: string; email: string }[]>('/api/users');
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const setRole = async (userId: string, role: string): Promise<void> => {
    try {
      await api.post(`/api/projects/${projectId}/members`, { userId, role });
      setMsg({ tone: 'ok', text: 'Papel atualizado.' });
      project.reload();
      audit.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao atualizar papel.' });
    }
  };

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Administracao e auditoria</h1>
        <span className="spacer" />
        <button onClick={() => void api.download(`/api/projects/${projectId}/exports/audit.csv`, `auditoria-${projectId}.csv`)}>
          Exportar auditoria (CSV)
        </button>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'danger'}>{msg.text}</Notice>}

      <Card title="Acesso ao projeto">
        <p className="small muted" style={{ marginTop: 0 }}>
          ADMIN administra e altera realizado · PLANNER edita o cronograma · REVIEWER aprova extracoes ·
          VIEWER apenas le. Quem nao e membro nao ve o projeto.
        </p>
        <AsyncBoundary loading={project.loading} error={project.error}>
          <table className="data">
            <thead><tr><th>Usuario</th><th>E-mail</th><th>Papel</th></tr></thead>
            <tbody>
              {project.data?.members?.map((m) => (
                <tr key={m.id}>
                  <td>{m.user.name}</td>
                  <td className="small">{m.user.email}</td>
                  <td>
                    <select value={m.role} onChange={(e) => void setRole(m.user.id, e.target.value)}>
                      {['ADMIN', 'PLANNER', 'REVIEWER', 'VIEWER'].map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncBoundary>

        {users.data && project.data?.members && (
          <div className="row" style={{ marginTop: 10 }}>
            <Field label="Adicionar membro">
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) void setRole(e.target.value, 'VIEWER'); }}
              >
                <option value="">Escolha um usuario da organizacao…</option>
                {users.data
                  .filter((u) => !project.data!.members.some((m) => m.user.id === u.id))
                  .map((u) => <option key={u.id} value={u.id}>{u.name} — {u.email}</option>)}
              </select>
            </Field>
          </div>
        )}
      </Card>

      <div className="toolbar">
        <Field label="Entidade">
          <input value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Activity, QuantityItem, Project…" />
        </Field>
        <Field label="Acao">
          <input value={action} onChange={(e) => setAction(e.target.value)} placeholder="ACTUAL_CHANGED, QUANTITY_APPROVED…" />
        </Field>
      </div>

      <AsyncBoundary
        loading={audit.loading} error={audit.error} empty={!audit.data?.rows.length}
        emptyTitle="Nenhum registro com estes filtros"
      >
        <Card title={`Trilha de auditoria (${audit.data?.rows.length ?? 0} de ${audit.data?.total ?? 0})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Data</th><th>Usuario</th><th>Acao</th><th>Entidade</th><th>Justificativa</th><th></th></tr></thead>
              <tbody>
                {audit.data?.rows.map((r) => (
                  <>
                    <tr key={r.id}>
                      <td className="small nowrap">{fmtDateTime(r.createdAt)}</td>
                      <td className="small">{r.user?.name ?? <em className="muted">sistema</em>}</td>
                      <td className="mono small">{r.action}</td>
                      <td className="small">{r.entity}</td>
                      <td className="small">{r.justification ?? '—'}</td>
                      <td>
                        {Boolean(r.before ?? r.after) && (
                          <button className="sm" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                            {expanded === r.id ? 'Ocultar' : 'Antes/depois'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr key={`${r.id}-detail`}>
                        <td colSpan={6}>
                          <div className="grid grid--2">
                            <div>
                              <div className="small muted">Valor anterior</div>
                              <div className="evidence" style={{ maxHeight: 220, overflow: 'auto' }}>
                                {r.before ? JSON.stringify(r.before, null, 2) : '(sem valor anterior)'}
                              </div>
                            </div>
                            <div>
                              <div className="small muted">Valor novo</div>
                              <div className="evidence" style={{ maxHeight: 220, overflow: 'auto' }}>
                                {r.after ? JSON.stringify(r.after, null, 2) : '(sem valor novo)'}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </AsyncBoundary>
    </>
  );
}
