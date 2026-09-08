import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtNum, fmtPct } from '../lib/format';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';
import { Semaphore } from '../components/Provenance';

interface StageDef { key: string; label: string; weight: number; evidenceRequired: string; requires?: string[] }
interface MapDef { id: string; discipline: string; name: string; controlUnit: string; stages: StageDef[]; fields: string[] }
interface Evaluated {
  item: { id: string; controlKey: string; fields: Record<string, unknown>; stages: Record<string, { status: string; evidenceRef?: string }>; plannedHH: number | null; version: number };
  evaluation: { physicalProgress: number; semaphore: string; semaphoreRule: string; violations: string[]; exceptions: string[] };
}

export function ControlMaps(): JSX.Element {
  const { projectId } = useParams();
  const defs = useApi<MapDef[]>(`/api/projects/${projectId}/control-maps/definitions`);
  const [mapId, setMapId] = useState('MAP.PIPING.V1');
  const items = useApi<{ definition: MapDef; items: Evaluated[]; progress: { progress: number; totalHH: number; earnedHH: number; excludedItemIds: string[] } }>(
    `/api/projects/${projectId}/control-maps/${mapId}/items`,
  );
  const [editing, setEditing] = useState<Evaluated | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Mapas de controle</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing({
          item: { id: '', controlKey: '', fields: {}, stages: {}, plannedHH: null, version: 0 },
          evaluation: { physicalProgress: 0, semaphore: 'GREY', semaphoreRule: '', violations: [], exceptions: [] },
        })}>
          Novo item
        </button>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'danger'}>{msg.text}</Notice>}

      <div className="toolbar">
        <Field label="Mapa">
          <select value={mapId} onChange={(e) => setMapId(e.target.value)}>
            {defs.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
      </div>

      {items.data && (
        <Notice tone="info" title="Como o avanco e calculado">
          Cada estagio tem peso declarado e exige evidencia para ser concluido. O avanco do conjunto e
          ponderado por HH: {fmtNum(items.data.progress.earnedHH, 0)} de {fmtNum(items.data.progress.totalHH, 0)} HH
          = <b>{fmtPct(items.data.progress.progress)}</b>.
          {items.data.progress.excludedItemIds.length > 0 &&
            ` ${items.data.progress.excludedItemIds.length} item(ns) sem HH previsto ficaram fora da ponderacao.`}
        </Notice>
      )}

      <AsyncBoundary
        loading={items.loading} error={items.error} empty={!items.data?.items.length}
        emptyTitle="Nenhum item neste mapa"
        emptyHint="Crie itens por junta, spool, linha, circuito ou tag."
      >
        <Card title={`${items.data?.definition.name} — unidade de controle: ${items.data?.definition.controlUnit}`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Chave</th>
                  {items.data?.definition.stages.map((s) => (
                    <th key={s.key} title={`Peso ${Math.round(s.weight * 100)}% · evidencia: ${s.evidenceRequired}`}>
                      {s.label}<br /><span className="small muted">{Math.round(s.weight * 100)}%</span>
                    </th>
                  ))}
                  <th className="right">HH</th>
                  <th className="right">Avanco</th>
                  <th>Semaforo</th>
                  <th>Violacoes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.data?.items.map((e) => (
                  <tr key={e.item.id}>
                    <td className="mono small">{e.item.controlKey}</td>
                    {items.data!.definition.stages.map((s) => {
                      const st = e.item.stages[s.key];
                      const done = st?.status === 'DONE';
                      return (
                        <td key={s.key} style={{ textAlign: 'center' }} title={st?.evidenceRef ? `Evidencia: ${st.evidenceRef}` : 'Sem evidencia'}>
                          {done ? '✓' : st?.status === 'NOT_APPLICABLE' ? 'N/A' : st?.status === 'IN_PROGRESS' ? '…' : '—'}
                        </td>
                      );
                    })}
                    <td className="num">{fmtNum(e.item.plannedHH, 0)}</td>
                    <td className="num">{fmtPct(e.evaluation.physicalProgress, 0)}</td>
                    <td><Semaphore level={e.evaluation.semaphore} rule={e.evaluation.semaphoreRule} /></td>
                    <td className="small" style={{ maxWidth: 300, color: 'var(--danger)' }}>
                      {e.evaluation.violations.join(' ') || '—'}
                    </td>
                    <td><button className="sm" onClick={() => setEditing(e)}>Editar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </AsyncBoundary>

      {editing && items.data && (
        <ItemDialog
          projectId={projectId!}
          mapDef={items.data.definition}
          current={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setMsg({ tone: 'ok', text: 'Item salvo.' }); items.reload(); }}
          onError={(text) => setMsg({ tone: 'danger', text })}
        />
      )}
    </>
  );
}

function ItemDialog({ projectId, mapDef, current, onClose, onSaved, onError }: {
  projectId: string; mapDef: MapDef; current: Evaluated;
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}): JSX.Element {
  const [controlKey, setControlKey] = useState(current.item.controlKey);
  const [plannedHH, setPlannedHH] = useState(String(current.item.plannedHH ?? ''));
  const [stages, setStages] = useState<Record<string, { status: string; evidenceRef?: string }>>(
    () => ({ ...current.item.stages }),
  );
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.put(`/api/projects/${projectId}/control-maps/${mapDef.id}/items/${encodeURIComponent(controlKey)}`, {
        fields: current.item.fields,
        stages,
        plannedHH: plannedHH ? Number(plannedHH) : undefined,
        version: current.item.version || undefined,
      });
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(16,34,47,.5)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
      <div className="card" style={{ width: 620, margin: 0, maxHeight: '86vh', overflow: 'auto' }}>
        <div className="card__head"><h3>Item do mapa de controle</h3></div>
        <div className="card__body">
          <div className="grid grid--2">
            <Field label="Chave de controle" hint={mapDef.controlUnit}>
              <input value={controlKey} onChange={(e) => setControlKey(e.target.value)} disabled={Boolean(current.item.id)} />
            </Field>
            <Field label="HH previsto" hint="Sem HH o item nao entra na ponderacao do avanco.">
              <input type="number" value={plannedHH} onChange={(e) => setPlannedHH(e.target.value)} />
            </Field>
          </div>

          <table className="data">
            <thead><tr><th>Estagio</th><th>Status</th><th>Evidencia</th></tr></thead>
            <tbody>
              {mapDef.stages.map((s) => {
                const st = stages[s.key] ?? { status: 'NOT_STARTED' };
                return (
                  <tr key={s.key}>
                    <td title={s.evidenceRequired}>{s.label} <span className="small muted">({Math.round(s.weight * 100)}%)</span></td>
                    <td>
                      <select
                        value={st.status}
                        onChange={(e) => setStages({ ...stages, [s.key]: { ...st, status: e.target.value } })}
                      >
                        <option value="NOT_STARTED">Nao iniciado</option>
                        <option value="IN_PROGRESS">Em andamento</option>
                        <option value="DONE">Concluido</option>
                        <option value="BLOCKED">Bloqueado</option>
                        <option value="NOT_APPLICABLE">Nao aplicavel</option>
                      </select>
                    </td>
                    <td>
                      <input
                        placeholder={s.evidenceRequired}
                        value={st.evidenceRef ?? ''}
                        onChange={(e) => setStages({ ...stages, [s.key]: { ...st, evidenceRef: e.target.value } })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <Notice tone="info">
            Um estagio nao pode ser concluido sem a evidencia exigida. A excecao existe, mas precisa de
            justificativa e aprovacao registradas — e fica marcada como excecao no mapa.
          </Notice>

          <div className="row">
            <button className="primary" onClick={() => void save()} disabled={busy || !controlKey}>Salvar</button>
            <button onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
