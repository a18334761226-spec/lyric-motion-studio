import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from './Layout';
import { Dashboard } from './pages/Dashboard';
import { NewProject } from './pages/NewProject';
import { Library } from './pages/Library';
import { PromptLab } from './pages/PromptLab';
import { Settings } from './pages/Settings';
import { Workspace } from './pages/Workspace';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/new" element={<NewProject />} />
        <Route path="/library" element={<Library />} />
        <Route path="/prompt" element={<PromptLab />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/projects/:id" element={<Workspace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
