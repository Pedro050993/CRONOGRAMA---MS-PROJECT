import { useMemo } from 'react';
import type { Activity, LogicLink } from '../lib/types';

const NODE_W = 168;
const NODE_H = 34;
const GAP_X = 60;
const GAP_Y = 16;

/**
 * Grafo de precedencias em camadas (ordem topologica).
 * Vinculo sugerido aparece tracejado: o planejador ve, na propria imagem, o que
 * ainda nao foi validado e portanto nao esta no calculo aprovado.
 */
export function PrecedenceGraph({ activities, links, onSelectLink }: {
  activities: Activity[];
  links: LogicLink[];
  onSelectLink?: (l: LogicLink) => void;
}): JSX.Element {
  const layout = useMemo(() => {
    const active = links.filter((l) => l.status !== 'REJECTED');
    const ids = activities.map((a) => a.id);
    const indeg = new Map(ids.map((id) => [id, 0]));
    const adj = new Map(ids.map((id) => [id, [] as string[]]));
    for (const l of active) {
      if (!indeg.has(l.predecessorId) || !indeg.has(l.successorId)) continue;
      adj.get(l.predecessorId)!.push(l.successorId);
      indeg.set(l.successorId, (indeg.get(l.successorId) ?? 0) + 1);
    }
    const level = new Map<string, number>(ids.map((id) => [id, 0]));
    const queue = ids.filter((id) => (indeg.get(id) ?? 0) === 0);
    const seen = new Set(queue);
    while (queue.length) {
      const n = queue.shift()!;
      for (const m of adj.get(n) ?? []) {
        level.set(m, Math.max(level.get(m) ?? 0, (level.get(n) ?? 0) + 1));
        const d = (indeg.get(m) ?? 1) - 1;
        indeg.set(m, d);
        if (d === 0 && !seen.has(m)) { queue.push(m); seen.add(m); }
      }
    }
    const byLevel = new Map<number, string[]>();
    for (const id of ids) {
      const lv = level.get(id) ?? 0;
      byLevel.set(lv, [...(byLevel.get(lv) ?? []), id]);
    }
    const pos = new Map<string, { x: number; y: number }>();
    for (const [lv, group] of byLevel) {
      group.forEach((id, i) => pos.set(id, { x: 20 + lv * (NODE_W + GAP_X), y: 20 + i * (NODE_H + GAP_Y) }));
    }
    const width = 40 + (Math.max(...[...byLevel.keys()], 0) + 1) * (NODE_W + GAP_X);
    const height = 40 + Math.max(...[...byLevel.values()].map((g) => g.length), 1) * (NODE_H + GAP_Y);
    return { pos, width, height };
  }, [activities, links]);

  if (activities.length === 0) {
    return <div className="empty"><strong>Sem atividades</strong>Crie atividades para ver a rede de precedencias.</div>;
  }

  const byId = new Map(activities.map((a) => [a.id, a]));

  return (
    <div style={{ overflow: 'auto', maxHeight: '65vh' }}>
      <svg width={layout.width} height={layout.height} role="img" aria-label="Grafo de precedencias">
        <defs>
          <marker id="gArrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <path d="M0,0 L7,3.5 L0,7 Z" fill="#7d8992" />
          </marker>
        </defs>

        {links.filter((l) => l.status !== 'REJECTED').map((l) => {
          const a = layout.pos.get(l.predecessorId);
          const b = layout.pos.get(l.successorId);
          if (!a || !b) return null;
          const x1 = a.x + NODE_W;
          const y1 = a.y + NODE_H / 2;
          const x2 = b.x;
          const y2 = b.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          const suggested = l.status === 'SUGGESTED';
          return (
            <path
              key={l.id}
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke={suggested ? '#b08b3c' : '#7d8992'}
              strokeWidth={1.4}
              strokeDasharray={suggested ? '5 3' : undefined}
              markerEnd="url(#gArrow)"
              style={{ cursor: onSelectLink ? 'pointer' : 'default' }}
              onClick={() => onSelectLink?.(l)}
            >
              <title>{`${l.type}${l.lagMinutes ? ` +${(l.lagMinutes / 480).toFixed(1)}d` : ''} — ${l.status}\n${l.reason}`}</title>
            </path>
          );
        })}

        {activities.map((a) => {
          const p = layout.pos.get(a.id);
          if (!p) return null;
          return (
            <g key={a.id}>
              <rect
                x={p.x} y={p.y} width={NODE_W} height={NODE_H} rx={3}
                fill={a.isMilestone ? '#eef3f7' : '#fff'}
                stroke={a.isCritical ? '#c0392b' : '#9aa5ae'}
                strokeWidth={a.isCritical ? 2 : 1}
              />
              <text x={p.x + 8} y={p.y + 14} fontSize={10.5} fontWeight={700} fill="#16202a">{a.code}</text>
              <text x={p.x + 8} y={p.y + 26} fontSize={10} fill="#5a6672">
                {a.name.length > 26 ? `${a.name.slice(0, 26)}…` : a.name}
              </text>
              <title>{`${a.code} — ${a.name}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="gantt-legend">
        <span><i style={{ background: '#7d8992', height: 2 }} />Vinculo validado (entra no calculo)</span>
        <span><i style={{ background: '#b08b3c', height: 2 }} />Sugerido pela IA (nao entra no calculo)</span>
        <span><i style={{ border: '2px solid #c0392b', background: 'transparent', height: 10 }} />Caminho critico</span>
      </div>
    </div>
  );
}
