import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from './lib/api';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Portfolio } from './pages/Portfolio';
import { ProjectOverview } from './pages/ProjectOverview';
import { Documents } from './pages/Documents';
import { Processing } from './pages/Processing';
import { Validation } from './pages/Validation';
import { Scope } from './pages/Scope';
import { Wbs } from './pages/Wbs';
import { ControlMaps } from './pages/ControlMaps';
import { Sequencing } from './pages/Sequencing';
import { Schedule } from './pages/Schedule';
import { Constraints } from './pages/Constraints';
import { Risks } from './pages/Risks';
import { Assumptions } from './pages/Assumptions';
import { Exports } from './pages/Exports';
import { Audit } from './pages/Audit';

function RequireAuth({ children }: { children: JSX.Element }): JSX.Element {
  return getToken() ? children : <Navigate to="/login" replace />;
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
          <Route index element={<Portfolio />} />
          <Route path="p/:projectId" element={<ProjectOverview />} />
          <Route path="p/:projectId/documentos" element={<Documents />} />
          <Route path="p/:projectId/processamento" element={<Processing />} />
          <Route path="p/:projectId/validacao" element={<Validation />} />
          <Route path="p/:projectId/escopo" element={<Scope />} />
          <Route path="p/:projectId/eap" element={<Wbs />} />
          <Route path="p/:projectId/mapas" element={<ControlMaps />} />
          <Route path="p/:projectId/sequenciamento" element={<Sequencing />} />
          <Route path="p/:projectId/cronograma" element={<Schedule />} />
          <Route path="p/:projectId/restricoes" element={<Constraints />} />
          <Route path="p/:projectId/riscos" element={<Risks />} />
          <Route path="p/:projectId/premissas" element={<Assumptions />} />
          <Route path="p/:projectId/exportacoes" element={<Exports />} />
          <Route path="p/:projectId/auditoria" element={<Audit />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
