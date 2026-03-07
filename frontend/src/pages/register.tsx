import React, { useState } from "react";
import type { FormEvent } from "react";
import { register } from "../api/auth";

const GitHubIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
  </svg>
);

const ShieldIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="m9 12 2 2 4-4"/>
  </svg>
);

const NameIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);

const UserIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
);

const EnvelopeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="4" width="20" height="16" rx="2"/>
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
  </svg>
);

const LockIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
  </svg>
);

const ArrowRightIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

const SkillPulseLogo = () => (
  <svg width="32" height="28" viewBox="0 0 36 32" fill="none">
    <rect x="0" y="8" width="4" height="16" rx="2" fill="#6366f1"/>
    <rect x="6" y="4" width="4" height="24" rx="2" fill="#6366f1"/>
    <rect x="12" y="0" width="4" height="32" rx="2" fill="#6366f1"/>
    <rect x="18" y="4" width="4" height="24" rx="2" fill="#818cf8"/>
    <rect x="24" y="8" width="4" height="16" rx="2" fill="#a5b4fc"/>
    <rect x="30" y="12" width="4" height="8" rx="2" fill="#c7d2fe"/>
  </svg>
);

const roles = [
  { value: 'developer', label: 'Developer', desc: 'Personal growth & analysis' },
  { value: 'manager',   label: 'Engineering Manager', desc: 'Team intelligence & evaluation' },
  { value: 'recruiter', label: 'Technical Recruiter', desc: 'Candidate screening & insights' },
];

const Register: React.FC = () => {
  const [form, setForm] = useState({ username: '', full_name: '', work_email: '', role: '', password: '', confirm_password: '' });
  const [focused, setFocused] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Show error from redirect (e.g. already_registered)
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'already_registered') {
      setError('This GitHub account is already registered. Please sign in instead.');
    }
  }, []);

  const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

  const handleGitHubLogin = async () => {
    setError(null);
    setGithubLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
      const res = await fetch(`${apiUrl}/auth/github?action=register`);
      if (!res.ok) throw new Error("Server error");
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error("No redirect URL received");
      }
    } catch (err: any) {
      setError("GitHub login failed. Please try again.");
      setGithubLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirm_password) { setError("Passwords don't match."); return; }
    if (!form.role) { setError("Please select an account type."); return; }
    if (form.password.length < 8) { setError("Password must be at least 8 characters."); return; }
    setLoading(true);
    try {
      await register({ username: form.username, full_name: form.full_name, work_email: form.work_email, role: form.role, password: form.password });
      setSuccess(true);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        .reg-page { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(160deg, #eef0f9 0%, #f5f6fb 50%, #ece8f8 100%); font-family: 'DM Sans', sans-serif; padding: 24px; }
        .success-card { background: white; border-radius: 24px; padding: 56px 48px; text-align: center; max-width: 440px; width: 100%; box-shadow: 0 8px 32px rgba(99,102,241,0.08); animation: popIn 0.4s cubic-bezier(0.22,1,0.36,1) both; }
        @keyframes popIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .success-icon { width: 64px; height: 64px; background: #f0fdf4; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; }
        .success-title { font-size: 22px; font-weight: 700; color: #111827; margin-bottom: 8px; }
        .success-sub { font-size: 14px; color: #6b7280; margin-bottom: 28px; line-height: 1.6; }
        .signin-btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #6366f1; color: white; border: none; border-radius: 12px; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.2s; }
        .signin-btn:hover { background: #4f46e5; transform: translateY(-1px); }
      `}</style>
      <div className="reg-page">
        <div className="success-card">
          <div className="success-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
            </svg>
          </div>
          <div className="success-title">Account created!</div>
          <div className="success-sub">Welcome to SkillPulse. Your account is ready.<br/>Sign in to start your skill analysis.</div>
          <button className="signin-btn" onClick={() => window.location.href = '/'}>
            Sign in now <ArrowRightIcon />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .reg-page {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: linear-gradient(160deg, #eef0f9 0%, #f5f6fb 50%, #ece8f8 100%);
          padding: 48px 16px;
          font-family: 'DM Sans', sans-serif;
          position: relative;
          overflow: hidden;
        }

        .reg-page::before {
          content: ''; position: absolute; top: -100px; right: -100px;
          width: 380px; height: 380px;
          background: radial-gradient(circle, rgba(99,102,241,0.07) 0%, transparent 70%);
          border-radius: 50%; pointer-events: none;
        }

        .reg-page::after {
          content: ''; position: absolute; bottom: -60px; left: -60px;
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(139,92,246,0.05) 0%, transparent 70%);
          border-radius: 50%; pointer-events: none;
        }

        .reg-hero {
          text-align: center;
          margin-bottom: 32px;
          position: relative; z-index: 1;
        }

        .reg-logo-row {
          display: flex; align-items: center; justify-content: center; gap: 8px;
          margin-bottom: 20px;
        }

        .reg-logo-name {
          font-size: 20px; font-weight: 700; color: #1e1b4b; letter-spacing: -0.3px;
        }

        .reg-logo-name span { color: #6366f1; }

        .reg-title {
          font-size: 32px; font-weight: 700; color: #111827;
          letter-spacing: -0.6px; margin-bottom: 10px;
        }

        .reg-subtitle {
          font-size: 15px; color: #6b7280; line-height: 1.6; max-width: 360px; margin: 0 auto;
        }

        .reg-card {
          width: 100%; max-width: 520px;
          background: #ffffff;
          border-radius: 24px;
          padding: 36px 40px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(99,102,241,0.08);
          border: 1px solid rgba(255,255,255,0.8);
          position: relative; z-index: 1;
          animation: slideUp 0.5s cubic-bezier(0.22,1,0.36,1) both;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .github-btn {
          width: 100%;
          display: flex; align-items: center; justify-content: center; gap: 10px;
          padding: 14px 20px;
          background: #0f172a; color: #ffffff;
          border: none; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
          position: relative; overflow: hidden;
        }

        .github-btn::after {
          content: ''; position: absolute; inset: 0;
          background: linear-gradient(180deg, rgba(255,255,255,0.05) 0%, transparent 100%);
        }

        .github-btn:hover:not(:disabled) { background: #1e293b; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(15,23,42,0.3); }
        .github-btn:active:not(:disabled) { transform: translateY(0); }
        .github-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .secure-badge {
          display: flex; align-items: center; justify-content: center; gap: 5px;
          margin-top: 10px;
          font-size: 11px; font-weight: 600; color: #9ca3af;
          letter-spacing: 0.8px; text-transform: uppercase;
        }

        .divider {
          display: flex; align-items: center; gap: 12px;
          margin: 22px 0;
        }

        .divider-line { flex: 1; height: 1px; background: #e5e7eb; }

        .divider-text {
          font-size: 11px; font-weight: 600; color: #9ca3af;
          letter-spacing: 1.2px; text-transform: uppercase;
        }

        .form { display: flex; flex-direction: column; gap: 16px; }

        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

        .field { display: flex; flex-direction: column; gap: 6px; }

        .field-label { font-size: 13.5px; font-weight: 600; color: #374151; }

        .input-wrap {
          display: flex; align-items: center; gap: 10px;
          padding: 0 14px; height: 48px;
          background: #f9fafb; border: 1.5px solid #e5e7eb;
          border-radius: 10px; transition: all 0.2s;
        }

        .input-wrap.focused {
          border-color: #6366f1; background: #fafafe;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.08);
        }

        .input-icon { color: #9ca3af; flex-shrink: 0; display: flex; align-items: center; }
        .input-wrap.focused .input-icon { color: #6366f1; }

        .input-field {
          flex: 1; border: none; background: transparent; outline: none;
          font-family: 'DM Sans', sans-serif; font-size: 14px; color: #111827;
        }

        .input-field::placeholder { color: #c4c7ce; }

        .role-group { display: flex; flex-direction: column; gap: 8px; }

        .role-option {
          display: flex; align-items: center; gap: 12px;
          padding: 14px 16px;
          background: #f9fafb; border: 1.5px solid #e5e7eb;
          border-radius: 12px; cursor: pointer;
          transition: all 0.2s;
        }

        .role-option:hover { border-color: #c7d2fe; background: #fafafe; }

        .role-option.selected {
          border-color: #6366f1; background: #eef2ff;
        }

        .role-radio {
          width: 16px; height: 16px; border-radius: 50%;
          border: 2px solid #d1d5db; background: white;
          flex-shrink: 0; transition: all 0.2s;
          display: flex; align-items: center; justify-content: center;
        }

        .role-option.selected .role-radio {
          border-color: #6366f1; background: #6366f1;
        }

        .role-option.selected .role-radio::after {
          content: ''; width: 6px; height: 6px;
          border-radius: 50%; background: white;
        }

        .role-info { flex: 1; }
        .role-label { font-size: 14px; font-weight: 600; color: #111827; }
        .role-desc { font-size: 12px; color: #6b7280; margin-top: 1px; }

        .error-msg {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px;
          background: #fef2f2; border: 1px solid #fecaca;
          border-radius: 8px; font-size: 13px; color: #dc2626; font-weight: 500;
          animation: fadeIn 0.2s ease;
        }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

        .create-btn {
          width: 100%; height: 52px;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          background: #6366f1; color: white;
          border: none; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
          margin-top: 4px;
        }

        .create-btn:hover:not(:disabled) { background: #4f46e5; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(99,102,241,0.35); }
        .create-btn:active:not(:disabled) { transform: translateY(0); }
        .create-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .spinner {
          width: 16px; height: 16px;
          border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
          border-radius: 50%; animation: spin 0.7s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        .footer-text {
          text-align: center; margin-top: 24px;
          font-size: 14px; color: #6b7280;
          position: relative; z-index: 1;
        }

        .footer-text a { color: #6366f1; font-weight: 700; text-decoration: none; }
        .footer-text a:hover { color: #4f46e5; }

        .copyright {
          text-align: center; margin-top: 32px;
          font-size: 12px; color: #9ca3af;
          position: relative; z-index: 1;
        }

        @media (max-width: 520px) {
          .reg-card { padding: 28px 20px; }
          .form-row { grid-template-columns: 1fr; }
          .reg-title { font-size: 26px; }
        }
      `}</style>

      <div className="reg-page">
        <div className="reg-hero">
          <div className="reg-logo-row">
            <SkillPulseLogo />
            <span className="reg-logo-name"><span>Skill</span>Pulse</span>
          </div>
          <h1 className="reg-title">Create your account</h1>
          <p className="reg-subtitle">Join the next generation of developer evaluation and growth tracking.</p>
        </div>

        <div className="reg-card">
          <button
            className="github-btn"
            type="button"
            disabled={githubLoading}
            onClick={handleGitHubLogin}
          >
            {githubLoading ? (
              <><div className="spinner" /> Redirecting to GitHub...</>
            ) : (
              <><GitHubIcon /> Recommended: Join with GitHub</>
            )}
          </button>
          <div className="secure-badge">
            <ShieldIcon /> Secure OAuth 2.0 Verification
          </div>

          <div className="divider">
            <div className="divider-line" />
            <span className="divider-text">or use email</span>
            <div className="divider-line" />
          </div>

          <form className="form" onSubmit={handleSubmit}>
            <div className="form-row">
              <div className="field">
                <label className="field-label">Full Name</label>
                <div className={`input-wrap ${focused === 'full_name' ? 'focused' : ''}`}>
                  <span className="input-icon"><NameIcon /></span>
                  <input className="input-field" type="text" placeholder="Jane Doe"
                    value={form.full_name}
                    onChange={e => update('full_name', e.target.value)}
                    onFocus={() => setFocused('full_name')}
                    onBlur={() => setFocused(null)}
                    required />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Username</label>
                <div className={`input-wrap ${focused === 'username' ? 'focused' : ''}`}>
                  <span className="input-icon"><UserIcon /></span>
                  <input className="input-field" type="text" placeholder="jane_doe"
                    value={form.username}
                    onChange={e => update('username', e.target.value)}
                    onFocus={() => setFocused('username')}
                    onBlur={() => setFocused(null)}
                    required />
                </div>
              </div>
            </div>

            <div className="field">
              <label className="field-label">Work Email</label>
              <div className={`input-wrap ${focused === 'work_email' ? 'focused' : ''}`}>
                <span className="input-icon"><EnvelopeIcon /></span>
                <input className="input-field" type="email" placeholder="jane@company.com"
                  value={form.work_email}
                  onChange={e => update('work_email', e.target.value)}
                  onFocus={() => setFocused('work_email')}
                  onBlur={() => setFocused(null)}
                  required />
              </div>
            </div>

            <div className="form-row">
              <div className="field">
                <label className="field-label">Password</label>
                <div className={`input-wrap ${focused === 'password' ? 'focused' : ''}`}>
                  <span className="input-icon"><LockIcon /></span>
                  <input className="input-field" type="password" placeholder="At least 8 characters"
                    value={form.password}
                    onChange={e => update('password', e.target.value)}
                    onFocus={() => setFocused('password')}
                    onBlur={() => setFocused(null)}
                    required />
                </div>
              </div>

              <div className="field">
                <label className="field-label">Confirm Password</label>
                <div className={`input-wrap ${focused === 'confirm' ? 'focused' : ''}`}>
                  <span className="input-icon"><LockIcon /></span>
                  <input className="input-field" type="password" placeholder="Repeat password"
                    value={form.confirm_password}
                    onChange={e => update('confirm_password', e.target.value)}
                    onFocus={() => setFocused('confirm')}
                    onBlur={() => setFocused(null)}
                    required />
                </div>
              </div>
            </div>

            <div className="field">
              <label className="field-label">Account Type</label>
              <div className="role-group">
                {roles.map(r => (
                  <div
                    key={r.value}
                    className={`role-option ${form.role === r.value ? 'selected' : ''}`}
                    onClick={() => update('role', r.value)}
                  >
                    <div className="role-radio" />
                    <div className="role-info">
                      <div className="role-label">{r.label}</div>
                      <div className="role-desc">{r.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="error-msg">
                <span>⚠</span> {error}
              </div>
            )}

            <button className="create-btn" type="submit" disabled={loading}>
              {loading
                ? <><div className="spinner" /> Creating account...</>
                : <>Create Account <ArrowRightIcon /></>
              }
            </button>
          </form>
        </div>

        <p className="footer-text">
          Already have an account? <a href="/" onClick={e => { e.preventDefault(); window.location.href = '/'; }}>Sign in instead</a>
        </p>

        <p className="copyright">© 2026 SkillPulse. Privacy focused, data driven.</p>
      </div>
    </>
  );
};

export default Register;
