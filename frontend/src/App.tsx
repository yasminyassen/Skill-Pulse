import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/register';
import GitHubCallback from './pages/GitHubCallback';
import RoleSelection from './pages/RoleSelection';
function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />
      <Route path="/auth/github/callback" element={<GitHubCallback />} />
      <Route path="/select-role" element={<RoleSelection />} />
      </Routes>
    </Router>
  );
}

export default App;