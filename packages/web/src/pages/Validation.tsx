import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtNum } from '../lib/format';
import type { QuantityItem } from '../lib/types';
import { Confidence, ProvenanceBadge, ReviewBadge } from '../components/Provenance';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';

interface ImpactPreview {
  proposed: { qty: number; delta: number };
  impact: {
    wbsNode: { code: string; name: string } | null;
    activities: { id: string; code: string; name: string; note: string }[];
    controlMapItems: number;
    requiresRecalculation: boolean;
  };
}

const EDITABLE: { key: keyof QuantityItem; label: string; type: 'text' | 'number' }[] = [
  { key: 'qty', label: 'Quantidade', type: 'number' },
  { key: 'unit', label: 'Unidade', type: 'text' },
  { key: 'lineNumber', label: 'Linha', type: 'text' },
  { key: 'nominalDiameterIn', label: 'DN (pol)', type: 'number' },
  { key: 'pipeClass', label: 'Classe', type: 'text' },
  { key: 'schedule', label: 'Schedule', type: 'text' },
  { key: 'area', label: 'Area', type: 'text' },
  { key: 'system', label: 'Sistema', type: 'text' },
];

/** Tela de validacao (§8): evidencia a esquerda, campos editaveis a direita. */
export function Validation(): JSX.Element {
  const { projectId } = useParams();
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [maxConfidence, setMaxConfidence] = useState('');
  const [discipline, setDiscipline] = useState('');

  const query = useMemo(() => {
    const p = new URLSearchParams({ kind: 'quantity', status });
    if (maxConfidence) p.set('maxConfidence', maxConfidence);
    if (discipline) p.set('discipline', discipline);
    return p.toString();
  }, [status, maxConfidence, discipline]);

  const { data, loading, error, reload } = useApi<QuantityItem[]>(
    `/api/projects/${projectId}/validation/queue?${query}`,
  );
  const [selected, setSelected] = useState<QuantityItem | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState('');
  const [preview, setPreview] = useState<ImpactPreview | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const select = (item: QuantityItem): void => {
    setSelected(item);
    setEdits({});
    setJustification('');
    setPreview(null);
    setMsg(null);
  };

  const corrections = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of EDITABLE) {
      const raw = edits[f.key as string];
      if (raw === undefined || raw === '') continue;
      out[f.key as string] = f.type === 'number' ? Number(raw) : raw;
    }
    return out;
  };

  const runPreview = async (): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.post<ImpactPreview>(
        `/api/projects/${projectId}/validation/quantities/${selected.id}/preview-impact`,
        { corrections: corrections() },
      );
      setPreview(r);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (decision: 'APPROVED' | 'CORRECTED' | 'REJECTED' | 'FLAGGED'): Promise<void> => {
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/api/projects/${projectId}/validation/quantities/${selected.id}/decide`, {
        decision,
        version: selected.version,
        justification: justification || undefined,
        corrections: decision === 'CORRECTED' ? corrections() : undefined,
      });
      setMsg({ tone: 'ok', text: 'Decisao registrada com usuario, data e justificativa.' });
      setSelected(null);
      reload();
    } catch (e) {
      const err = e as ApiError;
      setMsg({
        tone: err.isConflict ? 'warn' : 'danger',
        text: err.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const bulkApprove = async (): Promise<void> => {
    const min = prompt('Aprovar em lote todos os itens PENDENTES com confianca acima de (0 a 1):', '0.85');
    if (!min) return;
    const why = prompt('Justifique a regra do lote (obrigatorio, minimo 10 caracteres):');
    if (!why || why.length < 10) { alert('Justificativa obrigatoria.'); return; }
    try {
      const r = await api.post<{ approved: number }>(
        `/api/projects/${projectId}/validation/quantities/bulk-approve`,
        { rule: { minConfidence: Number(min), ...(discipline ? { discipline } : {}) }, justification: why },
      );
      setMsg({ tone: 'ok', text: `${r.approved} item(ns) aprovados com a regra registrada.` });
      reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha no lote.' });
    }
  };

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Validacao</h1>
        <span className="spacer" />
        <button onClick={() => void bulkApprove()}>Aprovar em lote com regra</button>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : msg.tone}>{msg.text}</Notice>}

      <div className="toolbar">
        <Field label="Status">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            <option value="PENDING">Aguardando revisao</option>
            <option value="APPROVED">Aprovados</option>
            <option value="REJECTED">Rejeitados</option>
          </select>
        </Field>
        <Field label="Confianca maxima">
          <input type="number" step="0.05" min="0" max="1" value={maxConfidence}
                 onChange={(e) => setMaxConfidence(e.target.value)} placeholder="ex.: 0.7" />
        </Field>
        <Field label="Disciplina">
          <input value={discipline} onChange={(e) => setDiscipline(e.target.value)} placeholder="PIPING" />
        </Field>
      </div>

      <div className="split">
        <div className="split__pane">
          <header>
            <b>Fila de revisao</b>
            <span className="spacer" />
            <span className="small muted">{data?.length ?? 0} item(ns), pior confianca primeiro</span>
          </header>
          <div className="body" style={{ padding: 0 }}>
            <AsyncBoundary
              loading={loading} error={error} empty={!data?.length}
              emptyTitle="Nada para revisar com estes filtros"
              emptyHint="Ajuste os filtros ou processe novos documentos."
            >
              <table className="data">
                <thead>
                  <tr><th>Entidade</th><th>Qtd</th><th>Origem</th><th>Confianca</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {data?.map((q) => (
                    <tr
                      key={q.id}
                      onClick={() => select(q)}
                      style={{ cursor: 'pointer', background: selected?.id === q.id ? '#eaf1f6' : undefined }}
                    >
                      <td className="mono small">{q.entityKey}</td>
                      <td className="num">{fmtNum(q.qty)} {q.unit}</td>
                      <td><ProvenanceBadge dataClass={q.dataClass} /></td>
                      <td><Confidence value={q.confidence} /></td>
                      <td><ReviewBadge status={q.reviewStatus} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AsyncBoundary>
          </div>
        </div>

        <div className="split__pane">
          <header><b>Evidencia e correcao</b></header>
          <div className="body">
            {!selected ? (
              <div className="empty">
                <strong>Selecione um item</strong>
                A evidencia de origem aparece aqui, ao lado dos campos editaveis.
              </div>
            ) : (
              <>
                <Card title="Origem" flush>
                  <div style={{ padding: 12 }}>
                    <table className="data">
                      <tbody>
                        <tr><th>Documento</th><td>{selected.document?.fileName ?? '—'}</td></tr>
                        <tr><th>Numero</th><td className="mono">{selected.document?.documentNumber ?? '—'}</td></tr>
                        <tr><th>Revisao</th><td>{selected.documentRevision ?? '—'}</td></tr>
                        <tr><th>Pagina</th><td>{selected.evidence?.page ?? '—'}</td></tr>
                        <tr><th>Regiao (bbox)</th><td className="mono small">{selected.evidence?.bbox?.map((n) => n.toFixed(0)).join(', ') ?? '—'}</td></tr>
                        <tr><th>Metodo</th><td className="mono small">{selected.evidence?.method ?? '—'}</td></tr>
                      </tbody>
                    </table>
                    <div style={{ marginTop: 10 }}>
                      <div className="small muted" style={{ marginBottom: 4 }}>Trecho que sustenta o valor:</div>
                      <div className="evidence">{selected.evidence?.snippet ?? '(sem trecho registrado)'}</div>
                    </div>
                  </div>
                </Card>

                <Card title="Campos">
                  <div className="grid grid--2">
                    {EDITABLE.map((f) => (
                      <Field key={String(f.key)} label={f.label}>
                        <input
                          type={f.type}
                          placeholder={String(selected[f.key] ?? '')}
                          value={edits[f.key as string] ?? ''}
                          onChange={(e) => setEdits({ ...edits, [f.key as string]: e.target.value })}
                        />
                      </Field>
                    ))}
                  </div>
                  <Field label="Justificativa" hint="Obrigatoria para corrigir, rejeitar ou marcar pendencia.">
                    <textarea rows={2} value={justification} onChange={(e) => setJustification(e.target.value)} />
                  </Field>

                  <div className="row">
                    <button onClick={() => void runPreview()} disabled={busy || Object.keys(corrections()).length === 0}>
                      Ver impacto antes de aplicar
                    </button>
                  </div>

                  {preview && (
                    <Notice
                      tone={preview.impact.requiresRecalculation ? 'warn' : 'info'}
                      title={`Impacto: delta de ${fmtNum(preview.proposed.delta)} ${selected.unit}`}
                    >
                      {preview.impact.wbsNode && <>Pacote {preview.impact.wbsNode.code}. </>}
                      {preview.impact.activities.length} atividade(s) e {preview.impact.controlMapItems} item(ns) de mapa
                      de controle serao afetados.
                      {preview.impact.requiresRecalculation && ' HH e duracao precisarao ser recalculados e reaprovados.'}
                    </Notice>
                  )}

                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="ok" disabled={busy} onClick={() => void decide('APPROVED')}>Aprovar</button>
                    <button className="primary" disabled={busy || Object.keys(corrections()).length === 0}
                            onClick={() => void decide('CORRECTED')}>
                      Corrigir e aprovar
                    </button>
                    <button className="danger" disabled={busy} onClick={() => void decide('REJECTED')}>Rejeitar</button>
                    <button disabled={busy} onClick={() => void decide('FLAGGED')}>Marcar pendencia</button>
                  </div>
                </Card>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
