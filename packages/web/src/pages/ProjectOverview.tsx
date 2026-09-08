import { useParams } from 'react-router-dom';
import { useApi } from '../lib/hooks';
import { fmtDate, fmtNum, fmtPct } from '../lib/format';
import { AsyncBoundary, Card, Kpi, Notice } from '../components/Ui';

interface ScopeSummary {
  project: Record<string, string | null | boolean>;
  areas: string[];
  systems: string[];
  disciplines: string[];
  documents: { total: number; unclassified: number; blocked: number; failed: number };
  quantities: {
    total: number; approved: number; approvalRate: number; avgConfidence: number | null;
    byDiscipline: { discipline: string; items: number; units: string[] }[];
  };
  structure: { wbsNodes: number; activities: number };
  openIssues: { id: string; scope: string; description: string; severity: string }[];
  sourceConflicts: number;
  baseConfidence: { score: number; level: string; formula: string };
  readyToPlan: boolean;
  whatIsMissing: string[];
}

export function ProjectOverview(): JSX.Element {
  const { projectId } = useParams();
  const { data, loading, error } = useApi<ScopeSummary>(`/api/projects/${projectId}/scope-summary`);

  return (
    <>
      <div className="topbar" style={{ margin: '-16px -18px 16px', padding: '10px 18px' }}>
        <h1>Visao geral do projeto</h1>
      </div>

      <AsyncBoundary loading={loading} error={error}>
        {data && (
          <>
            <Notice
              tone={data.readyToPlan ? 'ok' : 'warn'}
              title={data.readyToPlan
                ? 'A base disponivel e suficiente para planejar'
                : 'A base ainda NAO e suficiente para planejar com seguranca'}
            >
              {data.readyToPlan
                ? 'Quantitativos validados, sem conflito aberto e sem documento bloqueado.'
                : data.whatIsMissing.join(' ')}
            </Notice>

            <div className="grid grid--4">
              <Kpi
                label="Grau de confianca da base"
                value={<span className={`sem sem--${data.baseConfidence.level === 'ALTO' ? 'GREEN' : data.baseConfidence.level === 'MEDIO' ? 'YELLOW' : 'RED'}`}>
                  {data.baseConfidence.level}
                </span>}
                hint={data.baseConfidence.formula}
              />
              <Kpi
                label="Quantitativos validados"
                value={fmtPct(data.quantities.approvalRate, 0)}
                hint={`${data.quantities.approved} de ${data.quantities.total} itens`}
              />
              <Kpi
                label="Confianca media da extracao"
                value={data.quantities.avgConfidence === null ? '—' : fmtPct(data.quantities.avgConfidence, 0)}
                hint="Media das confiancas declaradas"
              />
              <Kpi
                label="Pendencias abertas"
                value={data.openIssues.length}
                hint={`${data.sourceConflicts} conflito(s) entre fontes`}
              />
            </div>

            <div className="grid grid--2">
              <Card title="Contrato e escopo">
                <table className="data">
                  <tbody>
                    <tr><th>Cliente</th><td>{String(data.project['client'] ?? '') || <em className="muted">nao informado</em>}</td></tr>
                    <tr><th>Contrato</th><td>{String(data.project['contract'] ?? '') || <em className="muted">nao informado</em>}</td></tr>
                    <tr><th>Local</th><td>{String(data.project['site'] ?? '') || <em className="muted">nao informado</em>}</td></tr>
                    <tr><th>Escopo</th><td>{String(data.project['scopeSummary'] ?? '') || <em className="muted">nao informado</em>}</td></tr>
                    <tr><th>Definicao de "entregue"</th><td>{String(data.project['definitionOfDone'] ?? '') || <em className="muted">nao informado</em>}</td></tr>
                    <tr><th>Prazo contratual</th><td>{fmtDate(data.project['contractStart'] as string)} a {fmtDate(data.project['contractFinish'] as string)}</td></tr>
                  </tbody>
                </table>
              </Card>

              <Card title="Documentos e estrutura">
                <table className="data">
                  <tbody>
                    <tr><th>Documentos recebidos</th><td className="num">{data.documents.total}</td></tr>
                    <tr><th>Sem tipo confirmado por humano</th><td className="num">{data.documents.unclassified}</td></tr>
                    <tr><th>Bloqueados por formato</th><td className="num">{data.documents.blocked}</td></tr>
                    <tr><th>Falha no processamento</th><td className="num">{data.documents.failed}</td></tr>
                    <tr><th>Nos de EAP</th><td className="num">{data.structure.wbsNodes}</td></tr>
                    <tr><th>Atividades</th><td className="num">{data.structure.activities}</td></tr>
                  </tbody>
                </table>
              </Card>
            </div>

            <Card title="Quantitativos por disciplina">
              {data.quantities.byDiscipline.length === 0 ? (
                <p className="muted">Nenhum quantitativo extraido ainda.</p>
              ) : (
                <table className="data">
                  <thead><tr><th>Disciplina</th><th className="right">Itens</th><th>Unidades presentes</th></tr></thead>
                  <tbody>
                    {data.quantities.byDiscipline.map((d) => (
                      <tr key={d.discipline}>
                        <td>{d.discipline}</td>
                        <td className="num">{d.items}</td>
                        <td className="mono small">{d.units.join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {data.openIssues.length > 0 && (
              <Card title={`Pendencias que travam o planejamento (${data.openIssues.length})`}>
                <table className="data">
                  <thead><tr><th>Severidade</th><th>Escopo</th><th>Descricao</th></tr></thead>
                  <tbody>
                    {data.openIssues.slice(0, 25).map((i) => (
                      <tr key={i.id}>
                        <td><span className={`badge ${i.severity === 'HIGH' ? 'badge--conflict' : 'badge--pending'}`}>{i.severity}</span></td>
                        <td className="mono small">{i.scope}</td>
                        <td>{i.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </AsyncBoundary>
    </>
  );
}
