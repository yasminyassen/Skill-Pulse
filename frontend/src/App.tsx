import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/register';
import GitHubCallback from './pages/GitHubCallback';
import RoleSelection from './pages/RoleSelection';
import NotFound from './pages/NotFound';
import RepositoryAnalysis from "./pages/RepositoryAnalysis";

// Dashboard placeholders — replace these with real pages as you build them
import DeveloperDashboard from './pages/Dashboard/DeveloperDashboard';
import ManagerDashboard from './pages/Dashboard/ManagerDashboard';
import RecruiterDashboard from './pages/Dashboard/RecruiterDashboard';
import DeveloperSkills from './pages/Dashboard/DeveloperSkills';

function App() {
  return (
    <Router>
      <Routes>
        {/* ── Auth pages ── */}
        <Route path="/" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/github/callback" element={<GitHubCallback />} />
        <Route path="/select-role" element={<RoleSelection />} />

        {/* ── Developer routes ── */}
        {/* First page shown after login → analysis page */}
        <Route path="/dashboard/developer" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/developer/analysis" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/developer/skills" element={<DeveloperSkills />} />
        {/* Future pages — each will get its own component */}
        <Route path="/dashboard/developer/security" element={<DeveloperDashboard />} />
        <Route path="/dashboard/developer/requirements" element={<DeveloperDashboard />} />
        <Route path="/dashboard/developer/learning" element={<DeveloperDashboard />} />
        <Route path="/dashboard/developer/profile" element={<DeveloperDashboard />} />

        {/* ── Manager routes ── */}
        <Route path="/dashboard/manager" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/manager/analysis" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/manager/security" element={<ManagerDashboard />} />
        <Route path="/dashboard/manager/requirements" element={<ManagerDashboard />} />
        <Route path="/dashboard/manager/profile" element={<ManagerDashboard />} />
        <Route path="/dashboard/manager/team" element={<ManagerDashboard />} />

        {/* ── Recruiter routes ── */}
        <Route path="/dashboard/recruiter" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/recruiter/analysis" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/recruiter/profile" element={<RecruiterDashboard />} />
        <Route path="/dashboard/recruiter/candidates" element={<RecruiterDashboard />} />

        {/* ── Fallback ── */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;
