import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/register';
import GitHubCallback from './pages/GitHubCallback';
import RoleSelection from './pages/RoleSelection';
import NotFound from './pages/NotFound';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Register />} />
        <Route path="/login" element={<Login />} />
        <Route path="/auth/github/callback" element={<GitHubCallback />} />
        <Route path="/select-role" element={<RoleSelection />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Router>
  );
}

export default App;
