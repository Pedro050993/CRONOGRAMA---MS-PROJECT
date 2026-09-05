import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtNum } from '../lib/format';
import type { WbsNode } from '../lib/types';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';

interface WbsResponse {
  nodes: WbsNode[];
  outline: (WbsNode & { outlineNumber: string; outlineLevel: number })[];
  issues: { nodeId: string; code: string; severity: 'ERROR' | 'WARNING'; message: string }[];
}

const TYPE_HELP: Record<string, string> = {
  PROJECT: 'Raiz. Um por projeto.',
  PHASE: 'Macroentrega. Filho do projeto.',
  CWA: 'Area de construcao. Onde a obra acontece fisicamente.',
  CWP: 'Pacote por disciplina/sistema dentro de uma CWA.',
  IWP: 'Pacote executavel em campo. Precisa de entregavel, quantidade e limite.',
  ACTIVITY: 'Atividade de cronograma.',
};

const ALLOWED_CHILDREN: Record<string, string[]> = {
  PROJECT: ['PHASE', 'CWA'], PHASE: ['CWA'], CWA: ['CWP'], CWP: ['IWP', 'ACTIVITY'], IWP: ['ACTIVITY'], ACTIVITY: [],
};

export function Wbs(): JSX.Element {
  const { projectId } = useParams();
  const { data, loading, error, reload } = useApi<WbsResponse>(`/api/projects/${projectId}/wbs`);
  const [parent, setParent] = useState<WbsNode | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  // Sem outline calculado (EAP com erro), caimos na lista crua para o usuario
  // ainda conseguir ver e corrigir a estrutura.
  const rows: (WbsNode & { outlineNumber?: string; outlineLevel?: number })[] =
    data?.outline.length ? data.outline : data?.nodes ?? [];
  const errors = data?.issues.filter((i) => i.severity === 'ERROR') ?? [];
  const warnings = data?.issues.filter((i) => i.severity === 'WARNING') ?? [];

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>EAP e AWP</h1>
        <span className="spacer" />
        {data && data.nodes.length === 0 && (
          <button className="primary" onClick={() => setParent({ id: '', type: 'PROJECT' } as WbsNode)}>
            Criar no raiz
          </button>
        )}
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'danger'}>{msg.text}</Notice>}

      {errors.length > 0 && (
        <Notice tone="danger" title={`${errors.length} erro(s) estrutural(is) na EAP`}>
          Enquanto houver erro, a numeracao (OutlineNumber) nao e gerada e o cronograma nao pode ser exportado.
        </Notice>
      )}
      {warnings.length > 0 && (
        <Notice tone="warn" title={`${warnings.length} aviso(s)`}>
          {warnings.slice(0, 3).map((w) => w.message).join(' ')}
        </Notice>
      )}

      <Notice tone="info" title="CWA, CWP e IWP sao niveis distintos">
        A hierarquia e validada pelo sistema: um IWP nao pode ser pendurado direto numa CWA. Isso impede
        que "pacote" vire uma palavra sem significado no cronograma.
      </Notice>

      <AsyncBoundary
        loading={loading} error={error} empty={!data?.nodes.length}
        emptyTitle="EAP vazia"
        emptyHint="Crie o no raiz do projeto e desca ate os IWP."
      >
        <Card title={`Estrutura (${data?.nodes.length ?? 0} nos)`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>Nivel</th><th>Codigo</th><th>Tipo</th><th>Nome</th><th>Disciplina</th><th>Area</th>
                    <th className="right">Quantidade</th><th>Entregavel</th><th>Limite (fora do escopo)</th><th></th></tr>
              </thead>
              <tbody>
                {rows.map((n) => {
                  const level = n.outlineLevel ?? 1;
                  const nodeIssues = data?.issues.filter((i) => i.nodeId === n.id) ?? [];
                  return (
                    <tr key={n.id}>
                      <td className="mono small">{n.outlineNumber ?? '—'}</td>
                      <td className="mono small">{n.code}</td>
                      <td><span className="badge badge--rule" title={TYPE_HELP[n.type]}>{n.type}</span></td>
                      <td style={{ paddingLeft: 8 + (level - 1) * 14 }}>
                        {n.name}
                        {nodeIssues.length > 0 && (
                          <div className="small" style={{ color: nodeIssues.some((i) => i.severity === 'ERROR') ? 'var(--danger)' : 'var(--warn)' }}>
                            {nodeIssues.map((i) => i.message).join(' ')}
                          </div>
                        )}
                      </td>
                      <td>{n.discipline ?? '—'}</td>
                      <td>{n.area ?? '—'}</td>
                      <td className="num">{n.qty !== null ? `${fmtNum(n.qty)} ${n.unit ?? ''}` : '—'}</td>
                      <td className="small">{n.deliverable ?? <em className="muted">nao declarado</em>}</td>
                      <td className="small">{n.scopeOut ?? <em className="muted">nao declarado</em>}</td>
                      <td>
                        {(ALLOWED_CHILDREN[n.type]?.length ?? 0) > 0 && (
                          <button className="sm" onClick={() => setParent(n)}>Adicionar filho</button>
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

      {parent && (
        <NodeDialog
          projectId={projectId!}
          parent={parent.id ? parent : null}
          onClose={() => setParent(null)}
          onSaved={(text) => { setParent(null); setMsg({ tone: 'ok', text }); reload(); }}
          onError={(text) => setMsg({ tone: 'danger', text })}
        />
      )}
    </>
  );
}

function NodeDialog({ projectId, parent, onClose, onSaved, onError }: {
  projectId: string; parent: WbsNode | null;
  onClose: () => void; onSaved: (msg: string) => void; onError: (msg: string) => void;
}): JSX.Element {
  const allowed = parent ? ALLOWED_CHILDREN[parent.type] ?? [] : ['PROJECT'];
  const [form, setForm] = useState({
    type: allowed[0] ?? 'CWA', code: '', name: '', discipline: '', area: '', system: '',
    deliverable: '', scopeIn: '', scopeOut: '', qty: '', unit: '',
  });
  const [busy, setBusy] = useState(false);

  const isIwp = form.type === 'IWP';
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post(`/api/projects/${projectId}/wbs`, {
        parentId: parent?.id ?? null,
        type: form.type,
        code: form.code,
        name: form.name,
        discipline: form.discipline || undefined,
        area: form.area || undefined,
        system: form.system || undefined,
        deliverable: form.deliverable || undefined,
        scopeIn: form.scopeIn || undefined,
        scopeOut: form.scopeOut || undefined,
        qty: form.qty ? Number(form.qty) : undefined,
        unit: form.unit || undefined,
        acceptanceCriteria: [],
      });
      onSaved(`No "${form.code}" criado.`);
    } catch (e) {
      const err = e as { message: string; details?: unknown };
      onError(`${err.message}${err.details ? ` ${JSON.stringify(err.details)}` : ''}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(16,34,47,.5)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
      <div className="card" style={{ width: 560, margin: 0, maxHeight: '86vh', overflow: 'auto' }}>
        <div className="card__head"><h3>{parent ? `Novo filho de ${parent.code}` : 'Novo no raiz'}</h3></div>
        <div className="card__body">
          <Field label="Tipo" hint={TYPE_HELP[form.type]}>
            <select value={form.type} onChange={set('type')}>
              {allowed.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <div className="grid grid--2">
            <Field label="Codigo estavel *" hint="Nao muda quando um irmao e inserido antes."><input value={form.code} onChange={set('code')} /></Field>
            <Field label="Nome *"><input value={form.name} onChange={set('name')} /></Field>
            <Field label="Disciplina" hint={form.type === 'CWP' ? 'Obrigatoria em CWP.' : undefined}><input value={form.discipline} onChange={set('discipline')} /></Field>
            <Field label="Area" hint={form.type === 'CWA' ? 'Obrigatoria em CWA.' : undefined}><input value={form.area} onChange={set('area')} /></Field>
            <Field label="Sistema"><input value={form.system} onChange={set('system')} /></Field>
            <Field label="Unidade"><input value={form.unit} onChange={set('unit')} placeholder="in-dia, m, jt" /></Field>
            <Field label="Quantidade" hint={isIwp ? 'Obrigatoria em IWP.' : undefined}><input type="number" value={form.qty} onChange={set('qty')} /></Field>
          </div>
          <Field label="Entregavel verificavel" hint={isIwp ? 'Obrigatorio em IWP.' : undefined}>
            <input value={form.deliverable} onChange={set('deliverable')} />
          </Field>
          <Field label="Escopo incluso"><textarea rows={2} value={form.scopeIn} onChange={set('scopeIn')} /></Field>
          <Field label="Limite: o que NAO faz parte" hint="Pacote sem fronteira declarada esconde interface.">
            <textarea rows={2} value={form.scopeOut} onChange={set('scopeOut')} />
          </Field>
          <div className="row">
            <button className="primary" onClick={() => void save()} disabled={busy || !form.code || !form.name}>Criar</button>
            <button onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
