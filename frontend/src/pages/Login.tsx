import type { FormEvent } from "react";
import React, { useState } from "react";
import { login } from '../api/auth';
import api from '../api/auth';

const Login: React.FC = () => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [usernameFocused, setUsernameFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

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
      const userRes = await api.get("/auth/whoami-full");
      const user = userRes.data;
      localStorage.setItem("role", user.role);
      localStorage.setItem("full_name", user.full_name || user.username || "User");
      setSuccess(`Welcome back, ${user.full_name || user.username}!`);
      setTimeout(() => {
        if (user.role === 'developer')       window.location.href = '/dashboard/developer';
        else if (user.role === 'manager')    window.location.href = '/dashboard/manager';
        else if (user.role === 'recruiter')  window.location.href = '/dashboard/recruiter';
        else window.location.href = '/dashboard';
      }, 800);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0c1a; overflow: hidden; }

        .lg-page {
          font-family: 'DM Sans', sans-serif;
          background: #0f0c1a;
          min-height: 100vh; display: flex; overflow: hidden; position: relative;
        }

        /* Orbs */
        .lg-orb1 { position: fixed; border-radius: 50%; z-index: 0; width: 700px; height: 700px; background: radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 65%); top: -200px; left: -150px; animation: lgDrift1 9s ease-in-out infinite alternate; }
        .lg-orb2 { position: fixed; border-radius: 50%; z-index: 0; width: 500px; height: 500px; background: radial-gradient(circle, rgba(244,114,182,0.14) 0%, transparent 65%); bottom: -120px; right: -100px; animation: lgDrift2 12s ease-in-out infinite alternate; }
        .lg-orb3 { position: fixed; border-radius: 50%; z-index: 0; width: 320px; height: 320px; background: radial-gradient(circle, rgba(103,232,249,0.1) 0%, transparent 65%); top: 30%; right: 30%; animation: lgDrift1 7s ease-in-out infinite alternate-reverse; }
        @keyframes lgDrift1 { from{transform:translate(0,0) scale(1)} to{transform:translate(40px,30px) scale(1.08)} }
        @keyframes lgDrift2 { from{transform:translate(0,0)} to{transform:translate(-30px,-20px) scale(1.1)} }

        /* Grid */
        .lg-grid { position: fixed; inset: 0; z-index: 1; background-image: linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px); background-size: 48px 48px; pointer-events: none; }

        /* Two-column layout */
        .lg-layout { position: relative; z-index: 2; display: grid; grid-template-columns: 1fr 500px; width: 100%; height: 100vh; }

        /* ── LEFT ── */
        .lg-left { display: flex; flex-direction: column; justify-content: space-between; padding: 48px 64px; overflow: hidden; }

        .lg-logo { display: flex; align-items: center; gap: 10px; }
        .lg-logo-bars { display: flex; gap: 3px; align-items: flex-end; }
        .lg-logo-bars span { display: block; width: 4px; border-radius: 2px; }
        .lg-logo-name { font-family: 'Syne', sans-serif; font-size: 19px; font-weight: 800; color: white; letter-spacing: -0.3px; }
        .lg-logo-name em { font-style: normal; color: #c4b5fd; }

        .lg-hero { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 20px 0; }
        .lg-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 5px 14px; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.22); border-radius: 100px; font-size: 10px; font-weight: 700; color: #c4b5fd; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 20px; width: fit-content; }
        .lg-pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: #f472b6; animation: lgBlink 2s ease infinite; }
        @keyframes lgBlink { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.65)} }

        .lg-hero-title { font-family: 'Syne', sans-serif; font-size: 46px; font-weight: 800; color: white; line-height: 1.08; letter-spacing: -2px; margin-bottom: 14px; }
        .lg-grad { background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9, #a78bfa, #c4b5fd); background-size: 300%; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: lgGrad 5s ease infinite; }
        @keyframes lgGrad { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }

        .lg-hero-sub { font-size: 14px; color: rgba(196,181,253,0.5); line-height: 1.7; max-width: 380px; font-weight: 300; }

        /* Quote */
        .lg-quote-wrap { position: relative; margin-top: 0; }
        .lg-quote-mark { font-family: 'Syne', sans-serif; font-size: 90px; font-weight: 800; line-height: 0.7; background: linear-gradient(135deg, #c4b5fd, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; opacity: 0.35; position: absolute; top: -12px; left: -6px; pointer-events: none; animation: lgGrad 5s ease infinite; background-size: 300%; }
        .lg-quote-inner { padding: 22px 22px 18px 22px; background: rgba(167,139,250,0.07); border: 1px solid rgba(167,139,250,0.15); border-radius: 18px; position: relative; overflow: hidden; }
        .lg-quote-inner::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, #c4b5fd, #f472b6, #67e8f9); border-radius: 3px; }
        .lg-quote-inner::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(196,181,253,0.05) 0%, transparent 60%); pointer-events: none; }
        .lg-quote-text { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; color: white; line-height: 1.25; letter-spacing: -0.8px; margin-bottom: 8px; position: relative; z-index: 1; }
        .lg-quote-story { background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9); background-size: 300%; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: lgGrad 4s ease infinite; }
        .lg-quote-sub { font-size: 12px; color: rgba(196,181,253,0.45); font-weight: 300; line-height: 1.6; position: relative; z-index: 1; }

        /* ── RIGHT ── */
        .lg-right { display: flex; align-items: center; justify-content: center; padding: 40px 48px; border-left: 1px solid rgba(167,139,250,0.1); background: rgba(255,255,255,0.022); backdrop-filter: blur(28px); height: 100vh; }
        .lg-card { width: 100%; }

        /* Card head */
        .lg-card-head { margin-bottom: 28px; }
        .lg-card-title { font-family: 'Syne', sans-serif; font-size: 26px; font-weight: 800; color: white; letter-spacing: -0.8px; margin-bottom: 5px; line-height: 1.2; }
        .lg-card-sub { font-size: 13px; color: rgba(196,181,253,0.45); font-weight: 300; }

        /* GitHub btn */
        .lg-gh-btn { width: 100%; height: 50px; display: flex; align-items: center; justify-content: center; gap: 10px; background: linear-gradient(135deg, #7c3aed, #a855f7, #ec4899); background-size: 200%; border: none; border-radius: 14px; font-family: 'DM Sans', sans-serif; font-size: 14.5px; font-weight: 600; color: white; cursor: pointer; transition: all 0.3s; box-shadow: 0 6px 22px rgba(124,58,237,0.3); margin-bottom: 8px; position: relative; overflow: hidden; }
        .lg-gh-btn::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent 60%); }
        .lg-gh-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(168,85,247,0.4); }

        .lg-secure { display: flex; align-items: center; justify-content: center; gap: 5px; margin-bottom: 20px; font-size: 11px; font-weight: 600; color: rgba(167,139,250,0.4); letter-spacing: 0.5px; }

        /* Divider */
        .lg-divider { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
        .lg-div-line { flex: 1; height: 1px; background: rgba(167,139,250,0.1); }
        .lg-div-txt { font-size: 11px; color: rgba(167,139,250,0.35); font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; }

        /* Fields */
        .lg-form { display: flex; flex-direction: column; gap: 14px; }
        .lg-field { display: flex; flex-direction: column; gap: 5px; }
        .lg-field-header { display: flex; align-items: center; justify-content: space-between; }
        .lg-field-label { font-size: 10.5px; font-weight: 700; color: rgba(196,181,253,0.45); letter-spacing: 0.6px; text-transform: uppercase; }
        .lg-forgot { font-size: 11px; font-weight: 600; color: rgba(196,181,253,0.4); text-decoration: none; transition: color 0.15s; }
        .lg-forgot:hover { color: #c4b5fd; }

        .lg-input-wrap { display: flex; align-items: center; gap: 10px; padding: 0 14px; height: 46px; background: rgba(167,139,250,0.07); border: 1.5px solid rgba(167,139,250,0.14); border-radius: 13px; transition: all 0.25s; }
        .lg-input-wrap.focused { border-color: rgba(196,181,253,0.45); background: rgba(167,139,250,0.11); box-shadow: 0 0 0 3px rgba(167,139,250,0.09); }
        .lg-input-icon { color: rgba(167,139,250,0.4); flex-shrink: 0; display: flex; align-items: center; transition: color 0.2s; }
        .lg-input-wrap.focused .lg-input-icon { color: #c4b5fd; }
        .lg-input-field { flex: 1; border: none; background: transparent; outline: none; font-family: 'DM Sans', sans-serif; font-size: 14px; color: white; }
        .lg-input-field::placeholder { color: rgba(167,139,250,0.28); }
        .lg-pwd-toggle { background: none; border: none; padding: 0; cursor: pointer; color: rgba(167,139,250,0.4); display: flex; align-items: center; transition: color 0.2s; outline: none; }
        .lg-pwd-toggle:hover { color: #c4b5fd; }
        .lg-input-field:-webkit-autofill,
        .lg-input-field:-webkit-autofill:hover,
        .lg-input-field:-webkit-autofill:focus { -webkit-box-shadow: 0 0 0px 1000px rgba(30,20,51,0.95) inset !important; -webkit-text-fill-color: white !important; transition: background-color 5000s ease-in-out 0s; }

        /* Messages — fixed height */
        .lg-msg-wrap { height: 38px; }
        .lg-error { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(244,114,182,0.08); border: 1px solid rgba(244,114,182,0.2); border-radius: 9px; font-size: 11px; color: #f472b6; font-weight: 500; height: 100%; animation: lgFade 0.2s ease; }
        .lg-success { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2); border-radius: 9px; font-size: 11px; color: #34d399; font-weight: 500; height: 100%; animation: lgFade 0.2s ease; }
        @keyframes lgFade { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }

        /* Submit */
        .lg-submit { width: 100%; height: 50px; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9); background-size: 300%; border: none; border-radius: 14px; font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 700; color: #1e1433; cursor: pointer; transition: all 0.3s; box-shadow: 0 5px 18px rgba(196,181,253,0.2); animation: lgGrad 4s ease infinite; }
        .lg-submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(244,114,182,0.3); }
        .lg-submit:disabled { opacity: 0.6; cursor: not-allowed; }

        .lg-spinner { width: 15px; height: 15px; border: 2px solid rgba(30,20,51,0.3); border-top-color: #1e1433; border-radius: 50%; animation: lgSpin 0.7s linear infinite; }
        @keyframes lgSpin { to{transform:rotate(360deg)} }

        .lg-footer { text-align: center; margin-top: 16px; font-size: 13px; color: rgba(167,139,250,0.45); }
        .lg-footer a { color: #c4b5fd; font-weight: 600; text-decoration: none; }
        .lg-footer a:hover { color: #f472b6; }
      `}</style>

      <div className="lg-page">
        <div className="lg-orb1" />
        <div className="lg-orb2" />
        <div className="lg-orb3" />
        <div className="lg-grid" />

        <div className="lg-layout">

          {/* ── LEFT ── */}
          <div className="lg-left">
            <div className="lg-logo">
              <div className="lg-logo-bars">
                <span style={{height:'10px',background:'#7c3aed'}} />
                <span style={{height:'16px',background:'#a855f7'}} />
                <span style={{height:'24px',background:'#c4b5fd'}} />
                <span style={{height:'18px',background:'#f472b6'}} />
                <span style={{height:'12px',background:'#e879f9',opacity:0.7}} />
                <span style={{height:'7px',background:'#c4b5fd',opacity:0.4}} />
              </div>
              <span className="lg-logo-name"><em>Skill</em>Pulse</span>
            </div>

            <div className="lg-hero">
              <div className="lg-eyebrow">
                <div className="lg-pulse-dot" />
                Developer Intelligence Platform
              </div>
              <h1 className="lg-hero-title">
                Welcome<br/>
                <span className="lg-grad">back.</span>
              </h1>
              <p className="lg-hero-sub">
                Sign in and pick up right where you left off. Your code insights are waiting.
              </p>
            </div>

            <div className="lg-quote-wrap">
              <div className="lg-quote-mark">"</div>
              <div className="lg-quote-inner">
                <div className="lg-quote-text">
                  Your code tells<br/>a <span className="lg-quote-story">story.</span>
                </div>
                <div className="lg-quote-sub">
                  SkillPulse reads between the lines —<br/>turning commits into career intelligence.
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT ── */}
          <div className="lg-right">
            <div className="lg-card">

              <div className="lg-card-head">
                <div className="lg-card-title">
                  Sign in to<br/><span style={{color:'#c4b5fd'}}>your account.</span>
                </div>
                <div className="lg-card-sub">Continue your skill analysis journey.</div>
              </div>

              <button className="lg-gh-btn" type="button" onClick={() => {
                window.location.href = `${import.meta.env.VITE_API_URL}/auth/github?action=login`;
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                Continue with GitHub
              </button>

              <div className="lg-secure">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <path d="m9 12 2 2 4-4"/>
                </svg>
                Secure OAuth 2.0
              </div>

              <div className="lg-divider">
                <div className="lg-div-line" />
                <span className="lg-div-txt">or username access</span>
                <div className="lg-div-line" />
              </div>

              <form className="lg-form" onSubmit={handleSubmit}>
                <div className="lg-field">
                  <label className="lg-field-label">Username or Email</label>
                  <div className={`lg-input-wrap ${usernameFocused ? 'focused' : ''}`}>
                    <span className="lg-input-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                    </span>
                    <input className="lg-input-field" type="text" placeholder="Enter your username or email"
                      value={username}
                      onChange={e => setUsername(e.target.value)}
                      onFocus={() => setUsernameFocused(true)}
                      onBlur={() => setUsernameFocused(false)}
                      required />
                  </div>
                </div>

                <div className="lg-field">
                  <div className="lg-field-header">
                    <label className="lg-field-label">Password</label>
                    <a href="#" className="lg-forgot" onClick={e => e.preventDefault()}>Forgot password?</a>
                  </div>
                  <div className={`lg-input-wrap ${passwordFocused ? 'focused' : ''}`}>
                    <span className="lg-input-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    <input className="lg-input-field" 
                      type={showPassword ? "text" : "password"} 
                      placeholder="••••••••"
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      onFocus={() => setPasswordFocused(true)}
                      onBlur={() => setPasswordFocused(false)}
                      required 
                    />
                    
                    <button type="button" className="lg-pwd-toggle" onClick={() => setShowPassword(!showPassword)}>
                      {showPassword ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Fixed height message area */}
                <div className="lg-msg-wrap">
                  {error && <div className="lg-error"><span>⚠</span> {error}</div>}
                  {success && <div className="lg-success"><span>✓</span> {success}</div>}
                </div>

                <button className="lg-submit" type="submit" disabled={loading}>
                  {loading
                    ? <><div className="lg-spinner" /> Signing in...</>
                    : 'Sign in →'
                  }
                </button>
              </form>

              <div className="lg-footer">
                Don't have an account?{' '}
                <a href="/register" onClick={e => { e.preventDefault(); window.location.href = '/'; }}>
                  Create your profile
                </a>
              </div>

            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default Login;
