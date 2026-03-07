import React, { useState } from "react";
import type { FormEvent } from "react";
import { login, whoami } from '../api/auth';

const GitHubIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/>
    <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
    <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

const SkillPulseLogo = () => (
  <svg width="36" height="32" viewBox="0 0 36 32" fill="none">
    <rect x="0" y="8" width="4" height="16" rx="2" fill="#6366f1"/>
    <rect x="6" y="4" width="4" height="24" rx="2" fill="#6366f1"/>
    <rect x="12" y="0" width="4" height="32" rx="2" fill="#6366f1"/>
    <rect x="18" y="4" width="4" height="24" rx="2" fill="#818cf8"/>
    <rect x="24" y="8" width="4" height="16" rx="2" fill="#a5b4fc"/>
    <rect x="30" y="12" width="4" height="8" rx="2" fill="#c7d2fe"/>
  </svg>
);

const Login: React.FC = () => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Show error from redirect (e.g. not_registered)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'not_registered') {
      setError('This GitHub account is not registered. Please create an account first.');
    }
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await login({ username, password });

      if (response.access_token) {
        localStorage.setItem('token', response.access_token);
      }

      const user = await whoami();
      setSuccess(`✓ Welcome back, ${user.username}! Redirecting...`);

      setTimeout(() => {
        if (user.role === 'developer')  window.location.href = '/dashboard/developer';
        else if (user.role === 'manager')   window.location.href = '/dashboard/manager';
        else if (user.role === 'recruiter') window.location.href = '/dashboard/recruiter';
        else window.location.href = '/dashboard';
      }, 800);

    } catch (err: any) {
      const serverMsg = err?.response?.data?.detail;
      setError(serverMsg ?? 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh;
        }

        .page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(160deg, #eef0f9 0%, #f5f6fb 50%, #ece8f8 100%);
          padding: 24px 16px;
          position: relative;
          overflow: hidden;
        }

        .page::before {
          content: '';
          position: absolute;
          top: -120px; right: -120px;
          width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none;
        }

        .page::after {
          content: '';
          position: absolute;
          bottom: -80px; left: -80px;
          width: 320px; height: 320px;
          background: radial-gradient(circle, rgba(139,92,246,0.06) 0%, transparent 70%);
          border-radius: 50%;
          pointer-events: none;
        }

        .topbar {
          position: absolute;
          top: 0; left: 0; right: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 20px 32px;
          border-bottom: 1px solid rgba(99,102,241,0.08);
        }

        .topbar-brand {
          font-size: 18px;
          font-weight: 700;
          color: #1e1b4b;
          letter-spacing: -0.3px;
        }

        .topbar-brand span { color: #6366f1; }

        .topbar-divider {
          width: 1px; height: 16px;
          background: #d1d5db;
        }

        .topbar-tagline {
          font-size: 13px;
          color: #6b7280;
          font-weight: 400;
        }

        .card {
          width: 100%;
          max-width: 440px;
          background: #ffffff;
          border-radius: 20px;
          padding: 44px 40px;
          box-shadow:
            0 1px 3px rgba(0,0,0,0.04),
            0 8px 32px rgba(99,102,241,0.08),
            0 2px 8px rgba(0,0,0,0.04);
          border: 1px solid rgba(255,255,255,0.8);
          position: relative;
          z-index: 1;
          animation: slideUp 0.5s cubic-bezier(0.22,1,0.36,1) both;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .card-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .welcome-title {
          font-size: 26px;
          font-weight: 700;
          color: #111827;
          letter-spacing: -0.5px;
          margin-bottom: 6px;
        }

        .welcome-sub {
          font-size: 14px;
          color: #6b7280;
        }

        .github-btn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 14px 20px;
          background: #0f172a;
          color: #ffffff;
          border: none;
          border-radius: 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          position: relative;
          overflow: hidden;
        }

        .github-btn::after {
          content: '';
          position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%);
        }

        .github-btn:hover {
          background: #1e293b;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(15,23,42,0.3);
        }

        .github-btn:active { transform: translateY(0); }

        .github-btn-arrow { margin-left: auto; opacity: 0.5; }

        .divider {
          display: flex;
          align-items: center;
          gap: 12px;
          margin: 24px 0;
        }

        .divider-line {
          flex: 1; height: 1px;
          background: #e5e7eb;
        }

        .divider-text {
          font-size: 11px;
          font-weight: 600;
          color: #9ca3af;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          font-family: 'DM Mono', monospace;
        }

        .form {
          display: flex;
          flex-direction: column;
          gap: 18px;
        }

        .field {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .field-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .field-label {
          font-size: 13.5px;
          font-weight: 600;
          color: #374151;
        }

        .forgot-link {
          font-size: 13px;
          font-weight: 500;
          color: #6366f1;
          text-decoration: none;
          transition: color 0.15s;
        }

        .forgot-link:hover { color: #4f46e5; }

        .input-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 0 14px;
          height: 48px;
          background: #f9fafb;
          border: 1.5px solid #e5e7eb;
          border-radius: 10px;
          transition: all 0.2s ease;
        }

        .input-wrap.focused {
          border-color: #6366f1;
          background: #fafafe;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.08);
        }

        .input-icon {
          color: #9ca3af;
          flex-shrink: 0;
          display: flex;
          align-items: center;
        }

        .input-wrap.focused .input-icon { color: #6366f1; }

        .input-field {
          flex: 1;
          border: none;
          background: transparent;
          outline: none;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          color: #111827;
        }

        .input-field::placeholder { color: #c4c7ce; }

        .error-msg {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 8px;
          font-size: 13px;
          color: #dc2626;
          font-weight: 500;
          animation: fadeIn 0.2s ease;
        }

        .success-msg {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 14px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          border-radius: 8px;
          font-size: 13px;
          color: #16a34a;
          font-weight: 500;
          animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .submit-btn {
          width: 100%;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: #ffffff;
          color: #1e1b4b;
          border: 1.5px solid #e5e7eb;
          border-radius: 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          margin-top: 4px;
        }

        .submit-btn:hover:not(:disabled) {
          border-color: #6366f1;
          color: #6366f1;
          background: #fafafe;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(99,102,241,0.12);
        }

        .submit-btn:active:not(:disabled) { transform: translateY(0); }

        .submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .spinner {
          width: 16px; height: 16px;
          border: 2px solid #e5e7eb;
          border-top-color: #6366f1;
          border-radius: 50%;
          animation: spin 0.7s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .footer-text {
          text-align: center;
          margin-top: 24px;
          font-size: 13.5px;
          color: #6b7280;
        }

        .footer-text a {
          color: #6366f1;
          font-weight: 600;
          text-decoration: none;
          transition: color 0.15s;
        }

        .footer-text a:hover { color: #4f46e5; }
      `}</style>

      <div className="page">
        <div className="topbar">
          <SkillPulseLogo />
          <span className="topbar-brand"><span>Skill</span>Pulse</span>
          <div className="topbar-divider" />
          <span className="topbar-tagline">The AI-Powered Developer Intelligence Platform</span>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="welcome-title">Welcome back</h2>
            <p className="welcome-sub">Sign in to continue your skill analysis</p>
          </div>

          <button className="github-btn" type="button" onClick={async () => {
            const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/github?action=login`);
            const data = await res.json();
            window.location.href = data.url;
          }}>
            <GitHubIcon />
            Continue with GitHub
            <span className="github-btn-arrow"><ArrowRightIcon /></span>
          </button>

          <div className="divider">
            <div className="divider-line" />
            <span className="divider-text">or username access</span>
            <div className="divider-line" />
          </div>

          <form className="form" onSubmit={handleSubmit}>
            <div className="field">
              <label className="field-label">Username</label>
              <div className={`input-wrap ${usernameFocused ? 'focused' : ''}`}>
                <span className="input-icon"><UserIcon /></span>
                <input
                  className="input-field"
                  type="text"
                  placeholder="your_username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onFocus={() => setUsernameFocused(true)}
                  onBlur={() => setUsernameFocused(false)}
                  required
                />
              </div>
            </div>

            <div className="field">
              <div className="field-header">
                <label className="field-label">Password</label>
                <a href="#" className="forgot-link" onClick={e => e.preventDefault()}>Forgot password?</a>
              </div>
              <div className={`input-wrap ${passwordFocused ? 'focused' : ''}`}>
                <span className="input-icon"><LockIcon /></span>
                <input
                  className="input-field"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  required
                />
              </div>
            </div>

            {error && (
              <div className="error-msg">
                <span>⚠</span> {error}
              </div>
            )}

            {success && (
              <div className="success-msg">
                {success}
              </div>
            )}

            <button className="submit-btn" type="submit" disabled={loading}>
              {loading ? <><div className="spinner" /> Signing in...</> : 'Sign in'}
            </button>
          </form>

          <p className="footer-text">
            Don't have an account?{' '}
            <a href="/register" onClick={e => { e.preventDefault(); window.location.href = '/register'; }}>Create your profile</a>
          </p>
        </div>
      </div>
    </>
  );
};

export default Login;
