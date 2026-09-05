import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { fmtDateTime, fmtInt } from '../lib/format';
import { AsyncBoundary, Card, Notice } from '../components/Ui';

interface ValidationReport {
  valid: boolean;
  findings: { code: string; severity: 'ERROR' | 'WARNING' | 'INFO'; message: string }[];
  counts: { tasks: number; links: number; resources: number; assignments: number; calendars: number };
}
interface ValidateResponse {
  modelValidation: ValidationReport;
  xmlValidation: ValidationReport;
  byteLength: number;
  notCalculable: string[];
  downloadable: boolean;
  note: string;
}
interface ExportRecord {
  id: string; format: string; storageKey: string; byteSize: number; createdAt: string;
}

const DATASETS: [string, string][] = [
  ['quantities', 'Quantitativos'], ['activities', 'Atividades'], ['links', 'Vinculos'],
  ['wbs', 'EAP'], ['constraints', 'Restricoes'], ['audit', 'Auditoria'],
];

export function Exports(): JSX.Element {
  const { projectId } = useParams();
  const validation = useApi<ValidateResponse>(`/api/projects/${projectId}/exports/mspdi/validate`);
  const history = useApi<ExportRecord[]>(`/api/projects/${projectId}/exports`);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [importResult, setImportResult] = useState<Record<string, unknown> | null>(null);

  const downloadXml = async (): Promise<void> => {
    try {
      await api.download(`/api/projects/${projectId}/exports/mspdi`, `cronograma-${projectId}.xml`);
      setMsg({ tone: 'ok', text: 'XML gerado, validado e baixado.' });
      history.reload();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao exportar.' });
    }
  };

  const downloadTable = async (dataset: string, format: 'csv' | 'json'): Promise<void> => {
    await api.download(`/api/projects/${projectId}/exports/${dataset}.${format}`, `${dataset}-${projectId}.${format}`);
  };

  const importXml = async (file: File): Promise<void> => {
    const form = new FormData();
    form.append('file', file, file.name);
    try {
      const r = await api.upload<Record<string, unknown>>(`/api/projects/${projectId}/imports/mspdi`, form);
      setImportResult(r);
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Falha ao importar.' });
    }
  };

  const v = validation.data;

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Relatorios e exportacoes</h1>
      </div>

      {msg && <Notice tone={msg.tone === 'ok' ? 'ok' : 'danger'}>{msg.text}</Notice>}

      <AsyncBoundary loading={validation.loading} error={validation.error}>
        {v && (
          <Card
            title="XML do Microsoft Project 2016 (MSPDI)"
            actions={
              <button className="primary" disabled={!v.downloadable} onClick={() => void downloadXml()}>
                Baixar XML
              </button>
            }
          >
            <Notice tone={v.downloadable ? 'ok' : 'danger'} title={v.downloadable ? 'Arquivo aprovado na validacao' : 'Arquivo REPROVADO — nao sera entregue'}>
              {v.downloadable
                ? 'O XML foi gerado, relido do zero e validado: IDs, UIDs, vinculos, datas, duracoes e codificacao.'
                : 'Corrija os erros abaixo. Entregar um XML que abre incompleto no Project e pior que nao entregar.'}
            </Notice>

            {v.notCalculable.length > 0 && (
              <Notice tone="warn" title={`${v.notCalculable.length} atividade(s) sem duracao calculavel`}>
                {v.note} Atividades afetadas: {v.notCalculable.join(', ')}.
              </Notice>
            )}

            <div className="grid grid--4">
              <div className="kpi"><div className="kpi__label">Tarefas</div><div className="kpi__value">{v.modelValidation.counts.tasks}</div></div>
              <div className="kpi"><div className="kpi__label">Vinculos</div><div className="kpi__value">{v.modelValidation.counts.links}</div></div>
              <div className="kpi"><div className="kpi__label">Recursos</div><div className="kpi__value">{v.modelValidation.counts.resources}</div></div>
              <div className="kpi"><div className="kpi__label">Tamanho</div><div className="kpi__value">{fmtInt(Math.round(v.byteLength / 1024))} <span className="small">KB</span></div></div>
            </div>

            {[...v.modelValidation.findings, ...v.xmlValidation.findings].length > 0 && (
              <>
                <div className="small muted" style={{ margin: '10px 0 4px' }}>Relatorio de validacao:</div>
                <table className="data">
                  <thead><tr><th>Severidade</th><th>Codigo</th><th>Mensagem</th></tr></thead>
                  <tbody>
                    {[...v.modelValidation.findings, ...v.xmlValidation.findings].map((f, i) => (
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
              </>
            )}
          </Card>
        )}
      </AsyncBoundary>

      <Card title="Exportacoes tabulares">
        <p className="small muted" style={{ marginTop: 0 }}>
          Cada linha carrega fonte, revisao, confianca e status de validacao. O CSV sai com separador
          ";" e BOM, formato que o Excel em portugues abre sem reconfigurar.
        </p>
        <table className="data">
          <thead><tr><th>Conjunto</th><th>Formatos</th></tr></thead>
          <tbody>
            {DATASETS.map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                <td>
                  <button className="sm" onClick={() => void downloadTable(key, 'csv')}>CSV</button>{' '}
                  <button className="sm" onClick={() => void downloadTable(key, 'json')}>JSON</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Importar XML existente para auditoria">
        <p className="small muted" style={{ marginTop: 0 }}>
          A importacao NAO altera o cronograma. Ela valida o arquivo e produz a comparacao com o plano atual.
        </p>
        <input
          type="file" accept=".xml"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importXml(f); }}
        />
        {importResult && (
          <div style={{ marginTop: 10 }}>
            <Notice tone="info" title="Comparacao concluida">
              {String((importResult['note'] as string) ?? '')}
            </Notice>
            <div className="evidence" style={{ maxHeight: 260, overflow: 'auto' }}>
              {JSON.stringify(importResult['comparison'], null, 2)}
            </div>
          </div>
        )}
      </Card>

      <AsyncBoundary loading={history.loading} error={history.error} empty={!history.data?.length}
                     emptyTitle="Nenhuma exportacao registrada">
        <Card title={`Historico de exportacoes (${history.data?.length ?? 0})`} flush>
          <table className="data">
            <thead><tr><th>Data</th><th>Formato</th><th className="right">Tamanho</th><th>Chave</th></tr></thead>
            <tbody>
              {history.data?.map((e) => (
                <tr key={e.id}>
                  <td className="small nowrap">{fmtDateTime(e.createdAt)}</td>
                  <td>{e.format}</td>
                  <td className="num">{fmtInt(Math.round(e.byteSize / 1024))} KB</td>
                  <td className="mono small">{e.storageKey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </AsyncBoundary>
    </>
  );
}
