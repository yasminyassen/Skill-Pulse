import { Route, BrowserRouter as Router, Routes } from 'react-router-dom';
import GitHubCallback from './pages/GitHubCallback';
import Login from './pages/Login';
import NotFound from './pages/NotFound';
import Register from './pages/register';
import RepositoryAnalysis from "./pages/RepositoryAnalysis";
import RoleSelection from './pages/RoleSelection';


import DeveloperProfile from './pages/Dashboard/DeveloperDashboard';
import CandidateEvaluation from './pages/Dashboard/CandidateEvaluation';
import DeveloperLearning from './pages/Dashboard/DeveloperLearning';
import DeveloperSecurity from './pages/Dashboard/DeveloperSecurity';
import DeveloperSkills from './pages/Dashboard/DeveloperSkills';
import ManagerDashboard from './pages/Dashboard/ManagerDashboard';
import RecruiterDashboard from './pages/Dashboard/RecruiterDashboard';

import AccountSettings from './pages/Dashboard/AccountSettings';
import ConnectedRepositories from './pages/Dashboard/ConnectedRepositories';


// ── Analysis detail page (View button destination) ───────────────────────────
// Uses the same RepositoryAnalysis page but can be extended to a dedicated
// detail view later. The :analysisId param is passed via the URL so the
// page can scroll-to / highlight the matching run.
import AnalysisDetail from './pages/AnalysisDetail';


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
        <Route path="/dashboard/developer" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/developer/analysis" element={<RepositoryAnalysis />} />

        {/* ── Analysis detail — /analysis/:analysisId ── */}
        <Route path="/analysis/:analysisId" element={<AnalysisDetail />} />

        <Route path="/dashboard/developer/skills" element={<DeveloperSkills />} />
        <Route path="/dashboard/developer/security" element={<DeveloperSecurity />} />
        <Route path="/dashboard/developer/learning" element={<DeveloperLearning />} />
        <Route path="/dashboard/developer/profile" element={<DeveloperProfile />} />

        <Route path="/settings/account" element={<AccountSettings />} />
        <Route path="/settings/repositories" element={<ConnectedRepositories />} />
        

        {/* ── Manager routes ── */}
        <Route path="/dashboard/manager" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/manager/analysis" element={<RepositoryAnalysis />} />
        <Route path="/dashboard/manager/security" element={<ManagerDashboard />} />
        <Route path="/dashboard/manager/requirements" element={<ManagerDashboard />} />
        <Route path="/dashboard/manager/profile" element={<ManagerDashboard />} />
        <Route path="/dashboard/manager/team" element={<ManagerDashboard />} />

        {/* ── Recruiter routes ── */}
        <Route path="/dashboard/recruiter" element={<RecruiterDashboard />} />
        <Route path="/dashboard/recruiter/analysis" element={<RecruiterDashboard />} />
        <Route path="/dashboard/recruiter/profile" element={<RecruiterDashboard />} />
        <Route path="/dashboard/recruiter/candidates" element={<CandidateEvaluation />} />

        {/* ── Fallback ── */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;