import { useMemo } from 'react';
import type { Activity } from '../lib/types';
import { fmtDate } from '../lib/format';

interface BaselineRow { activityId: string; start: string; finish: string }

const ROW_H = 22;
const LABEL_W = 320;
const HEADER_H = 40;

/**
 * Gantt em SVG proprio.
 *
 * Desenha as quatro camadas que nao podem ser confundidas (§4.3):
 * linha de base, plano atual, realizado e o bloqueio de duracao nao calculavel.
 */
export function Gantt({ activities, baseline, links, onSelect }: {
  activities: Activity[];
  baseline?: BaselineRow[];
  links?: { predecessorId: string; successorId: string; status: string }[];
  onSelect?: (a: Activity) => void;
}): JSX.Element {
  const rows = useMemo(
    () => activities.filter((a) => a.earlyStart && a.earlyFinish),
    [activities],
  );
  const baselineById = useMemo(
    () => new Map((baseline ?? []).map((b) => [b.activityId, b])),
    [baseline],
  );

  const bounds = useMemo(() => {
    const dates: number[] = [];
    for (const a of rows) {
      if (a.earlyStart) dates.push(new Date(a.earlyStart).getTime());
      if (a.earlyFinish) dates.push(new Date(a.earlyFinish).getTime());
      if (a.actualStart) dates.push(new Date(a.actualStart).getTime());
      if (a.actualFinish) dates.push(new Date(a.actualFinish).getTime());
    }
    for (const b of baselineById.values()) {
      dates.push(new Date(b.start).getTime(), new Date(b.finish).getTime());
    }
    if (dates.length === 0) return null;
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    const pad = Math.max((max - min) * 0.03, 86400000);
    return { min: min - pad, max: max + pad };
  }, [rows, baselineById]);

  if (rows.length === 0) {
    return (
      <div className="empty">
        <strong>Nenhuma atividade com datas calculadas</strong>
        Calcule as duracoes e rode o CPM para ver o Gantt.
      </div>
    );
  }
  if (!bounds) return <div className="empty">Sem intervalo de datas.</div>;

  const width = Math.max(900, rows.length > 0 ? 1100 : 900);
  const chartW = width - LABEL_W - 20;
  const height = HEADER_H + rows.length * ROW_H + 12;
  const span = bounds.max - bounds.min;
  const x = (iso: string): number => LABEL_W + ((new Date(iso).getTime() - bounds.min) / span) * chartW;

  // Marcas de mes no cabecalho.
  const ticks: { x: number; label: string }[] = [];
  const cursor = new Date(bounds.min);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= bounds.max) {
    if (cursor.getTime() >= bounds.min) {
      ticks.push({
        x: LABEL_W + ((cursor.getTime() - bounds.min) / span) * chartW,
        label: cursor.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
      });
    }
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const yOf = new Map(rows.map((a, i) => [a.id, HEADER_H + i * ROW_H + ROW_H / 2]));

  return (
    <div className="gantt">
      <svg width={width} height={height} role="img" aria-label="Grafico de Gantt">
        <rect x={0} y={0} width={width} height={HEADER_H} fill="#f7f9fa" />
        <line x1={0} y1={HEADER_H} x2={width} y2={HEADER_H} stroke="#ccd3d9" />
        {ticks.map((t) => (
          <g key={t.x}>
            <line x1={t.x} y1={HEADER_H} x2={t.x} y2={height} stroke="#e6eaed" />
            <text x={t.x + 3} y={HEADER_H - 12} fontSize={10} fill="#5a6672">{t.label}</text>
          </g>
        ))}

        {rows.map((a, i) => {
          const y = HEADER_H + i * ROW_H;
          const bl = baselineById.get(a.id);
          const cy = y + ROW_H / 2;
          const x1 = x(a.earlyStart!);
          const x2 = Math.max(x1 + 2, x(a.earlyFinish!));
          const blocked = a.durationStatus === 'NOT_CALCULABLE';

          return (
            <g key={a.id} onClick={() => onSelect?.(a)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              {i % 2 === 1 && <rect x={0} y={y} width={width} height={ROW_H} fill="#fafbfc" />}
              <text x={8} y={cy + 4} fontSize={11} fill="#16202a">
                {a.code} — {a.name.length > 42 ? `${a.name.slice(0, 42)}…` : a.name}
              </text>

              {bl && (
                <rect
                  x={x(bl.start)} y={cy - 9} width={Math.max(2, x(bl.finish) - x(bl.start))} height={4}
                  fill="#8b959e" rx={1}
                >
                  <title>{`Linha de base: ${fmtDate(bl.start)} a ${fmtDate(bl.finish)}`}</title>
                </rect>
              )}

              {a.isMilestone ? (
                <polygon
                  points={`${x1},${cy - 6} ${x1 + 6},${cy} ${x1},${cy + 6} ${x1 - 6},${cy}`}
                  fill={a.isCritical ? '#97281f' : '#14496b'}
                >
                  <title>{`Marco ${a.code}: ${fmtDate(a.earlyStart)}`}</title>
                </polygon>
              ) : blocked ? (
                <g>
                  <rect x={x1} y={cy - 5} width={12} height={10} fill="none" stroke="#97281f" strokeDasharray="2 2" />
                  <text x={x1 + 17} y={cy + 4} fontSize={10} fill="#97281f">
                    duracao nao calculavel
                    <title>{a.missingInputs.map((m) => m.reason).join(' | ')}</title>
                  </text>
                </g>
              ) : (
                <rect
                  x={x1} y={cy - 5} width={x2 - x1} height={10} rx={2}
                  fill={a.isCritical ? '#c0392b' : '#2b6d99'}
                >
                  <title>
                    {`${a.code} — ${a.name}\nPlano: ${fmtDate(a.earlyStart)} a ${fmtDate(a.earlyFinish)}` +
                     `\nHH: ${a.workHH ?? '—'}${a.isCritical ? '\nCAMINHO CRITICO' : ''}`}
                  </title>
                </rect>
              )}

              {a.actualStart && (
                <rect
                  x={x(a.actualStart)} y={cy + 6}
                  width={Math.max(2, x(a.actualFinish ?? a.earlyFinish!) - x(a.actualStart))}
                  height={4} fill="#1c6b3a" rx={1}
                >
                  <title>{`Realizado: ${fmtDate(a.actualStart)} a ${fmtDate(a.actualFinish) || 'em andamento'}`}</title>
                </rect>
              )}
            </g>
          );
        })}

        {(links ?? [])
          .filter((l) => l.status === 'VALIDATED' || l.status === 'MODIFIED')
          .map((l, i) => {
            const from = rows.find((r) => r.id === l.predecessorId);
            const to = rows.find((r) => r.id === l.successorId);
            if (!from?.earlyFinish || !to?.earlyStart) return null;
            const y1 = yOf.get(from.id)!;
            const y2 = yOf.get(to.id)!;
            const xa = x(from.earlyFinish);
            const xb = x(to.earlyStart);
            return (
              <path
                key={i}
                d={`M ${xa} ${y1} L ${xa + 6} ${y1} L ${xa + 6} ${y2} L ${xb} ${y2}`}
                fill="none" stroke="#9aa5ae" strokeWidth={1} markerEnd="url(#arrow)"
              />
            );
          })}

        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#9aa5ae" />
          </marker>
        </defs>
      </svg>

      <div className="gantt-legend">
        <span><i style={{ background: '#2b6d99' }} />Plano atual</span>
        <span><i style={{ background: '#c0392b' }} />Caminho critico</span>
        <span><i style={{ background: '#8b959e', height: 4 }} />Linha de base</span>
        <span><i style={{ background: '#1c6b3a', height: 4 }} />Realizado</span>
        <span><i style={{ border: '1px dashed #97281f', background: 'transparent' }} />Duracao nao calculavel</span>
      </div>
    </div>
  );
}
