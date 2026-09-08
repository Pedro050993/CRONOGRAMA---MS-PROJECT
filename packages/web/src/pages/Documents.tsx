import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { DOC_TYPE_LABELS, fmtDateTime } from '../lib/format';
import { AsyncBoundary, Card, Field, Notice } from '../components/Ui';

interface UploadResult {
  fileName: string;
  folderPath: string;
  outcome: 'DUPLICATE' | 'NEW_REVISION' | 'NEW_DOCUMENT' | 'AMBIGUOUS';
  reason: string;
  missingEvidence?: string[];
  support: { level: string; phase: number; blockedMessage?: string; alternatives?: string[] };
  documentId?: string;
}

interface MatrixRow {
  id: string; fileName: string; folderPath: string; documentNumber: string | null;
  suggestedType: string; confirmedType: string | null; typeConfidence: number | null;
  discipline: string | null; area: string | null; revision: string | null;
  status: string | null; versionCount: number; uploadedAt: string | null;
  inconsistencies: string[];
}

const OUTCOME_LABEL: Record<string, { text: string; cls: string }> = {
  NEW_DOCUMENT: { text: 'NOVO DOCUMENTO', cls: 'badge--fact' },
  NEW_REVISION: { text: 'NOVA REVISAO', cls: 'badge--user' },
  DUPLICATE: { text: 'DUPLICATA', cls: 'badge--rule' },
  AMBIGUOUS: { text: 'AMBIGUO', cls: 'badge--pending' },
};

export function Documents(): JSX.Element {
  const { projectId } = useParams();
  const { data, loading, error, reload } = useApi<{ rows: MatrixRow[]; summary: Record<string, number> }>(
    `/api/projects/${projectId}/documents/matrix`,
  );
  const [results, setResults] = useState<UploadResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<MatrixRow | null>(null);

  const send = async (files: File[], paths?: string[]): Promise<void> => {
    if (files.length === 0) return;
    setBusy(true);
    try {
      const form = new FormData();
      files.forEach((f, i) => {
        form.append('file', f, f.name);
        const relative = paths?.[i] ?? (f as File & { webkitRelativePath?: string }).webkitRelativePath;
        if (relative) form.append(`path:${f.name}`, relative);
      });
      const r = await api.upload<{ results: UploadResult[] }>(`/api/projects/${projectId}/documents/upload`, form);
      setResults(r.results);
      reload();
    } catch (e) {
      setResults([]);
      alert(e instanceof Error ? e.message : 'Falha no upload.');
    } finally {
      setBusy(false);
    }
  };

  const onDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    setDragging(false);
    await send(Array.from(e.dataTransfer.files));
  };

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Documentos</h1>
        <span className="spacer" />
        <button onClick={() => fileInput.current?.click()} disabled={busy}>Selecionar arquivos</button>
        <button onClick={() => folderInput.current?.click()} disabled={busy}>Selecionar pasta</button>
      </div>

      <input
        ref={fileInput} type="file" multiple hidden
        onChange={(e) => void send(Array.from(e.target.files ?? []))}
      />
      <input
        ref={folderInput} type="file" hidden
        // @ts-expect-error atributo suportado por Chromium/WebKit para envio de pasta
        webkitdirectory="" directory=""
        onChange={(e) => void send(Array.from(e.target.files ?? []))}
      />

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => void onDrop(e)}
        style={{
          border: `2px dashed ${dragging ? '#14496b' : '#ccd3d9'}`,
          background: dragging ? '#eaf1f6' : '#fff',
          padding: 22, textAlign: 'center', borderRadius: 3, marginBottom: 12,
        }}
      >
        {busy ? 'Enviando e enfileirando para processamento…' : (
          <>
            <strong>Arraste arquivos, pastas ou um ZIP aqui</strong>
            <div className="small muted" style={{ marginTop: 4 }}>
              A arvore de pastas e preservada. Arquivos identicos sao detectados por SHA-256 e nao reprocessam.
              DWG e NWD sao armazenados integros, mas ficam bloqueados com explicacao — nesta fase eles nao sao interpretados.
            </div>
          </>
        )}
      </div>

      {results && (
        <Card title={`Resultado do envio (${results.length})`} actions={<button className="sm" onClick={() => setResults(null)}>Fechar</button>}>
          <table className="data">
            <thead><tr><th>Arquivo</th><th>Pasta</th><th>Resultado</th><th>Detalhe</th></tr></thead>
            <tbody>
              {results.map((r, i) => {
                const o = OUTCOME_LABEL[r.outcome] ?? { text: r.outcome, cls: 'badge--rule' };
                const blocked = r.support?.level !== 'SUPPORTED';
                return (
                  <tr key={i}>
                    <td>{r.fileName}</td>
                    <td className="mono small">{r.folderPath}</td>
                    <td className="nowrap">
                      <span className={`badge ${o.cls}`}>{o.text}</span>
                      {blocked && <><br /><span className="badge badge--conflict" style={{ marginTop: 3 }}>NAO INTERPRETADO</span></>}
                    </td>
                    <td className="small">
                      {r.reason}
                      {blocked && (
                        <div className="notice notice--warn" style={{ marginTop: 6 }}>
                          <p>{r.support.blockedMessage}</p>
                          {r.support.alternatives && (
                            <p style={{ marginTop: 4 }}><b>Formatos alternativos:</b> {r.support.alternatives.join(', ')}</p>
                          )}
                        </div>
                      )}
                      {r.missingEvidence && r.missingEvidence.length > 0 && (
                        <div className="small muted" style={{ marginTop: 4 }}>
                          Falta para decidir: {r.missingEvidence.join('; ')}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <AsyncBoundary
        loading={loading} error={error} empty={!data?.rows.length}
        emptyTitle="Nenhum documento recebido"
        emptyHint="Envie a lista de linhas e os isometricos para comecar."
      >
        {data && (
          <>
            {(data.summary['blocked'] ?? 0) > 0 && (
              <Notice tone="warn" title={`${data.summary['blocked']} documento(s) em formato nao interpretavel`}>
                Os arquivos estao armazenados e versionados, mas o conteudo nao foi lido. Veja a coluna de inconsistencias.
              </Notice>
            )}
            <Card title={`Matriz documental (${data.rows.length})`} flush>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Arquivo</th><th>Pasta</th><th>Numero</th><th>Rev.</th>
                      <th>Tipo</th><th>Area</th><th>Status</th><th>Inconsistencias</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.fileName}</td>
                        <td className="mono small">{r.folderPath}</td>
                        <td className="mono">{r.documentNumber ?? <em className="muted">—</em>}</td>
                        <td>{r.revision ?? <em className="muted">—</em>}</td>
                        <td>
                          {r.confirmedType ? (
                            <span className="badge badge--fact">{DOC_TYPE_LABELS[r.confirmedType] ?? r.confirmedType}</span>
                          ) : (
                            <span className="badge badge--ai" title={`Sugestao automatica, confianca ${Math.round((r.typeConfidence ?? 0) * 100)}%`}>
                              {DOC_TYPE_LABELS[r.suggestedType] ?? r.suggestedType} (sugerido)
                            </span>
                          )}
                        </td>
                        <td>{r.area ?? '—'}</td>
                        <td className="small">{r.status ?? '—'}</td>
                        <td className="small">
                          {r.inconsistencies.length === 0
                            ? <span className="muted">—</span>
                            : <ul style={{ margin: 0, paddingLeft: 16 }}>{r.inconsistencies.map((i, k) => <li key={k}>{i}</li>)}</ul>}
                        </td>
                        <td><button className="sm" onClick={() => setEditing(r)}>Confirmar tipo</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </AsyncBoundary>

      {editing && (
        <ConfirmTypeDialog
          row={editing}
          projectId={projectId!}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </>
  );
}

function ConfirmTypeDialog({ row, projectId, onClose, onSaved }: {
  row: MatrixRow; projectId: string; onClose: () => void; onSaved: () => void;
}): JSX.Element {
  const [type, setType] = useState(row.confirmedType ?? row.suggestedType);
  const [documentNumber, setDocumentNumber] = useState(row.documentNumber ?? '');
  const [area, setArea] = useState(row.area ?? '');
  const [discipline, setDiscipline] = useState(row.discipline ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const doc = await api.get<{ version: number }>(`/api/projects/${projectId}/documents/${row.id}`);
      await api.post(`/api/projects/${projectId}/documents/${row.id}/classify`, {
        confirmedType: type,
        documentNumber: documentNumber || undefined,
        area: area || undefined,
        discipline: discipline || undefined,
        version: doc.version,
        justification: 'Classificacao confirmada na matriz documental.',
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao confirmar.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(16,34,47,.5)', display: 'grid', placeItems: 'center', zIndex: 10 }}>
      <div className="card" style={{ width: 460, margin: 0 }}>
        <div className="card__head"><h3>Confirmar classificacao</h3></div>
        <div className="card__body">
          <p className="small muted">
            A classificacao automatica e apenas sugestao. Ela so vira fato do projeto depois desta confirmacao.
          </p>
          {error && <Notice tone="danger">{error}</Notice>}
          <Field label="Tipo do documento">
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Numero do documento"><input value={documentNumber} onChange={(e) => setDocumentNumber(e.target.value)} /></Field>
          <Field label="Area"><input value={area} onChange={(e) => setArea(e.target.value)} /></Field>
          <Field label="Disciplina"><input value={discipline} onChange={(e) => setDiscipline(e.target.value)} /></Field>
          <div className="row">
            <button className="primary" onClick={() => void save()} disabled={busy}>Confirmar</button>
            <button onClick={onClose}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
