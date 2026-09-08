import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import type { Activity, LogicLink } from '../lib/types';
import { PrecedenceGraph } from '../components/PrecedenceGraph';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';
import { Confidence } from '../components/Provenance';

const STATUS_BADGE: Record<string, string> = {
  SUGGESTED: 'badge--ai', VALIDATED: 'badge--fact', MODIFIED: 'badge--user', REJECTED: 'badge--conflict',
};

export function Sequencing(): JSX.Element {
  const { projectId } = useParams();
  const links = useApi<LogicLink[]>(`/api/projects/${projectId}/links`);
  const activities = useApi<Activity[]>(`/api/projects/${projectId}/activities`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'SUGGESTED' | 'VALIDATED'>('ALL');
  const [why, setWhy] = useState<{ activity: Activity; rows: WhyRow[] } | null>(null);

  const propose = async (): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ proposedLinks: number; questions: unknown[]; ruleStats: { ruleId: string; linksGenerated: number }[]; note: string }>(
        `/api/projects/${projectId}/sequencing/propose`,
      );
      setMsg({
        tone: r.questions.length > 0 ? 'warn' : 'ok',
        text: `${r.proposedLinks} vinculo(s) sugeridos. ${r.questions.length} pergunta(s) abertas registradas como pendencia. ${r.note}`,
      });
      links.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao propor sequencia.' });
    } finally {
      setBusy(false);
    }
  };

  const decide = async (link: LogicLink, decision: 'VALIDATED' | 'REJECTED'): Promise<void> => {
    let justification: string | undefined;
    if (decision === 'REJECTED') {
      justification = prompt('Por que este vinculo nao se sustenta? (obrigatorio)') ?? undefined;
      if (!justification) return;
    }
    try {
      await api.post(`/api/projects/${projectId}/links/${link.id}/decide`, {
        decision, version: link.version, justification,
      });
      links.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao decidir.' });
    }
  };

  const openWhy = async (activity: Activity): Promise<void> => {
    const rows = await api.get<WhyRow[]>(`/api/projects/${projectId}/activities/${activity.id}/why`);
    setWhy({ activity, rows });
  };

  const shown = (links.data ?? []).filter((l) => filter === 'ALL' || l.status === filter);
  const suggested = (links.data ?? []).filter((l) => l.status === 'SUGGESTED').length;

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Sequenciamento</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => void propose()} disabled={busy}>
          {busy ? 'Analisando…' : 'Propor sequencia construtiva'}
        </button>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : msg.tone}>{msg.text}</Notice>}

      {suggested > 0 && (
        <Notice tone="warn" title={`${suggested} vinculo(s) sugeridos aguardando validacao`}>
          Vinculo sugerido NAO entra no calculo aprovado. Ele aparece tracejado no grafo e so passa a
          valer depois que um planejador o valida.
        </Notice>
      )}

      <Card title="Grafo de precedencias" flush>
        <AsyncBoundary loading={activities.loading || links.loading} error={activities.error ?? links.error}>
          <PrecedenceGraph
            activities={activities.data ?? []}
            links={links.data ?? []}
          />
        </AsyncBoundary>
      </Card>

      <div className="toolbar">
        <Field label="Filtrar vinculos">
          <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="ALL">Todos</option>
            <option value="SUGGESTED">Somente sugeridos</option>
            <option value="VALIDATED">Somente validados</option>
          </select>
        </Field>
        <Field label='"Por que esta atividade vem antes?"'>
          <select
            defaultValue=""
            onChange={(e) => {
              const a = activities.data?.find((x) => x.id === e.target.value);
              if (a) void openWhy(a);
            }}
          >
            <option value="">Escolha uma atividade…</option>
            {activities.data?.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
          </select>
        </Field>
      </div>

      {why && (
        <Card
          title={`Por que "${why.activity.code} — ${why.activity.name}" vem depois?`}
          actions={<button className="sm" onClick={() => setWhy(null)}>Fechar</button>}
        >
          {why.rows.length === 0 ? (
            <p className="muted">Nenhuma predecessora registrada. Esta atividade nao tem gatilho logico.</p>
          ) : (
            <table className="data">
              <thead><tr><th>Predecessora</th><th>Tipo</th><th>Status</th><th>Motivo</th><th>Regra</th><th>Fontes</th><th>Confianca</th></tr></thead>
              <tbody>
                {why.rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.predecessor?.code} — {r.predecessor?.name}</td>
                    <td className="mono">{r.type}{r.lagMinutes ? ` +${(r.lagMinutes / 480).toFixed(1)}d` : ''}</td>
                    <td><span className={`badge ${STATUS_BADGE[r.status] ?? 'badge--rule'}`}>{r.status}</span></td>
                    <td className="small">{r.reason}</td>
                    <td className="mono small">{r.ruleId ?? '—'}</td>
                    <td className="mono small">{r.sourceRefs.join(', ') || '—'}</td>
                    <td><Confidence value={r.confidence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      <AsyncBoundary
        loading={links.loading} error={links.error} empty={shown.length === 0}
        emptyTitle="Nenhum vinculo"
        emptyHint="Rode a proposta de sequencia ou crie vinculos manualmente."
      >
        <Card title={`Vinculos (${shown.length})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Predecessora</th><th>Sucessora</th><th>Tipo</th><th>Lag</th><th>Status</th>
                    <th>Motivo</th><th>Natureza</th><th>Regra</th><th>Confianca</th><th></th></tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td className="small">{l.predecessor.code}</td>
                    <td className="small">{l.successor.code}</td>
                    <td className="mono">{l.type}</td>
                    <td className="num">{l.lagMinutes ? `${(l.lagMinutes / 480).toFixed(1)}d` : '—'}</td>
                    <td><span className={`badge ${STATUS_BADGE[l.status] ?? 'badge--rule'}`}>{l.status}</span></td>
                    <td className="small" style={{ maxWidth: 380 }}>{l.reason}</td>
                    <td className="small">{l.reasonKind}</td>
                    <td className="mono small">{l.ruleId ?? '—'}</td>
                    <td><Confidence value={l.confidence} /></td>
                    <td className="nowrap">
                      {l.status === 'SUGGESTED' && (
                        <>
                          <button className="sm ok" onClick={() => void decide(l, 'VALIDATED')}>Validar</button>{' '}
                          <button className="sm danger" onClick={() => void decide(l, 'REJECTED')}>Rejeitar</button>
                        </>
                      )}
                    </td>
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

interface WhyRow {
  predecessor?: { id: string; code: string; name: string };
  type: string; lagMinutes: number; status: string; reason: string;
  reasonKind: string; ruleId?: string; sourceRefs: string[]; confidence: number;
}
