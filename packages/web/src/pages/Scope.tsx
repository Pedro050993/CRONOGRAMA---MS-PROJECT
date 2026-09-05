import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { fmtNum, fmtPct } from '../lib/format';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';
import { Confidence } from '../components/Provenance';

interface RollupResponse {
  rows: {
    key: Record<string, string>; qty: number; unit: string; itemCount: number;
    sourceKinds: string[]; documentIds: string[]; minConfidence: number | null; pendingReviewCount: number;
  }[];
  excluded: { itemId: string; entityKey: string; unit: string; reason: string }[];
  totals: { qty: number; unit: string; itemCount: number };
}

interface DoubleCount {
  findings: {
    entityKey: string; severity: 'CONFIRMED' | 'SUSPECTED'; message: string;
    items: { id: string; sourceKind: string; documentId: string; qty: number; unit: string }[];
    resolvedBy?: string;
  }[];
  summary: { confirmed: number; suspected: number };
  note: string;
}

interface Reconciliation {
  linesAnalyzed: number;
  divergences: { lineNumber: string; field: string; message: string }[];
  omissions: { lineNumber: string; message: string }[];
  note: string;
}

const DIMENSIONS = [
  'discipline', 'area', 'system', 'subsystem', 'lineNumber', 'tag', 'documentId',
  'material', 'pipeClass', 'schedule', 'nominalDiameterIn', 'itemType', 'controlUnit', 'sourceKind',
];

const UNITS = ['m', 'kg', 'un', 'jt', 'in-dia', 'hh', 'm2', 'm3'];

export function Scope(): JSX.Element {
  const { projectId } = useParams();
  const [groupBy, setGroupBy] = useState('discipline,area');
  const [unit, setUnit] = useState('jt');
  const [onlyApproved, setOnlyApproved] = useState(false);

  const rollup = useApi<RollupResponse>(
    `/api/projects/${projectId}/quantities/rollup?groupBy=${encodeURIComponent(groupBy)}&unit=${unit}&onlyApproved=${onlyApproved}`,
  );
  const dc = useApi<DoubleCount>(`/api/projects/${projectId}/quantities/double-count`);
  const rec = useApi<Reconciliation>(`/api/projects/${projectId}/reconciliation`);
  const weld = useApi<{ total: number; unit: string; memo: { formula: string; inputs: Record<string, unknown> }; skipped: unknown[] }>(
    `/api/projects/${projectId}/quantities/weld-inch`,
  );

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Escopo e quantitativos</h1>
      </div>

      {dc.data && dc.data.summary.confirmed > 0 && (
        <Notice tone="danger" title={`${dc.data.summary.confirmed} caso(s) confirmado(s) de dupla contagem`}>
          {dc.data.note}
        </Notice>
      )}

      <div className="toolbar">
        <Field label="Agrupar por" hint="Separe por virgula.">
          <input value={groupBy} onChange={(e) => setGroupBy(e.target.value)} list="dims" />
          <datalist id="dims">{DIMENSIONS.map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Unidade do total">
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </Field>
        <Field label="Somente aprovados">
          <select value={onlyApproved ? '1' : '0'} onChange={(e) => setOnlyApproved(e.target.value === '1')}>
            <option value="0">Incluir pendentes (marcados)</option>
            <option value="1">Somente validados por humano</option>
          </select>
        </Field>
      </div>

      <AsyncBoundary
        loading={rollup.loading} error={rollup.error} empty={!rollup.data?.rows.length}
        emptyTitle="Nenhum quantitativo nesta unidade"
        emptyHint="Itens de outra grandeza sao listados abaixo como excluidos, nunca convertidos por conveniencia."
      >
        <Card
          title={`Quadro quantitativo — total ${fmtNum(rollup.data?.totals.qty)} ${rollup.data?.totals.unit}`}
          flush
        >
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  {groupBy.split(',').map((d) => <th key={d}>{d.trim()}</th>)}
                  <th className="right">Quantidade</th>
                  <th>Unidade</th>
                  <th className="right">Itens</th>
                  <th>Fontes</th>
                  <th>Menor confianca</th>
                  <th className="right">Nao validados</th>
                </tr>
              </thead>
              <tbody>
                {rollup.data?.rows.map((r, i) => (
                  <tr key={i}>
                    {groupBy.split(',').map((d) => <td key={d}>{r.key[d.trim()]}</td>)}
                    <td className="num">{fmtNum(r.qty)}</td>
                    <td>{r.unit}</td>
                    <td className="num">{r.itemCount}</td>
                    <td className="small">{r.sourceKinds.join(', ')}</td>
                    <td><Confidence value={r.minConfidence} /></td>
                    <td className="num">
                      {r.pendingReviewCount > 0
                        ? <span className="badge badge--pending">{r.pendingReviewCount}</span>
                        : <span className="muted">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </AsyncBoundary>

      {rollup.data && rollup.data.excluded.length > 0 && (
        <Card title={`Itens excluidos do total (${rollup.data.excluded.length})`}>
          <p className="small muted" style={{ marginTop: 0 }}>
            Estes itens NAO foram convertidos para caber no total. Somar grandezas diferentes falsifica quantitativo.
          </p>
          <table className="data">
            <thead><tr><th>Entidade</th><th>Unidade</th><th>Motivo</th></tr></thead>
            <tbody>
              {rollup.data.excluded.slice(0, 50).map((e) => (
                <tr key={e.itemId}><td className="mono small">{e.entityKey}</td><td>{e.unit}</td><td className="small">{e.reason}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {weld.data && (
        <Card title="Polegada-diametro de soldagem">
          <div className="row">
            <div className="kpi" style={{ minWidth: 200 }}>
              <div className="kpi__label">Total</div>
              <div className="kpi__value">{fmtNum(weld.data.total)} <span className="small">in-dia</span></div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="small"><b>Memoria de calculo:</b> <span className="mono">{weld.data.memo.formula}</span></div>
              <div className="small muted">{JSON.stringify(weld.data.memo.inputs)}</div>
              {weld.data.skipped.length > 0 && (
                <div className="small" style={{ color: 'var(--warn)' }}>
                  {weld.data.skipped.length} junta(s) sem DN identificado ficaram FORA do total.
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      <Card title="Verificacao de dupla contagem">
        <AsyncBoundary
          loading={dc.loading} error={dc.error} empty={!dc.data?.findings.length}
          emptyTitle="Nenhuma dupla contagem detectada"
          emptyHint="Nenhuma entidade fisica aparece em mais de uma fonte."
        >
          <table className="data">
            <thead><tr><th>Severidade</th><th>Entidade</th><th>Diagnostico</th><th>Ocorrencias</th></tr></thead>
            <tbody>
              {dc.data?.findings.slice(0, 60).map((f) => (
                <tr key={f.entityKey}>
                  <td>
                    <span className={`badge ${f.severity === 'CONFIRMED' ? 'badge--conflict' : 'badge--pending'}`}>
                      {f.severity === 'CONFIRMED' ? 'CONFIRMADA' : 'SUSPEITA'}
                    </span>
                  </td>
                  <td className="mono small">{f.entityKey}</td>
                  <td className="small">{f.message}</td>
                  <td className="small">
                    {f.items.map((i) => <div key={i.id}>{i.sourceKind}: {fmtNum(i.qty)} {i.unit}</div>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AsyncBoundary>
      </Card>

      <Card title="Reconciliacao entre fontes">
        <AsyncBoundary loading={rec.loading} error={rec.error}>
          {rec.data && (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>
                {rec.data.linesAnalyzed} linha(s) analisadas. {rec.data.note}
              </p>
              {rec.data.divergences.length === 0 && rec.data.omissions.length === 0 ? (
                <p className="muted">Nenhuma divergencia ou omissao detectada entre as fontes disponiveis.</p>
              ) : (
                <table className="data">
                  <thead><tr><th>Tipo</th><th>Linha</th><th>Diagnostico</th></tr></thead>
                  <tbody>
                    {rec.data.divergences.map((d, i) => (
                      <tr key={`d${i}`}>
                        <td><span className="badge badge--conflict">DIVERGENCIA</span></td>
                        <td className="mono">{d.lineNumber}</td><td className="small">{d.message}</td>
                      </tr>
                    ))}
                    {rec.data.omissions.map((o, i) => (
                      <tr key={`o${i}`}>
                        <td><span className="badge badge--pending">OMISSAO</span></td>
                        <td className="mono">{o.lineNumber}</td><td className="small">{o.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}
        </AsyncBoundary>
      </Card>
    </>
  );
}
