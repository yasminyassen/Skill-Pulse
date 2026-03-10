import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/auth";

const roles = [
  {
    value: "developer",
    label: "Developer",
    desc: "Analyze your repositories and map your growth journey.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
  {
    value: "manager",
    label: "Engineering Manager",
    desc: "Evaluate team strengths and identify technical gaps.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
      </svg>
    ),
  },
  {
    value: "recruiter",
    label: "Recruiter / Hiring",
    desc: "Screen candidates with objective data-driven insights.",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
    ),
  },
];

const RoleSelection: React.FC = () => {
  const [selected, setSelected] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{username: string; full_name: string; work_email: string; avatar_url?: string} | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/auth/whoami-full").then(res => {
      setUser(res.data);
    }).catch(() => {});
  }, []);

  const handleContinue = async () => {
    if (!selected) { setError("Please select a role to continue."); return; }
    setError(null);
    setLoading(true);
    try {
      await api.patch("/auth/role", { role: selected });
      if (selected === "manager")        navigate("/dashboard/manager");
      else if (selected === "recruiter") navigate("/dashboard/recruiter");
      else                               navigate("/dashboard/developer");
    } catch {
      setError("Failed to save your role. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0f0c1a; }

        .rs-page {
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: #0f0c1a; padding: 40px 16px;
          position: relative; overflow: hidden;
        }

        /* Orbs */
        .rs-orb1 { position: fixed; border-radius: 50%; pointer-events: none; z-index: 0;
          width: 700px; height: 700px;
          background: radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 65%);
          top: -200px; left: -150px; animation: rsDrift1 9s ease-in-out infinite alternate; }
        .rs-orb2 { position: fixed; border-radius: 50%; pointer-events: none; z-index: 0;
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(244,114,182,0.12) 0%, transparent 65%);
          bottom: -120px; right: -100px; animation: rsDrift2 12s ease-in-out infinite alternate; }
        @keyframes rsDrift1 { from{transform:translate(0,0) scale(1)} to{transform:translate(40px,30px) scale(1.08)} }
        @keyframes rsDrift2 { from{transform:translate(0,0)} to{transform:translate(-30px,-20px) scale(1.1)} }

        .rs-grid { position: fixed; inset: 0; z-index: 1; pointer-events: none;
          background-image: linear-gradient(rgba(167,139,250,0.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(167,139,250,0.04) 1px, transparent 1px);
          background-size: 48px 48px; }

        .rs-content { position: relative; z-index: 2; width: 100%; max-width: 720px; display: flex; flex-direction: column; align-items: center; }

        /* Logo */
        .rs-logo { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
        .rs-logo-bars { display: flex; gap: 3px; align-items: flex-end; }
        .rs-logo-bars span { display: block; width: 4px; border-radius: 2px; }
        .rs-logo-name { font-family: 'Syne', sans-serif; font-size: 19px; font-weight: 800; color: white; letter-spacing: -0.3px; }
        .rs-logo-name em { font-style: normal; color: #c4b5fd; }

        /* Header */
        .rs-title { font-family: 'Syne', sans-serif; font-size: 26px; font-weight: 800; color: white; letter-spacing: -0.8px; margin-bottom: 6px; text-align: center; }
        .rs-title em { font-style: normal; background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9); background-size: 300%; -webkit-background-clip: text; -webkit-text-fill-color: transparent; animation: rsGrad 5s ease infinite; }
        @keyframes rsGrad { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
        .rs-subtitle { font-size: 13px; color: rgba(196,181,253,0.45); text-align: center; margin-bottom: 28px; line-height: 1.6; max-width: 400px; font-weight: 300; }

        /* Layout */
        .rs-layout { display: grid; grid-template-columns: 220px 1fr; gap: 16px; width: 100%; animation: rsUp 0.45s cubic-bezier(0.22,1,0.36,1) both; }
        @keyframes rsUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }

        /* Cards base */
        .rs-card { background: rgba(255,255,255,0.03); border: 1px solid rgba(167,139,250,0.14); border-radius: 20px; backdrop-filter: blur(20px); }

        /* Account card */
        .rs-account-card { padding: 24px 20px; }
        .rs-account-label { font-size: 9.5px; font-weight: 700; color: rgba(167,139,250,0.4); letter-spacing: 1.2px; text-transform: uppercase; margin-bottom: 16px; }

        .rs-avatar {
          width: 52px; height: 52px; border-radius: 50%;
          background: linear-gradient(135deg, #7c3aed, #c4b5fd);
          display: flex; align-items: center; justify-content: center;
          margin-bottom: 10px; overflow: hidden;
          font-family: 'Syne', sans-serif; font-size: 20px; font-weight: 800; color: white;
          border: 2px solid rgba(196,181,253,0.2);
        }
        .rs-avatar img { width: 100%; height: 100%; object-fit: cover; }

        .rs-full-name { font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 800; color: white; margin-bottom: 8px; letter-spacing: -0.3px; }

        .rs-verified { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; background: rgba(52,211,153,0.1); border: 1px solid rgba(52,211,153,0.2); border-radius: 20px; font-size: 10px; font-weight: 700; color: #34d399; letter-spacing: 0.3px; }

        .rs-divider { height: 1px; background: rgba(167,139,250,0.1); margin: 16px 0; }

        .rs-info-block { margin-bottom: 12px; }
        .rs-info-block:last-child { margin-bottom: 0; }
        .rs-info-label { font-size: 9.5px; font-weight: 700; color: rgba(167,139,250,0.35); letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 3px; display: flex; align-items: center; gap: 5px; }
        .rs-info-value { font-size: 12.5px; font-weight: 600; color: rgba(226,232,240,0.75); }

        /* Role card */
        .rs-role-card { padding: 24px 22px; display: flex; flex-direction: column; }
        .rs-role-title { font-family: 'Syne', sans-serif; font-size: 15px; font-weight: 800; color: white; letter-spacing: -0.3px; margin-bottom: 3px; }
        .rs-role-subtitle { font-size: 11.5px; color: rgba(196,181,253,0.4); margin-bottom: 16px; line-height: 1.5; }

        .rs-options { display: flex; flex-direction: column; gap: 8px; flex: 1; }

        .rs-option { display: flex; align-items: center; gap: 12px; padding: 12px 14px; background: rgba(167,139,250,0.04); border: 1.5px solid rgba(167,139,250,0.1); border-radius: 12px; cursor: pointer; transition: all 0.2s; }
        .rs-option:hover { border-color: rgba(196,181,253,0.25); background: rgba(167,139,250,0.08); }
        .rs-option.selected { border-color: rgba(196,181,253,0.4); background: rgba(167,139,250,0.12); }

        .rs-option-icon { width: 34px; height: 34px; border-radius: 9px; background: rgba(167,139,250,0.08); display: flex; align-items: center; justify-content: center; color: rgba(196,181,253,0.5); flex-shrink: 0; transition: all 0.2s; }
        .rs-option.selected .rs-option-icon { background: rgba(196,181,253,0.15); color: #c4b5fd; }

        .rs-option-label { font-size: 13px; font-weight: 700; color: rgba(233,213,255,0.85); margin-bottom: 2px; }
        .rs-option-desc { font-size: 11px; color: rgba(167,139,250,0.45); line-height: 1.4; }

        .rs-radio { width: 15px; height: 15px; border-radius: 50%; border: 2px solid rgba(167,139,250,0.25); flex-shrink: 0; transition: all 0.2s; display: flex; align-items: center; justify-content: center; }
        .rs-option.selected .rs-radio { border-color: #c4b5fd; background: #c4b5fd; }
        .rs-option.selected .rs-radio::after { content: ''; width: 5px; height: 5px; border-radius: 50%; background: #1e1433; }

        /* Error */
        .rs-error-wrap { height: 34px; margin-top: 10px; }
        .rs-error { display: flex; align-items: center; gap: 8px; padding: 7px 12px; background: rgba(244,114,182,0.08); border: 1px solid rgba(244,114,182,0.2); border-radius: 9px; font-size: 11px; color: #f472b6; font-weight: 500; height: 100%; animation: rsFade 0.2s ease; }
        @keyframes rsFade { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }

        /* Button */
        .rs-btn { width: 100%; height: 46px; margin-top: 10px; display: flex; align-items: center; justify-content: center; gap: 8px; background: linear-gradient(135deg, #c4b5fd, #f472b6, #67e8f9); background-size: 300%; border: none; border-radius: 13px; font-family: 'Syne', sans-serif; font-size: 14px; font-weight: 700; color: #1e1433; cursor: pointer; transition: all 0.3s; box-shadow: 0 5px 18px rgba(196,181,253,0.2); animation: rsGrad 4s ease infinite; }
        .rs-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(244,114,182,0.3); }
        .rs-btn:disabled { opacity: 0.5; cursor: not-allowed; animation: none; background: rgba(167,139,250,0.2); color: rgba(255,255,255,0.4); box-shadow: none; }

        .rs-spinner { width: 14px; height: 14px; border: 2px solid rgba(30,20,51,0.3); border-top-color: #1e1433; border-radius: 50%; animation: rsSpin 0.7s linear infinite; }
        @keyframes rsSpin { to{transform:rotate(360deg)} }

        @media (max-width: 600px) {
          .rs-layout { grid-template-columns: 1fr; }
        }
      `}</style>

      <div className="rs-page">
        <div className="rs-orb1" />
        <div className="rs-orb2" />
        <div className="rs-grid" />

        <div className="rs-content">

          {/* Logo */}
          <div className="rs-logo">
            <div className="rs-logo-bars">
              <span style={{height:'10px',background:'#7c3aed'}} />
              <span style={{height:'16px',background:'#a855f7'}} />
              <span style={{height:'24px',background:'#c4b5fd'}} />
              <span style={{height:'18px',background:'#f472b6'}} />
              <span style={{height:'12px',background:'#e879f9',opacity:0.7}} />
              <span style={{height:'7px',background:'#c4b5fd',opacity:0.4}} />
            </div>
            <span className="rs-logo-name"><em>Skill</em>Pulse</span>
          </div>

          <h1 className="rs-title">Configure your <em>experience.</em></h1>
          <p className="rs-subtitle">Help us tailor SkillPulse to your professional goals and workflow.</p>

          <div className="rs-layout">

            {/* Account card */}
            <div className="rs-card rs-account-card">
              <div className="rs-account-label">Linked Account</div>

              <div className="rs-avatar">
                {user?.avatar_url
                  ? <img src={user.avatar_url} alt="avatar" />
                  : (user?.username?.[0] ?? "?").toUpperCase()
                }
              </div>

              <div className="rs-full-name">{user?.full_name ?? "Loading..."}</div>

              <div className="rs-verified">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
                </svg>
                GitHub Verified
              </div>

              <div className="rs-divider" />

              <div className="rs-info-block">
                <div className="rs-info-label">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
                  Username
                </div>
                <div className="rs-info-value">{user?.username ?? "—"}</div>
              </div>

              <div className="rs-info-block">
                <div className="rs-info-label">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                  Email
                </div>
                <div className="rs-info-value">{user?.work_email ?? "—"}</div>
              </div>
            </div>

            {/* Role card */}
            <div className="rs-card rs-role-card">
              <div className="rs-role-title">Select your primary role</div>
              <div className="rs-role-subtitle">This defines your dashboard view and can be changed later.</div>

              <div className="rs-options">
                {roles.map(r => (
                  <div
                    key={r.value}
                    className={`rs-option ${selected === r.value ? "selected" : ""}`}
                    onClick={() => setSelected(r.value)}
                  >
                    <div className="rs-option-icon">{r.icon}</div>
                    <div style={{flex:1}}>
                      <div className="rs-option-label">{r.label}</div>
                      <div className="rs-option-desc">{r.desc}</div>
                    </div>
                    <div className="rs-radio" />
                  </div>
                ))}
              </div>

              <div className="rs-error-wrap">
                {error && <div className="rs-error"><span>⚠</span> {error}</div>}
              </div>

              <button className="rs-btn" onClick={handleContinue} disabled={loading || !selected}>
                {loading
                  ? <><div className="rs-spinner" /> Saving...</>
                  : <>Continue to Dashboard →</>
                }
              </button>
            </div>

          </div>
        </div>
      </div>
    </>
  );
};

export default RoleSelection;
