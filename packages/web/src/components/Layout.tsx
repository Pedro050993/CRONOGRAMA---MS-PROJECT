import { useEffect, useState } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { api, setToken } from '../lib/api';
import { useApi, useProjectEvents } from '../lib/hooks';
import type { Project } from '../lib/types';

/** Menu principal de §15, na ordem exata do documento de requisitos. */
const MENU = [
  { to: '', label: '2. Visao geral', end: true },
  { to: 'documentos', label: '3. Documentos' },
  { to: 'processamento', label: '4. Processamento' },
  { to: 'validacao', label: '5. Validacao' },
  { to: 'escopo', label: '6. Escopo e quantitativos' },
  { to: 'eap', label: '7. EAP e AWP' },
  { to: 'mapas', label: '8. Mapas de controle' },
  { to: 'sequenciamento', label: '9. Sequenciamento' },
  { to: 'cronograma', label: '10. Cronograma e Gantt' },
  { to: 'restricoes', label: '11. Restricoes e prontidao' },
  { to: 'riscos', label: '12. Riscos e inconsistencias' },
  { to: 'premissas', label: '13. Premissas e decisoes' },
  { to: 'exportacoes', label: '14. Relatorios e exportacoes' },
  { to: 'auditoria', label: '15. Administracao e auditoria' },
];

export function Layout(): JSX.Element {
  const { projectId } = useParams();
  const { data: project } = useApi<Project>(projectId ? `/api/projects/${projectId}` : null);
  const { data: me } = useApi<{ user: { name: string; email: string } }>('/api/auth/me');
  const [lastEvent, setLastEvent] = useState<string | null>(null);

  const { connected } = useProjectEvents(projectId, (e) => {
    setLastEvent(`${e.kind} — ${new Date(e.at).toLocaleTimeString('pt-BR')}`);
  });

  useEffect(() => {
    document.title = project ? `${project.name} — Cronograma` : 'Cronograma';
  }, [project]);

  const logout = (): void => { setToken(null); location.href = '/login'; };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <strong>CRONOGRAMA</strong>
          <span>Planejamento de obras industriais</span>
        </div>

        <div className="sidebar__project">
          {project ? (
            <>
              <b>{project.name}</b>
              {project.client ?? 'Cliente nao informado'}
              {project.myRole && <div className="small" style={{ marginTop: 3 }}>Seu papel: {project.myRole}</div>}
            </>
          ) : (
            <b>Nenhum projeto selecionado</b>
          )}
        </div>

        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            1. Portfolio
          </NavLink>
          {projectId && MENU.map((m) => (
            <NavLink
              key={m.label}
              to={m.to ? `/p/${projectId}/${m.to}` : `/p/${projectId}`}
              end={m.end}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {m.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          {me?.user.name ?? '—'}
          <br />
          {projectId && (
            <span title={lastEvent ?? 'Nenhum evento recebido ainda.'}>
              {connected ? '● sincronizado' : '○ reconectando'}
            </span>
          )}
          <br />
          <button className="sm" style={{ marginTop: 6 }} onClick={logout}>Sair</button>
        </div>
      </aside>

      <div className="main">
        {project?.isDemo && (
          <div className="demo-banner">
            DEMONSTRACAO — os dados deste projeto sao ficticios e identificados como teste. Nao use para decisao real.
          </div>
        )}
        <div className="content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
