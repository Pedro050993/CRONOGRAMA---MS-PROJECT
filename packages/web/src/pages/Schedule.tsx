import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { daysFromMinutes, fmtDate, fmtNum, fmtPct, STEP_LABELS } from '../lib/format';
import type { Activity, LogicLink } from '../lib/types';
import { Gantt } from '../components/Gantt';
import { AsyncBoundary, Card, Kpi, Notice } from '../components/Ui';

interface ComputeResult {
  projectStart: string;
  projectFinish: string;
  criticalPath: string[];
  quality: {
    findings: { code: string; severity: 'ERROR' | 'WARNING' | 'INFO'; message: string; activityIds: string[] }[];
    summary: { errors: number; warnings: number; infos: number; blocking: boolean };
  };
  notCalculable: { id: string; code: string; name: string; missing: { field: string; reason: string }[] }[];
}

interface Progress {
  error?: string;
  message?: string;
  totals?: {
    baselineHH: number; plannedHH: number; actualHH: number; remainingHH: number;
    physicalProgress: number; baselineProgressAtStatus: number;
  };
  schedulePerformanceIndex?: number | null;
  curve?: { date: string; baselinePct: number; plannedPct: number; actualPct: number | null }[];
  trendingLate?: { activityId: string; name: string; forecastFinish: string; plannedFinish: string; delayDays: number }[];
  note?: string;
}

export function Schedule(): JSX.Element {
  const { projectId } = useParams();
  const activities = useApi<Activity[]>(`/api/projects/${projectId}/activities`);
  const links = useApi<LogicLink[]>(`/api/projects/${projectId}/links`);
  const progress = useApi<Progress>(`/api/projects/${projectId}/progress`);
  const [result, setResult] = useState<ComputeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);
  const [selected, setSelected] = useState<Activity | null>(null);

  const run = async (path: string, label: string): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<Record<string, unknown>>(`/api/projects/${projectId}${path}`, {});
      if (path === '/schedule/compute') setResult(r as unknown as ComputeResult);
      const nc = (r['notCalculable'] as unknown[] | number) ?? 0;
      const count = Array.isArray(nc) ? nc.length : nc;
      setMsg({
        tone: count > 0 ? 'warn' : 'ok',
        text: count > 0
          ? `${label} concluido. ${count} atividade(s) com duracao NAO CALCULAVEL — o sistema nao arbitra prazo.`
          : `${label} concluido.`,
      });
      activities.reload();
      progress.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : `Falha em ${label}.` });
    } finally {
      setBusy(false);
    }
  };

  const createBaseline = async (): Promise<void> => {
    const name = prompt('Nome da linha de base:', `BL — ${new Date().toLocaleDateString('pt-BR')}`);
    if (!name) return;
    try {
      await api.post(`/api/projects/${projectId}/baselines`, { name });
      setMsg({ tone: 'ok', text: 'Linha de base congelada. Ela nao sera alterada.' });
      progress.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao congelar.' });
    }
  };

  const notCalculable = (activities.data ?? []).filter((a) => a.durationStatus === 'NOT_CALCULABLE' && !a.isMilestone);

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Cronograma e Gantt</h1>
        <span className="spacer" />
        <button onClick={() => void run('/schedule/compute-durations', 'Calculo de duracoes')} disabled={busy}>
          1. Calcular duracoes
        </button>
        <button className="primary" onClick={() => void run('/schedule/compute', 'Calculo do cronograma')} disabled={busy}>
          2. Calcular cronograma (CPM)
        </button>
        <button onClick={() => void createBaseline()} disabled={busy}>3. Congelar linha de base</button>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : msg.tone}>{msg.text}</Notice>}

      {notCalculable.length > 0 && (
        <Notice tone="danger" title={`${notCalculable.length} atividade(s) sem duracao calculavel`}>
          Falta quantidade, indice com fonte, equipe ou calendario. O sistema NAO arbitra duracao:
          essas atividades ficam bloqueadas ate os insumos existirem.
        </Notice>
      )}

      {progress.data?.totals && (
        <div className="grid grid--4">
          <Kpi label="Avanco fisico (ponderado por HH)" value={fmtPct(progress.data.totals.physicalProgress)} hint="Nao inclui custo nem medicao" />
          <Kpi label="Previsto na linha de base" value={fmtPct(progress.data.totals.baselineProgressAtStatus)} hint="Na data de status" />
          <Kpi
            label="SPI fisico"
            value={progress.data.schedulePerformanceIndex === null || progress.data.schedulePerformanceIndex === undefined
              ? '—' : fmtNum(progress.data.schedulePerformanceIndex, 2)}
            hint="Avanco realizado / previsto"
          />
          <Kpi label="Saldo de HH" value={fmtNum(progress.data.totals.remainingHH, 0)} hint={`${fmtNum(progress.data.totals.actualHH, 0)} HH realizados`} />
        </div>
      )}

      {progress.data?.error === 'NO_BASELINE' && (
        <Notice tone="warn" title="Sem linha de base congelada">{progress.data.message}</Notice>
      )}

      <Card title="Gantt" flush>
        <AsyncBoundary loading={activities.loading} error={activities.error}>
          <Gantt
            activities={activities.data ?? []}
            links={links.data ?? []}
            onSelect={setSelected}
          />
        </AsyncBoundary>
      </Card>

      {selected && (
        <Card
          title={`${selected.code} — ${selected.name}`}
          actions={<button className="sm" onClick={() => setSelected(null)}>Fechar</button>}
        >
          <div className="grid grid--2">
            <table className="data">
              <tbody>
                <tr><th>Etapa</th><td>{selected.step ? STEP_LABELS[selected.step] ?? selected.step : '—'}</td></tr>
                <tr><th>Pacote</th><td>{selected.wbsNode ? `${selected.wbsNode.code} (${selected.wbsNode.type})` : '—'}</td></tr>
                <tr><th>Entregavel</th><td>{selected.deliverable ?? <em className="muted">nao declarado</em>}</td></tr>
                <tr><th>Criterio de conclusao</th><td>{selected.completionCriteria ?? <em className="muted">nao declarado</em>}</td></tr>
                <tr><th>Quantidade</th><td>{selected.qty !== null ? `${fmtNum(selected.qty)} ${selected.unit}` : '—'}</td></tr>
                <tr><th>Indice</th><td>{selected.productivity ? `${selected.productivity.value} HH/${selected.productivity.perUnit}` : '—'}</td></tr>
                <tr><th>Fonte do indice</th><td className="small">{selected.productivity?.source ?? <em className="muted">sem fonte</em>}</td></tr>
              </tbody>
            </table>
            <table className="data">
              <tbody>
                <tr><th>Trabalho previsto</th><td>{fmtNum(selected.workHH)} HH</td></tr>
                <tr><th>Capacidade diaria</th><td>{fmtNum(selected.dailyCapacityHH)} HH/dia</td></tr>
                <tr><th>Duracao</th><td>{selected.durationStatus === 'CALCULATED' ? `${daysFromMinutes(selected.durationMinutes)} dias uteis` : <span className="badge badge--conflict">NAO CALCULAVEL</span>}</td></tr>
                <tr><th>Inicio / termino</th><td>{fmtDate(selected.earlyStart)} a {fmtDate(selected.earlyFinish)}</td></tr>
                <tr><th>Folga total</th><td>{daysFromMinutes(selected.totalFloatMinutes)} dias</td></tr>
                <tr><th>Caminho critico</th><td>{selected.isCritical ? <span className="badge badge--conflict">SIM</span> : 'Nao'}</td></tr>
                <tr><th>Realizado</th><td>{fmtNum(selected.actualWorkHH)} HH · saldo {fmtNum(selected.remainingWorkHH)} HH</td></tr>
              </tbody>
            </table>
          </div>

          {selected.missingInputs.length > 0 && (
            <Notice tone="danger" title="Insumos que faltam para calcular a duracao">
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {selected.missingInputs.map((m, i) => <li key={i}>{m.reason}</li>)}
              </ul>
            </Notice>
          )}

          {selected.calcMemo.length > 0 && (
            <>
              <div className="small muted" style={{ marginTop: 10, marginBottom: 4 }}>Memoria de calculo:</div>
              <div className="evidence">{selected.calcMemo.join('\n')}</div>
            </>
          )}
        </Card>
      )}

      {result && (
        <Card title={`Qualidade da logica — ${result.quality.summary.errors} erro(s), ${result.quality.summary.warnings} aviso(s)`}>
          <Notice tone={result.quality.summary.blocking ? 'danger' : 'ok'}>
            {result.quality.summary.blocking
              ? 'Ha erros bloqueantes. Uma data calculada nao prova viabilidade: corrija a logica antes de assumir o prazo.'
              : 'Nenhum erro bloqueante nas verificacoes de logica.'}
          </Notice>
          <div className="small muted" style={{ marginBottom: 8 }}>
            Termino calculado: <b>{fmtDate(result.projectFinish)}</b> · caminho critico com {result.criticalPath.length} atividade(s).
          </div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Severidade</th><th>Codigo</th><th>Diagnostico</th></tr></thead>
              <tbody>
                {result.quality.findings.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <span className={`badge ${f.severity === 'ERROR' ? 'badge--conflict' : f.severity === 'WARNING' ? 'badge--pending' : 'badge--rule'}`}>
                        {f.severity}
                      </span>
                    </td>
                    <td className="mono small">{f.code}</td>
                    <td className="small">{f.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {progress.data?.trendingLate && progress.data.trendingLate.length > 0 && (
        <Card title={`Tendencia de atraso (${progress.data.trendingLate.length})`}>
          <table className="data">
            <thead><tr><th>Atividade</th><th>Termino planejado</th><th>Tendencia</th><th className="right">Atraso (dias uteis)</th></tr></thead>
            <tbody>
              {progress.data.trendingLate.map((t) => (
                <tr key={t.activityId}>
                  <td>{t.name}</td>
                  <td>{fmtDate(t.plannedFinish)}</td>
                  <td>{fmtDate(t.forecastFinish)}</td>
                  <td className="num">{fmtNum(t.delayDays, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {progress.data?.curve && progress.data.curve.length > 1 && (
        <Card title="Curva S — avanco fisico ponderado por HH">
          <SCurve points={progress.data.curve} />
          <p className="small muted">{progress.data.note}</p>
        </Card>
      )}
    </>
  );
}

function SCurve({ points }: { points: { date: string; baselinePct: number; plannedPct: number; actualPct: number | null }[] }): JSX.Element {
  const W = 860;
  const H = 240;
  const pad = { l: 44, r: 16, t: 12, b: 28 };
  const cw = W - pad.l - pad.r;
  const ch = H - pad.t - pad.b;
  const x = (i: number): number => pad.l + (i / Math.max(1, points.length - 1)) * cw;
  const y = (v: number): number => pad.t + ch - v * ch;

  const path = (key: 'baselinePct' | 'plannedPct' | 'actualPct'): string =>
    points
      .map((p, i) => ({ v: p[key], i }))
      .filter((p): p is { v: number; i: number } => p.v !== null)
      .map((p, k) => `${k === 0 ? 'M' : 'L'} ${x(p.i)} ${y(p.v)}`)
      .join(' ');

  return (
    <>
      <svg width={W} height={H} role="img" aria-label="Curva S">
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="#e6eaed" />
            <text x={6} y={y(v) + 4} fontSize={10} fill="#5a6672">{Math.round(v * 100)}%</text>
          </g>
        ))}
        <path d={path('baselinePct')} fill="none" stroke="#8b959e" strokeWidth={2} strokeDasharray="5 3" />
        <path d={path('plannedPct')} fill="none" stroke="#2b6d99" strokeWidth={2} />
        <path d={path('actualPct')} fill="none" stroke="#1c6b3a" strokeWidth={2.5} />
      </svg>
      <div className="gantt-legend" style={{ border: 0 }}>
        <span><i style={{ background: '#8b959e', height: 2 }} />Linha de base</span>
        <span><i style={{ background: '#2b6d99', height: 2 }} />Plano atual</span>
        <span><i style={{ background: '#1c6b3a', height: 3 }} />Realizado (nao projetado alem da data de status)</span>
      </div>
    </>
  );
}
