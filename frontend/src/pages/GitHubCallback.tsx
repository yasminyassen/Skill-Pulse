
import React, { useEffect, useState } from "react";

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

const GitHubCallback: React.FC = () => {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing GitHub sign in...');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setStatus('error');
      setMessage('GitHub login failed. No token received.');
      return;
    }

    // Save token
    localStorage.setItem('token', token);

    setStatus('success');
    setMessage('Signed in successfully! Redirecting...');

    // Always go to role selection for new GitHub users
    setTimeout(() => {
      window.location.href = '/select-role';
    }, 1000);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; }
        .cb-page {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: linear-gradient(160deg, #eef0f9 0%, #f5f6fb 50%, #ece8f8 100%);
        }
        .cb-card {
          background: white; border-radius: 20px; padding: 48px 44px;
          text-align: center; max-width: 400px; width: 100%;
          box-shadow: 0 8px 32px rgba(99,102,241,0.08);
          animation: popIn 0.4s cubic-bezier(0.22,1,0.36,1);
        }
        @keyframes popIn { from { opacity:0; transform:scale(0.95); } to { opacity:1; transform:scale(1); } }
        .cb-logo { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 28px; }
        .cb-brand { font-size: 18px; font-weight: 700; color: #1e1b4b; }
        .cb-brand span { color: #6366f1; }
        .cb-icon { width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; }
        .cb-icon.loading { background: #eef2ff; animation: pulse 1.2s ease infinite; }
        .cb-icon.success { background: #f0fdf4; }
        .cb-icon.error   { background: #fef2f2; }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
        .cb-title { font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 8px; }
        .cb-msg { font-size: 14px; color: #6b7280; }
        .cb-retry { margin-top: 20px; padding: 10px 24px; background: #6366f1; color: white; border: none; border-radius: 10px; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; }
        .cb-retry:hover { background: #4f46e5; }
      `}</style>
      <div className="cb-page">
        <div className="cb-card">
          <div className="cb-logo">
            <SkillPulseLogo />
            <span className="cb-brand"><span>Skill</span>Pulse</span>
          </div>

          <div className={`cb-icon ${status}`}>
            {status === 'loading' && (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            )}
            {status === 'success' && (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
              </svg>
            )}
            {status === 'error' && (
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>
              </svg>
            )}
          </div>

          <div className="cb-title">
            {status === 'loading' && 'Signing you in...'}
            {status === 'success' && 'Welcome to SkillPulse!'}
            {status === 'error' && 'Something went wrong'}
          </div>
          <div className="cb-msg">{message}</div>

          {status === 'error' && (
            <button className="cb-retry" onClick={() => window.location.href = '/'}>
              Back to Login
            </button>
          )}
        </div>
      </div>
    </>
  );
};

export default GitHubCallback;