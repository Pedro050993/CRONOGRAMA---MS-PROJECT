import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi, useProjectEvents } from '../lib/hooks';
import { fmtDateTime } from '../lib/format';
import { AsyncBoundary, Card, Notice } from '../components/Ui';

interface Job {
  id: string; kind: string; status: string; progress: number; progressNote: string | null;
  attempts: number; maxAttempts: number; lastError: string | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
  payload: Record<string, unknown>;
}

const STATUS: Record<string, { text: string; cls: string }> = {
  QUEUED: { text: 'NA FILA', cls: 'badge--rule' },
  RUNNING: { text: 'PROCESSANDO', cls: 'badge--user' },
  DONE: { text: 'CONCLUIDO', cls: 'badge--fact' },
  FAILED: { text: 'FALHOU', cls: 'badge--conflict' },
  CANCELLED: { text: 'CANCELADO', cls: 'badge--pending' },
};

export function Processing(): JSX.Element {
  const { projectId } = useParams();
  const { data, loading, error, reload } = useApi<Job[]>(`/api/projects/${projectId}/jobs`);
  const { data: caps } = useApi<Record<string, { available: boolean; provider: string; note: string }>>('/api/capabilities');
  const [busy, setBusy] = useState<string | null>(null);

  useProjectEvents(projectId, (e) => {
    if (e.kind.startsWith('document.')) reload();
  });

  const retry = async (id: string): Promise<void> => {
    setBusy(id);
    try {
      await api.post(`/api/projects/${projectId}/jobs/${id}/retry`);
      reload();
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Processamento</h1>
        <span className="spacer" />
        <button onClick={reload}>Atualizar</button>
      </div>

      {caps && (
        <Card title="Capacidades reais deste ambiente">
          <p className="small muted" style={{ marginTop: 0 }}>
            A interface nao promete o que o servidor nao tem. Este quadro vem do proprio ambiente.
          </p>
          <table className="data">
            <thead><tr><th>Capacidade</th><th>Provedor</th><th>Disponivel</th><th>Observacao</th></tr></thead>
            <tbody>
              {Object.entries(caps).map(([k, v]) => (
                <tr key={k}>
                  <td><b>{k.toUpperCase()}</b></td>
                  <td className="mono">{v.provider}</td>
                  <td>
                    <span className={`sem sem--${v.available ? 'GREEN' : 'GREY'}`}>
                      {v.available ? 'SIM' : 'NAO'}
                    </span>
                  </td>
                  <td className="small">{v.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <AsyncBoundary
        loading={loading} error={error} empty={!data?.length}
        emptyTitle="Nenhum processamento na fila"
        emptyHint="Envie documentos para que o worker os processe."
      >
        <Card title={`Fila de processamento (${data?.length ?? 0})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Tipo</th><th>Status</th><th>Progresso</th><th>Tentativas</th>
                  <th>Criado</th><th>Concluido</th><th>Erro</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data?.map((j) => {
                  const s = STATUS[j.status] ?? { text: j.status, cls: 'badge--rule' };
                  return (
                    <tr key={j.id}>
                      <td className="mono small">{j.kind}</td>
                      <td><span className={`badge ${s.cls}`}>{s.text}</span></td>
                      <td style={{ minWidth: 140 }}>
                        <div style={{ background: '#e8ebee', height: 8, borderRadius: 2 }}>
                          <div style={{
                            width: `${j.progress}%`, height: 8, borderRadius: 2,
                            background: j.status === 'FAILED' ? '#c0392b' : '#2b6d99',
                          }} />
                        </div>
                        <span className="small muted">{j.progress}% {j.progressNote ?? ''}</span>
                      </td>
                      <td className="num">{j.attempts}/{j.maxAttempts}</td>
                      <td className="small nowrap">{fmtDateTime(j.createdAt)}</td>
                      <td className="small nowrap">{fmtDateTime(j.finishedAt)}</td>
                      <td className="small" style={{ maxWidth: 320 }}>{j.lastError ?? '—'}</td>
                      <td>
                        {(j.status === 'FAILED' || j.status === 'DONE') && (
                          <button className="sm" disabled={busy === j.id} onClick={() => void retry(j.id)}>
                            Reprocessar
                          </button>
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
    </>
  );
}
