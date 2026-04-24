import React, { useEffect, useState } from "react";

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

    localStorage.setItem('token', token);
    setStatus('success');
    setMessage('Signed in successfully! Redirecting...');

    setTimeout(async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/whoami-full`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const user = await res.json();
        localStorage.setItem("role", user.role);
        localStorage.setItem("full_name", user.full_name || user.username || "User");

        if (user.role === 'developer') window.location.href = '/dashboard/developer';
        else if (user.role === 'manager') window.location.href = '/dashboard/manager';
        else if (user.role === 'recruiter') window.location.href = '/dashboard/recruiter';
        else window.location.href = '/select-role';
      } catch {
        window.location.href = '/select-role';
      }
    }, 1000);
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0c1a; }

        .cb-page {
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #0f0c1a;
          font-family: 'DM Sans', sans-serif;
          position: relative; overflow: hidden;
        }

        /* Orbs */
        .cb-orb1 { position: fixed; border-radius: 50%; pointer-events: none;
          width: 700px; height: 700px;
          background: radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 65%);
          top: -200px; left: -150px; animation: cbDrift1 9s ease-in-out infinite alternate; }
        .cb-orb2 { position: fixed; border-radius: 50%; pointer-events: none;
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(244,114,182,0.12) 0%, transparent 65%);
          bottom: -120px; right: -100px; animation: cbDrift2 12s ease-in-out infinite alternate; }
        @keyframes cbDrift1 { from{transform:translate(0,0)} to{transform:translate(40px,30px) scale(1.08)} }
        @keyframes cbDrift2 { from{transform:translate(0,0)} to{transform:translate(-30px,-20px) scale(1.1)} }

        /* Grid */
        .cb-grid {
          position: fixed; inset: 0; pointer-events: none;
          background-image:
            linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px);
          background-size: 48px 48px;
        }

        /* Card */
        .cb-card {
          position: relative; z-index: 2;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(167,139,250,0.15);
          border-radius: 24px; padding: 48px 44px;
          text-align: center; max-width: 400px; width: 100%;
          backdrop-filter: blur(28px);
          animation: cbPop 0.45s cubic-bezier(0.22,1,0.36,1);
        }
        @keyframes cbPop { from { opacity:0; transform:scale(0.94) translateY(12px); } to { opacity:1; transform:scale(1) translateY(0); } }

        /* Logo */
        .cb-logo { display: flex; align-items: center; justify-content: center; gap: 9px; margin-bottom: 32px; }
        .cb-logo-bars { display: flex; gap: 3px; align-items: flex-end; }
        .cb-logo-bars span { display: block; width: 4px; border-radius: 2px; }
        .cb-brand { font-family: 'Syne', sans-serif; font-size: 18px; font-weight: 800; color: white; letter-spacing: -0.3px; }
        .cb-brand em { font-style: normal; color: #c4b5fd; }

        /* Status icon */
        .cb-icon {
          width: 64px; height: 64px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px;
          border: 1px solid;
        }
        .cb-icon.loading {
          background: rgba(167,139,250,0.1);
          border-color: rgba(167,139,250,0.2);
          animation: cbPulse 1.4s ease infinite;
        }
        .cb-icon.success {
          background: rgba(52,211,153,0.1);
          border-color: rgba(52,211,153,0.2);
        }
        .cb-icon.error {
          background: rgba(244,114,182,0.1);
          border-color: rgba(244,114,182,0.2);
        }
        @keyframes cbPulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.95)} }

        /* Spinner for loading */
        .cb-spinner {
          width: 24px; height: 24px;
          border: 2.5px solid rgba(196,181,253,0.2);
          border-top-color: #c4b5fd;
          border-radius: 50%;
          animation: cbSpin 0.8s linear infinite;
        }
        @keyframes cbSpin { to { transform: rotate(360deg); } }

        /* Title */
        .cb-title {
          font-family: 'Syne', sans-serif;
          font-size: 20px; font-weight: 800;
          color: white; letter-spacing: -0.5px;
          margin-bottom: 8px;
        }

        /* Message */
        .cb-msg { font-size: 13.5px; color: rgba(196,181,253,0.5); line-height: 1.6; }

        /* Progress bar for loading */
        .cb-progress {
          margin-top: 24px; height: 3px;
          background: rgba(167,139,250,0.1);
          border-radius: 2px; overflow: hidden;
        }
        .cb-progress-fill {
          height: 100%; border-radius: 2px;
          background: linear-gradient(90deg, #c4b5fd, #f472b6, #67e8f9);
          background-size: 200%;
          animation: cbProgress 1.5s ease-in-out infinite, cbGrad 2s linear infinite;
          width: 60%;
        }
        @keyframes cbProgress {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(250%); }
        }
        @keyframes cbGrad {
          from { background-position: 0%; }
          to   { background-position: 200%; }
        }

        /* Retry btn */
        .cb-retry {
          margin-top: 24px; padding: 12px 28px;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          color: white; border: none; border-radius: 13px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
          box-shadow: 0 6px 20px rgba(124,58,237,0.3);
        }
        .cb-retry:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(124,58,237,0.4); }
      `}</style>

      <div className="cb-page">
        <div className="cb-orb1" />
        <div className="cb-orb2" />
        <div className="cb-grid" />

        <div className="cb-card">

          {/* Logo */}
          <div className="cb-logo">
            <div className="cb-logo-bars">
              <span style={{height:'10px',background:'#7c3aed'}} />
              <span style={{height:'16px',background:'#a855f7'}} />
              <span style={{height:'24px',background:'#c4b5fd'}} />
              <span style={{height:'18px',background:'#f472b6'}} />
              <span style={{height:'12px',background:'#e879f9',opacity:0.7}} />
              <span style={{height:'7px',background:'#c4b5fd',opacity:0.4}} />
            </div>
            <span className="cb-brand"><em>Skill</em>Pulse</span>
          </div>

          {/* Icon */}
          <div className={`cb-icon ${status}`}>
            {status === 'loading' && <div className="cb-spinner" />}
            {status === 'success' && (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
              </svg>
            )}
            {status === 'error' && (
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>
              </svg>
            )}
          </div>

          {/* Title */}
          <div className="cb-title">
            {status === 'loading' && 'Signing you in...'}
            {status === 'success' && 'Welcome to SkillPulse!'}
            {status === 'error' && 'Something went wrong'}
          </div>

          {/* Message */}
          <div className="cb-msg">{message}</div>

          {/* Loading progress bar */}
          {status === 'loading' && (
            <div className="cb-progress">
              <div className="cb-progress-fill" />
            </div>
          )}

          {/* Error retry */}
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
