import type { FormEvent } from "react";
import React, { useState } from "react";
import { register } from "../api/auth";

const Register: React.FC = () => {
  const [form, setForm] = useState({ username: '', full_name: '', work_email: '', role: '', password: '', confirm_password: '' });
  const [focused, setFocused] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [githubLoading, setGithubLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get('error');
    if (err === 'already_registered') {
      setError('This GitHub account is already registered. Please sign in instead.');
    }
  }, []);

  const update = (field: string, value: string) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleGitHubLogin = () => {
    setError(null);
    setGithubLoading(true);
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8000";
    window.location.href = `${apiUrl}/auth/github?action=register`;
  };
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (form.username.length < 3) {
      setError("Username must be at least 3 characters.");
      return;
    }

    if (form.full_name.trim().length < 3) {
      setError("Please enter a valid full name.");
      return;
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!passwordRegex.test(form.password)) {
      setError("Password must be 8+ characters, include uppercase, lowercase, a number and a special character.");
      return;
    }

    if (form.password !== form.confirm_password) {
      setError("Passwords do not match.");
      return;
    }

    if (!form.role) {
      setError("Please select your primary role.");
      return;
    }

    setLoading(true);
    try {
      await register({
        username: form.username,
        full_name: form.full_name,
        work_email: form.work_email,
        role: form.role,
        password: form.password,
      });
      setSuccess(true);
    } catch (err: unknown) {
      const axiosError = err as {
        response?: {
          data?: {
            detail?: string | Array<{ msg: string }>
          }
        }
      };

      const detail = axiosError.response?.data?.detail;

      if (Array.isArray(detail)) {
        setError(detail[0].msg);
      } else if (typeof detail === 'string') {
        setError(detail);
      } else {
        setError('Registration failed. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────
  if (success) return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0c1a; }
        .sp-success-page {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: #0f0c1a; font-family: 'DM Sans', sans-serif; padding: 24px;
          position: relative; overflow: hidden;
        }
        .sp-orb {
          position: fixed; border-radius: 50%;
          background: radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 65%);
          width: 700px; height: 700px; top: -200px; left: -150px; pointer-events: none;
        }
        .sp-grid {
          position: fixed; inset: 0;
          background-image: linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px);
          background-size: 48px 48px; pointer-events: none;
        }
        .sp-success-card {
          background: rgba(255,255,255,0.04); border: 1px solid rgba(167,139,250,0.15);
          border-radius: 24px; padding: 56px 48px; text-align: center;
          max-width: 420px; width: 100%; position: relative; z-index: 2;
          animation: popIn 0.4s cubic-bezier(0.22,1,0.36,1) both;
          backdrop-filter: blur(20px);
        }
        @keyframes popIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
        .sp-success-icon {
          width: 64px; height: 64px; background: rgba(167,139,250,0.1);
          border-radius: 50%; display: flex; align-items: center; justify-content: center;
          margin: 0 auto 20px; border: 1px solid rgba(167,139,250,0.2);
        }
        .sp-success-title { font-family: 'Syne', sans-serif; font-size: 24px; font-weight: 800; color: white; margin-bottom: 8px; letter-spacing: -0.5px; }
        .sp-success-sub { font-size: 14px; color: rgba(196,181,253,0.5); margin-bottom: 28px; line-height: 1.7; }
        .sp-signin-btn {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 13px 28px;
          background: linear-gradient(135deg, #7c3aed, #a855f7);
          color: white; border: none; border-radius: 13px;
          font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
          box-shadow: 0 6px 20px rgba(124,58,237,0.3);
        }
        .sp-signin-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(124,58,237,0.4); }
      `}</style>
      <div className="sp-success-page">
        <div className="sp-orb" />
        <div className="sp-grid" />
        <div className="sp-success-card">
          <div className="sp-success-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
            </svg>
          </div>
          <div className="sp-success-title">Account created!</div>
          <div className="sp-success-sub">Welcome to SkillPulse.<br/>Sign in to start your skill analysis.</div>
          <button className="sp-signin-btn" onClick={() => window.location.href = '/login'}>
            Sign in now
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
        </div>
      </div>
    </>
  );

  // ── Main register page ──────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0c1a; overflow: hidden; }

        /* ── Layout ── */
        .sp-reg { font-family: 'DM Sans', sans-serif; background: #0f0c1a; min-height: 100vh; display: flex; overflow: hidden; position: relative; }

        /* Orbs */
        .sp-orb1 { position: fixed; border-radius: 50%; z-index: 0; width: 700px; height: 700px; background: radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 65%); top: -200px; left: -150px; animation: spDrift1 9s ease-in-out infinite alternate; }
        .sp-orb2 { position: fixed; border-radius: 50%; z-index: 0; width: 500px; height: 500px; background: radial-gradient(circle, rgba(244,114,182,0.14) 0%, transparent 65%); bottom: -120px; right: 380px; animation: spDrift2 12s ease-in-out infinite alternate; }
        .sp-orb3 { position: fixed; border-radius: 50%; z-index: 0; width: 320px; height: 320px; background: radial-gradient(circle, rgba(103,232,249,0.1) 0%, transparent 65%); top: 35%; right: -60px; animation: spDrift1 7s ease-in-out infinite alternate-reverse; }
        @keyframes spDrift1 { from{transform:translate(0,0) scale(1)} to{transform:translate(40px,30px) scale(1.08)} }
        @keyframes spDrift2 { from{transform:translate(0,0)} to{transform:translate(-30px,-20px) scale(1.1)} }

        /* Grid */
        .sp-grid { position: fixed; inset: 0; z-index: 1; background-image: linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px); background-size: 48px 48px; pointer-events: none; }

        /* Two-column layout */
        .sp-layout { position: relative; z-index: 2; display: grid; grid-template-columns: 1fr 560px; width: 100%; height: 100vh; overflow: hidden; }

        /* ── LEFT ── */
        .sp-left { display: flex; flex-direction: column; justify-content: space-between; padding: 36px 52px; overflow: hidden; }

        /* Logo */
        .sp-logo { display: flex; align-items: center; gap: 10px; }
        .sp-logo-bars { display: flex; gap: 3px; align-items: flex-end; }
        .sp-logo-bars span { display: block; width: 4px; border-radius: 2px; }
        .sp-logo-name { font-family: 'Syne', sans-serif; font-size: 19px; font-weight: 800; color: white; letter-spacing: -0.3px; }
        .sp-logo-name em { font-style: normal; color: #c4b5fd; }

        /* Hero */
        .sp-hero { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 20px 0; }
        .sp-eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 5px 14px; background: rgba(167,139,250,0.1); border: 1px solid rgba(167,139,250,0.22); border-radius: 100px; font-size: 10px; font-weight: 700; color: #c4b5fd; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 16px; width: fit-content; }
        .sp-pulse-dot { width: 6px; height: 6px; border-radius: 50%; background: #f472b6; animation: spBlink 2s ease infinite; }
        @keyframes spBlink { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(0.65)} }
        .sp-hero-title { font-family: 'Syne', sans-serif; font-size: 42px; font-weight: 800; color: white; line-height: 1.08; letter-spacing: -2px; margin-bottom: 12px; }
        .sp-grad { background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9, #a78bfa, #c4b5fd); background-size: 300%; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: spGrad 5s ease infinite; }
        @keyframes spGrad { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
        .sp-hero-sub { font-size: 13.5px; color: rgba(196,181,253,0.5); line-height: 1.65; max-width: 380px; font-weight: 300; margin-bottom: 0; }

        /* Feature cards */
        .sp-features { display: flex; flex-direction: column; gap: 8px; margin: 18px 0 0 0; }
        .sp-feat { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: rgba(167,139,250,0.05); border: 1px solid rgba(167,139,250,0.1); border-radius: 12px; transition: all 0.2s; }
        .sp-feat:hover { background: rgba(167,139,250,0.09); border-color: rgba(167,139,250,0.2); }
        .sp-feat-icon { width: 32px; height: 32px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .sp-feat-label { font-size: 12.5px; font-weight: 700; color: rgba(233,213,255,0.8); margin-bottom: 1px; letter-spacing: -0.2px; }
        .sp-feat-desc { font-size: 11px; color: rgba(167,139,250,0.4); font-weight: 300; line-height: 1.4; }

        /* Quote */
        .sp-quote-wrap { position: relative; margin-top: 20px; }
        .sp-quote-mark { font-family: 'Syne', sans-serif; font-size: 90px; font-weight: 800; line-height: 0.7; background: linear-gradient(135deg, #c4b5fd, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; opacity: 0.35; position: absolute; top: -12px; left: -6px; pointer-events: none; animation: spGrad 5s ease infinite; background-size: 300%; }
        .sp-quote-inner { padding: 20px 22px 18px 22px; background: rgba(167,139,250,0.07); border: 1px solid rgba(167,139,250,0.15); border-radius: 18px; position: relative; overflow: hidden; }
        .sp-quote-inner::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: linear-gradient(180deg, #c4b5fd, #f472b6, #67e8f9); border-radius: 3px; }
        .sp-quote-inner::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(196,181,253,0.05) 0%, transparent 60%); pointer-events: none; }
        .sp-quote-text { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; color: white; line-height: 1.25; letter-spacing: -0.8px; margin-bottom: 8px; position: relative; z-index: 1; }
        .sp-quote-story { color: #c4b5fd; -webkit-text-fill-color: #c4b5fd; }
        .sp-quote-sub { font-size: 12px; color: rgba(196,181,253,0.45); font-weight: 300; line-height: 1.6; position: relative; z-index: 1; }

        /* Pills hidden */
        .sp-pills { display: none; }

        /* ── RIGHT ── */
        .sp-right { display: flex; align-items: center; justify-content: center; padding: 24px 36px; border-left: 1px solid rgba(167,139,250,0.1); background: rgba(255,255,255,0.022); backdrop-filter: blur(28px); height: 100vh; overflow: hidden; }
        .sp-card { width: 100%; }

        /* Card head */
        .sp-card-head { margin-bottom: 16px; height: 70px; display: flex; flex-direction: column; justify-content: flex-start; }
        .sp-card-title { font-family: 'Syne', sans-serif; font-size: 22px; font-weight: 800; color: white; letter-spacing: -0.8px; margin-bottom: 4px; line-height: 1.2; }
        .sp-card-sub { font-size: 12px; color: rgba(196,181,253,0.45); font-weight: 300; }

        /* GitHub btn */
        .sp-gh-btn { width: 100%; height: 50px; display: flex; align-items: center; justify-content: center; gap: 10px; background: linear-gradient(135deg, #7c3aed, #a855f7, #ec4899); background-size: 200%; border: none; border-radius: 14px; font-family: 'DM Sans', sans-serif; font-size: 15px; font-weight: 600; color: white; cursor: pointer; transition: all 0.3s; box-shadow: 0 6px 22px rgba(124,58,237,0.3); margin-bottom: 8px; position: relative; overflow: hidden; }
        .sp-gh-btn::after { content: ''; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent 60%); }
        .sp-gh-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 10px 30px rgba(168,85,247,0.4); }
        .sp-gh-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .sp-secure { display: flex; align-items: center; justify-content: center; gap: 5px; margin-bottom: 12px; font-size: 10px; font-weight: 600; color: rgba(167,139,250,0.4); letter-spacing: 0.5px; }

        /* Divider */
        .sp-divider { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
        .sp-div-line { flex: 1; height: 1px; background: rgba(167,139,250,0.1); }
        .sp-div-txt { font-size: 10px; color: rgba(167,139,250,0.35); font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; }

        /* Fields */
        .sp-form { display: flex; flex-direction: column; gap: 8px; }
        .sp-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .sp-field { display: flex; flex-direction: column; gap: 4px; }
        .sp-field-label { font-size: 10px; font-weight: 700; color: rgba(196,181,253,0.45); letter-spacing: 0.6px; text-transform: uppercase; }
        .sp-input-wrap { display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 40px; background: rgba(167,139,250,0.07); border: 1.5px solid rgba(167,139,250,0.14); border-radius: 11px; transition: all 0.25s; }
        .sp-input-wrap.focused { border-color: rgba(196,181,253,0.45); background: rgba(167,139,250,0.11); box-shadow: 0 0 0 3px rgba(167,139,250,0.09); }
        .sp-input-field { flex: 1; border: none; background: transparent !important; outline: none; font-family: 'DM Sans', sans-serif; font-size: 13px; color: white; -webkit-autofill: none; }
        .sp-input-field:-webkit-autofill,
        .sp-input-field:-webkit-autofill:hover,
        .sp-input-field:-webkit-autofill:focus { -webkit-box-shadow: 0 0 0px 1000px rgba(30,20,51,0.95) inset !important; -webkit-text-fill-color: white !important; transition: background-color 5000s ease-in-out 0s; }
        .sp-input-icon { color: rgba(167,139,250,0.4); flex-shrink: 0; display: flex; align-items: center; transition: color 0.2s; }
        .sp-input-wrap.focused .sp-input-icon { color: #c4b5fd; }
        .sp-input-field::placeholder { color: rgba(167,139,250,0.28); }

        /* Role options */
        .sp-role-group { display: flex; flex-direction: column; gap: 5px; }
        .sp-role-option { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: rgba(167,139,250,0.04); border: 1.5px solid rgba(167,139,250,0.1); border-radius: 10px; cursor: pointer; transition: all 0.2s; }
        .sp-role-option:hover { border-color: rgba(196,181,253,0.25); background: rgba(167,139,250,0.08); }
        .sp-role-option.selected { border-color: rgba(196,181,253,0.4); background: rgba(167,139,250,0.12); }
        .sp-role-radio { width: 14px; height: 14px; border-radius: 50%; border: 2px solid rgba(167,139,250,0.3); flex-shrink: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
        .sp-role-option.selected .sp-role-radio { border-color: #c4b5fd; background: #c4b5fd; }
        .sp-role-option.selected .sp-role-radio::after { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #1e1433; }
        .sp-role-label { font-size: 12px; font-weight: 600; color: rgba(233,213,255,0.8); }
        .sp-role-desc { font-size: 10px; color: rgba(167,139,250,0.45); margin-top: 1px; }

        /* Error */
        .sp-error-wrap { height: 36px; margin-top: 2px; }
        .sp-error { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: rgba(244,114,182,0.08); border: 1px solid rgba(244,114,182,0.2); border-radius: 9px; font-size: 11px; color: #f472b6; font-weight: 500; animation: spFade 0.2s ease; height: 100%; }
        @keyframes spFade { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }

        /* Submit */
        .sp-submit { width: 100%; height: 46px; margin-top: 2px; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9); background-size: 300%; border: none; border-radius: 13px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; color: #1e1433; cursor: pointer; transition: all 0.3s; box-shadow: 0 5px 18px rgba(196,181,253,0.2); animation: spGrad 4s ease infinite; }
        .sp-submit:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(244,114,182,0.3); }
        .sp-submit:disabled { opacity: 0.6; cursor: not-allowed; }

        /* Spinner */
        .sp-spinner { width: 15px; height: 15px; border: 2px solid rgba(30,20,51,0.3); border-top-color: #1e1433; border-radius: 50%; animation: spSpin 0.7s linear infinite; }
        @keyframes spSpin { to{transform:rotate(360deg)} }

        /* Sign in */
        .sp-signin { text-align: center; margin-top: 10px; font-size: 12px; color: rgba(167,139,250,0.45); }
        .sp-signin a { color: #c4b5fd; font-weight: 600; text-decoration: none; }
        .sp-signin a:hover { color: #f472b6; }

        /* Password bars */
        .sp-pwd-toggle { background: none; border: none; padding: 0; cursor: pointer; color: rgba(167,139,250,0.4); display: flex; align-items: center; transition: color 0.2s; outline: none; }
        .sp-pwd-toggle:hover { color: #c4b5fd; }

      `}</style>

      <div className="sp-reg">
        <div className="sp-orb1" />
        <div className="sp-orb2" />
        <div className="sp-orb3" />
        <div className="sp-grid" />

        <div className="sp-layout">

          {/* ── LEFT ── */}
          <div className="sp-left">
            <div className="sp-logo">
              <div className="sp-logo-bars">
                <span style={{height:'10px',background:'#7c3aed'}} />
                <span style={{height:'16px',background:'#a855f7'}} />
                <span style={{height:'24px',background:'#c4b5fd'}} />
                <span style={{height:'18px',background:'#f472b6'}} />
                <span style={{height:'12px',background:'#e879f9',opacity:0.7}} />
                <span style={{height:'7px',background:'#c4b5fd',opacity:0.4}} />
              </div>
              <span className="sp-logo-name"><em>Skill</em>Pulse</span>
            </div>

            <div className="sp-hero">
              <div className="sp-eyebrow">
                <div className="sp-pulse-dot" />
                Developer Intelligence Platform
              </div>
              <h1 className="sp-hero-title">
                Measure your<br/>
                <span className="sp-grad">coding mastery.</span>
              </h1>
              <p className="sp-hero-sub">
                Connect your GitHub and get AI-powered insights into your code quality, security awareness, and skill trajectory.
              </p>

              {/* Feature highlights */}
              <div className="sp-features">
                <div className="sp-feat">
                  <div className="sp-feat-icon" style={{background:'rgba(196,181,253,0.12)'}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c4b5fd" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                    </svg>
                  </div>
                  <div>
                    <div className="sp-feat-label">Deep Code Understanding</div>
                    <div className="sp-feat-desc">Go beyond syntax — uncover the story your code tells</div>
                  </div>
                </div>
                <div className="sp-feat">
                  <div className="sp-feat-icon" style={{background:'rgba(244,114,182,0.12)'}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f472b6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                    </svg>
                  </div>
                  <div>
                    <div className="sp-feat-label">Instant Actionable Insights</div>
                    <div className="sp-feat-desc">Know exactly where to grow — no guesswork needed</div>
                  </div>
                </div>
                <div className="sp-feat">
                  <div className="sp-feat-icon" style={{background:'rgba(103,232,249,0.12)'}}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#67e8f9" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                    </svg>
                  </div>
                  <div>
                    <div className="sp-feat-label">Built for Every Role</div>
                    <div className="sp-feat-desc">Developers, managers, and recruiters — one platform</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="sp-quote-wrap">
              <div className="sp-quote-mark">"</div>
              <div className="sp-quote-inner">
                <div className="sp-quote-text">
                  Your code tells<br/>a <span className="sp-quote-story">story.</span>
                </div>
                <div className="sp-quote-sub">
                  SkillPulse reads between the lines —<br/>turning commits into career intelligence.
                </div>
              </div>
            </div>

            <div className="sp-pills">
              <div className="sp-pill">
                <div className="sp-pill-dot" style={{background:'linear-gradient(135deg,#c4b5fd,#a78bfa)'}} />
                <div>
                  <div className="sp-pill-text">Code Quality Analysis</div>
                  <div className="sp-pill-sub">Cyclomatic complexity · Maintainability index</div>
                </div>
              </div>
              <div className="sp-pill">
                <div className="sp-pill-dot" style={{background:'linear-gradient(135deg,#f472b6,#e879f9)'}} />
                <div>
                  <div className="sp-pill-text">Security Insights</div>
                  <div className="sp-pill-sub">OWASP · Vulnerability detection</div>
                </div>
              </div>
              <div className="sp-pill">
                <div className="sp-pill-dot" style={{background:'linear-gradient(135deg,#67e8f9,#a5f3fc)'}} />
                <div>
                  <div className="sp-pill-text">Skill Progression</div>
                  <div className="sp-pill-sub">Track your growth over time</div>
                </div>
              </div>
            </div>
          </div>

          {/* ── RIGHT ── */}
          <div className="sp-right">
            <div className="sp-card">

              <div className="sp-card-head">
                <div className="sp-card-title">
                  Start your<br/><span style={{color:'#c4b5fd'}}>dev journey.</span>
                </div>
                <div className="sp-card-sub">Join thousands of developers leveling up their craft.</div>
              </div>

              <button
                className="sp-gh-btn"
                type="button"
                disabled={githubLoading}
                onClick={handleGitHubLogin}
              >
                {githubLoading ? (
                  <><div className="sp-spinner" /> Redirecting to GitHub...</>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                    </svg>
                    Continue with GitHub
                  </>
                )}
              </button>

              <div className="sp-secure">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  <path d="m9 12 2 2 4-4"/>
                </svg>
                Secure OAuth 2.0
              </div>

              <div className="sp-divider">
                <div className="sp-div-line" />
                <span className="sp-div-txt">or register with email</span>
                <div className="sp-div-line" />
              </div>

              <form className="sp-form" onSubmit={handleSubmit}>

                <div className="sp-row2">
                  <div className="sp-field">
                    <label className="sp-field-label">Full Name</label>
                    <div className={`sp-input-wrap ${focused === 'full_name' ? 'focused' : ''}`}>
                      <span className="sp-input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                      </span>
                      <input className="sp-input-field" type="text" placeholder="Your full name"
                        value={form.full_name}
                        onChange={e => update('full_name', e.target.value)}
                        onFocus={() => setFocused('full_name')}
                        onBlur={() => setFocused(null)}
                        required />
                    </div>
                  </div>
                  <div className="sp-field">
                    <label className="sp-field-label">Username</label>
                    <div className={`sp-input-wrap ${focused === 'username' ? 'focused' : ''}`}>
                      <span className="sp-input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                      </span>
                      <input className="sp-input-field" type="text" placeholder="Choose a username"
                        value={form.username}
                        onChange={e => update('username', e.target.value)}
                        onFocus={() => setFocused('username')}
                        onBlur={() => setFocused(null)}
                        required />
                    </div>
                  </div>
                </div>

                <div className="sp-field">
                  <label className="sp-field-label">Work Email</label>
                  <div className={`sp-input-wrap ${focused === 'work_email' ? 'focused' : ''}`}>
                    <span className="sp-input-icon">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    </span>
                    <input className="sp-input-field" type="email" placeholder="you@company.com"
                      value={form.work_email}
                      onChange={e => update('work_email', e.target.value)}
                      onFocus={() => setFocused('work_email')}
                      onBlur={() => setFocused(null)}
                      required />
                  </div>
                </div>

                <div className="sp-row2">
                  <div className="sp-field">
                    <label className="sp-field-label">Password</label>
                    <div className={`sp-input-wrap ${focused === 'password' ? 'focused' : ''}`}>
                      <span className="sp-input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </span>
                      <input className="sp-input-field" 
                        type={showPassword ? "text" : "password"} 
                        placeholder="••••••••"
                        value={form.password}
                        onChange={e => update('password', e.target.value)}
                        onFocus={() => setFocused('password')}
                        onBlur={() => setFocused(null)}
                        required 
                      />
                      <button type="button" className="sp-pwd-toggle" onClick={() => setShowPassword(!showPassword)}>
                        {showPassword ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="sp-field">
                    <label className="sp-field-label">Confirm Password</label>
                    <div className={`sp-input-wrap ${focused === 'confirm' ? 'focused' : ''}`}>
                      <span className="sp-input-icon">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </span>
                      <input className="sp-input-field" 
                        type={showConfirm ? "text" : "password"} 
                        placeholder="Repeat password"
                        value={form.confirm_password}
                        onChange={e => update('confirm_password', e.target.value)}
                        onFocus={() => setFocused('confirm')}
                        onBlur={() => setFocused(null)}
                        required 
                      />
                      <button type="button" className="sp-pwd-toggle" onClick={() => setShowConfirm(!showConfirm)}>
                        {showConfirm ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="sp-field">
                  <label className="sp-field-label">Account Type</label>
                  <div className="sp-role-group">
                    {[
                      { value: 'developer', label: 'Developer', desc: 'Personal growth & analysis' },
                      { value: 'manager',   label: 'Engineering Manager', desc: 'Team intelligence & evaluation' },
                      { value: 'recruiter', label: 'Technical Recruiter', desc: 'Candidate screening & insights' },
                    ].map(r => (
                      <div
                        key={r.value}
                        className={`sp-role-option ${form.role === r.value ? 'selected' : ''}`}
                        onClick={() => update('role', r.value)}
                      >
                        <div className="sp-role-radio" />
                        <div>
                          <div className="sp-role-label">{r.label}</div>
                          <div className="sp-role-desc">{r.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="sp-error-wrap">
                  {error && (
                    <div className="sp-error">
                      <span>⚠</span> {error}
                    </div>
                  )}
                </div>

                <button className="sp-submit" type="submit" disabled={loading}>
                  {loading ? (
                    <><div className="sp-spinner" /> Creating account...</>
                  ) : (
                    <>Create Account ✦</>
                  )}
                </button>
              </form>

              <div className="sp-signin">
                Already have an account? <a href="/" onClick={e => { e.preventDefault(); window.location.href = '/login'; }}>Sign in</a>
              </div>

            </div>
          </div>

        </div>
      </div>
    </>
  );
};

export default Register;
