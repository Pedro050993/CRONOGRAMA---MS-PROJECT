import { useRef, useState } from 'react';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDate, fmtDateTime, fmtNum } from '../lib/format';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';
import { Confidence } from '../components/Provenance';

interface Index {
  id: string; code: string; description: string; value: number; perUnit: string;
  basis: string; source: string; sourceDate: string; discipline: string | null;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  confidence: number | null; approvedBy: string | null; rejectionReason: string | null;
  importRow: number | null; importSheet: string | null; version: number;
  import?: { id: string; fileName: string; sha256: string; createdAt: string } | null;
}

interface ImportRecord {
  id: string; fileName: string; sha256: string; sheetName: string | null;
  candidatesCount: number; rejectedCount: number; status: string; statusMessage: string | null;
  warnings: string[]; suppliedByUser: string[]; createdAt: string;
  rejectedRows: { rowIndex: number; raw: string[]; reason: string; field?: string }[];
}

interface ImportResponse {
  importId: string; imported: number;
  rejected: { rowIndex: number; raw: string[]; reason: string; field?: string }[];
  renamed: { from: string; to: string }[];
  warnings: string[]; suppliedByUser: string[]; note: string;
  status?: string; jobId?: string;
}

const BASIS_LABEL: Record<string, string> = {
  BUDGETED: 'Orçado', PLANNED: 'Planejado', OBSERVED: 'Observado', FORECAST: 'Projetado',
};

const STATUS_BADGE: Record<string, { text: string; cls: string }> = {
  PENDING: { text: 'AGUARDA CONFERENCIA', cls: 'badge--pending' },
  APPROVED: { text: 'CONFERIDO', cls: 'badge--fact' },
  REJECTED: { text: 'REJEITADO', cls: 'badge--conflict' },
};

/**
 * Base de produtividade do projeto (§ D6).
 *
 * Índice digitado por humano nasce conferido. Índice lido de arquivo nasce PENDENTE
 * e não calcula prazo antes de alguém conferir contra a fonte.
 */
export function Productivity({ projectId }: { projectId: string }): JSX.Element {
  const indices = useApi<Index[]>(`/api/projects/${projectId}/productivity`);
  const imports = useApi<ImportRecord[]>(`/api/projects/${projectId}/productivity/imports`);
  const fileInput = useRef<HTMLInputElement>(null);
  const [basis, setBasis] = useState('');
  const [sourceDate, setSourceDate] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn' | 'danger'; text: string } | null>(null);

  const enviar = async (file: File, allowDuplicate = false): Promise<void> => {
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      if (basis) form.append('declaredBasis', basis);
      if (sourceDate) form.append('declaredSourceDate', sourceDate);
      if (sheetName) form.append('sheetName', sheetName);
      if (allowDuplicate) form.append('allowDuplicate', 'true');

      const r = await api.upload<ImportResponse>(`/api/projects/${projectId}/productivity/imports`, form);
      setResult(r);
      setMsg({ tone: r.imported > 0 ? 'ok' : 'warn', text: r.note });
      indices.reload();
      imports.reload();
    } catch (e) {
      const err = e as { status?: number; message: string };
      if (err.status === 409 && confirm(`${err.message}\n\nImportar mesmo assim?`)) {
        await enviar(file, true);
        return;
      }
      setMsg({ tone: 'danger', text: err.message });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const decidir = async (idx: Index, decision: 'APPROVED' | 'REJECTED'): Promise<void> => {
    let justification: string | undefined;
    if (decision === 'REJECTED') {
      justification = prompt(`Por que o índice "${idx.code}" não deve ser usado?`) ?? undefined;
      if (!justification) return;
    }
    try {
      await api.post(`/api/projects/${projectId}/productivity/${idx.id}/decide`, {
        decision, version: idx.version, justification,
      });
      indices.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao decidir.' });
    }
  };

  const corrigir = async (idx: Index): Promise<void> => {
    const novo = prompt(`Índice de "${idx.description}" (HH/${idx.perUnit}).\nValor lido do arquivo: ${idx.value}`, String(idx.value));
    if (!novo) return;
    const value = Number(novo.replace(',', '.'));
    if (!(value > 0)) { alert('Informe um número positivo.'); return; }
    const justification = prompt('Justifique a correção (ela passa a divergir da fonte):');
    if (!justification || justification.length < 5) { alert('Justificativa obrigatória.'); return; }
    try {
      await api.post(`/api/projects/${projectId}/productivity/${idx.id}/decide`, {
        decision: 'APPROVED', version: idx.version, corrections: { value }, justification,
      });
      indices.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao corrigir.' });
    }
  };

  const aprovarLote = async (importId: string): Promise<void> => {
    const justification = prompt('Regra da conferência em lote (mínimo 10 caracteres):');
    if (!justification || justification.length < 10) { alert('Justificativa obrigatória.'); return; }
    try {
      const r = await api.post<{ approved: number }>(`/api/projects/${projectId}/productivity/bulk-approve`, { importId, justification });
      setMsg({ tone: 'ok', text: `${r.approved} índice(s) conferidos com a regra registrada.` });
      indices.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha no lote.' });
    }
  };

  const pendentes = (indices.data ?? []).filter((i) => i.approvalStatus === 'PENDING').length;

  return (
    <>
      <Card
        title="Base de produtividade — importar de arquivo"
        actions={<button className="primary" disabled={busy} onClick={() => fileInput.current?.click()}>
          {busy ? 'Importando…' : 'Selecionar arquivo'}
        </button>}
      >
        <Notice tone="info" title="O arquivo passa a ser a fonte do índice">
          Cada índice guarda o nome do arquivo, o hash SHA-256, a aba e a linha de onde saiu.
          Índice lido de arquivo nasce <b>pendente</b>: ele não calcula prazo antes de alguém
          conferir contra a fonte. Aceita XLSX, CSV e PDF.
        </Notice>

        <div className="grid grid--3">
          <Field label="Base do índice" hint="Só é usada quando o arquivo não traz a coluna. Orçado e observado não são a mesma coisa em pleito.">
            <select value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="">Ler do arquivo</option>
              {Object.entries(BASIS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Data da fonte" hint="Só é usada quando o arquivo não traz a coluna.">
            <input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} />
          </Field>
          <Field label="Aba (XLSX)" hint="Em branco, usa a primeira aba com conteúdo.">
            <input value={sheetName} onChange={(e) => setSheetName(e.target.value)} placeholder="ex.: Produtividade" />
          </Field>
        </div>

        <input
          ref={fileInput} type="file" hidden accept=".xlsx,.xlsm,.csv,.tsv,.txt,.pdf"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void enviar(f); }}
        />

        {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : msg.tone}>{msg.text}</Notice>}

        {result && (
          <>
            {result.warnings.length > 0 && (
              <Notice tone="warn" title="Avisos da importação">
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </Notice>
            )}
            {result.renamed?.length > 0 && (
              <Notice tone="info" title={`${result.renamed.length} código(s) renomeado(s)`}>
                Já existia índice com o mesmo código no projeto. Nada foi sobrescrito:{' '}
                {result.renamed.map((r) => `${r.from} → ${r.to}`).join(', ')}.
              </Notice>
            )}
            {result.rejected?.length > 0 && (
              <Card title={`Linhas recusadas (${result.rejected.length})`} flush>
                <table className="data">
                  <thead><tr><th>Linha</th><th>Campo</th><th>Motivo</th><th>Conteúdo</th></tr></thead>
                  <tbody>
                    {result.rejected.map((r, i) => (
                      <tr key={i}>
                        <td className="num">{r.rowIndex}</td>
                        <td className="mono small">{r.field ?? '—'}</td>
                        <td className="small">{r.reason}</td>
                        <td className="mono small">{r.raw.filter(Boolean).join(' | ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </Card>

      {pendentes > 0 && (
        <Notice tone="warn" title={`${pendentes} índice(s) aguardando conferência`}>
          Enquanto não forem conferidos, as atividades que dependem deles ficam com duração
          <b> NÃO CALCULÁVEL</b>. O sistema não usa um índice que ninguém olhou.
        </Notice>
      )}

      <AsyncBoundary
        loading={indices.loading} error={indices.error} empty={!indices.data?.length}
        emptyTitle="Nenhum índice de produtividade cadastrado"
        emptyHint="Importe a base de um arquivo ou cadastre índice a índice. Sem índice com fonte, nenhuma duração é calculada."
      >
        <Card title={`Índices (${indices.data?.length ?? 0})`} flush>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Código</th><th>Serviço</th><th className="right">Índice</th><th>Unidade</th>
                  <th>Base</th><th>Data</th><th>Fonte</th><th>Origem</th>
                  <th>Confiança</th><th>Status</th><th></th>
                </tr>
              </thead>
              <tbody>
                {indices.data?.map((i) => {
                  const s = STATUS_BADGE[i.approvalStatus] ?? { text: i.approvalStatus, cls: 'badge--rule' };
                  return (
                    <tr key={i.id}>
                      <td className="mono small">{i.code}</td>
                      <td>{i.description}</td>
                      <td className="num">{fmtNum(i.value, 3)}</td>
                      <td className="mono small">HH/{i.perUnit}</td>
                      <td className="small">{BASIS_LABEL[i.basis] ?? i.basis}</td>
                      <td className="nowrap small">{fmtDate(i.sourceDate)}</td>
                      <td className="small" style={{ maxWidth: 300 }}>{i.source}</td>
                      <td className="small">
                        {i.import
                          ? <span title={`SHA-256 ${i.import.sha256}`}>
                              {i.import.fileName}
                              {i.importSheet && ` · ${i.importSheet}`}
                              {i.importRow && ` · linha ${i.importRow}`}
                            </span>
                          : <em className="muted">digitado</em>}
                      </td>
                      <td><Confidence value={i.confidence} /></td>
                      <td>
                        <span className={`badge ${s.cls}`}>{s.text}</span>
                        {i.rejectionReason && <div className="small muted">{i.rejectionReason}</div>}
                      </td>
                      <td className="nowrap">
                        {i.approvalStatus === 'PENDING' && (
                          <>
                            <button className="sm ok" onClick={() => void decidir(i, 'APPROVED')}>Conferir</button>{' '}
                            <button className="sm" onClick={() => void corrigir(i)}>Corrigir</button>{' '}
                            <button className="sm danger" onClick={() => void decidir(i, 'REJECTED')}>Rejeitar</button>
                          </>
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

      <AsyncBoundary
        loading={imports.loading} error={imports.error} empty={!imports.data?.length}
        emptyTitle="Nenhuma importação registrada"
      >
        <Card title={`Importações da base (${imports.data?.length ?? 0})`} flush>
          <table className="data">
            <thead>
              <tr><th>Data</th><th>Arquivo</th><th>Aba</th><th className="right">Importados</th>
                  <th className="right">Recusados</th><th>Status</th><th>Avisos</th><th></th></tr>
            </thead>
            <tbody>
              {imports.data?.map((im) => (
                <tr key={im.id}>
                  <td className="small nowrap">{fmtDateTime(im.createdAt)}</td>
                  <td className="small" title={`SHA-256 ${im.sha256}`}>{im.fileName}</td>
                  <td className="small">{im.sheetName ?? '—'}</td>
                  <td className="num">{im.candidatesCount}</td>
                  <td className="num">
                    {im.rejectedCount > 0
                      ? <span className="badge badge--pending">{im.rejectedCount}</span>
                      : <span className="muted">0</span>}
                  </td>
                  <td className="small">{im.status}{im.statusMessage ? ` — ${im.statusMessage}` : ''}</td>
                  <td className="small" style={{ maxWidth: 320 }}>{im.warnings.join(' ') || '—'}</td>
                  <td>
                    {im.candidatesCount > 0 && (
                      <button className="sm" onClick={() => void aprovarLote(im.id)}>Conferir em lote</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AsyncBoundary>
    </>
  );
}
