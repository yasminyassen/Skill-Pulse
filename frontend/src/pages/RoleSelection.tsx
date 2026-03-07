
import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/auth";

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

const GitHubVerifiedBadge = () => (
  <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"3px 10px",background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:20,fontSize:11,fontWeight:700,color:"#16a34a",letterSpacing:"0.4px"}}>
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>
    </svg>
    GitHub Verified
  </span>
);

const roles = [
  {
    value: "developer",
    label: "Developer",
    desc: "Analyze your repositories and map your growth journey.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
  {
    value: "manager",
    label: "Engineering Manager",
    desc: "Evaluate team strengths and identify technical gaps.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
    } catch (err: any) {
      setError("Failed to save your role. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .rs-page {
          min-height: 100vh;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          background: linear-gradient(160deg, #eef0f9 0%, #f5f6fb 50%, #ece8f8 100%);
          padding: 40px 16px;
          font-family: 'DM Sans', sans-serif;
        }

        .rs-logo-row {
          display: flex; align-items: center; gap: 8px;
          margin-bottom: 28px;
        }

        .rs-logo-name { font-size: 18px; font-weight: 700; color: #1e1b4b; }
        .rs-logo-name span { color: #6366f1; }

        .rs-title {
          font-size: 26px; font-weight: 700; color: #111827;
          letter-spacing: -0.4px; margin-bottom: 6px; text-align: center;
        }

        .rs-subtitle {
          font-size: 14px; color: #6b7280; text-align: center;
          margin-bottom: 32px; line-height: 1.6; max-width: 420px;
        }

        .rs-layout {
          display: grid; grid-template-columns: 240px 1fr;
          gap: 20px; width: 100%; max-width: 720px;
          animation: slideUp 0.4s cubic-bezier(0.22,1,0.36,1) both;
        }

        @keyframes slideUp {
          from { opacity: 0; transform: translateY(20px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .rs-account-card {
          background: white; border-radius: 20px;
          padding: 28px 22px;
          box-shadow: 0 4px 24px rgba(99,102,241,0.07);
        }

        .rs-account-label {
          font-size: 10px; font-weight: 700; color: #9ca3af;
          letter-spacing: 1.2px; text-transform: uppercase;
          margin-bottom: 18px;
        }

        .rs-avatar {
          width: 56px; height: 56px; border-radius: 50%;
          background: #e0e7ff; display: flex; align-items: center; justify-content: center;
          margin-bottom: 12px; overflow: hidden;
          font-size: 22px; font-weight: 700; color: #6366f1;
        }

        .rs-avatar img { width: 100%; height: 100%; object-fit: cover; }

        .rs-full-name {
          font-size: 15px; font-weight: 700; color: #111827; margin-bottom: 8px;
        }

        .rs-divider { height: 1px; background: #f3f4f6; margin: 18px 0; }

        .rs-info-block { margin-bottom: 14px; }
        .rs-info-block:last-child { margin-bottom: 0; }

        .rs-info-label {
          font-size: 10px; font-weight: 700; color: #9ca3af;
          letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 3px;
          display: flex; align-items: center; gap: 5px;
        }

        .rs-info-value { font-size: 13px; font-weight: 600; color: #374151; }

        .rs-role-card {
          background: white; border-radius: 20px;
          padding: 28px 24px;
          box-shadow: 0 4px 24px rgba(99,102,241,0.07);
          display: flex; flex-direction: column;
        }

        .rs-role-title {
          font-size: 16px; font-weight: 700; color: #111827; margin-bottom: 4px;
        }

        .rs-role-subtitle {
          font-size: 12.5px; color: #6b7280; margin-bottom: 20px; line-height: 1.5;
        }

        .rs-options { display: flex; flex-direction: column; gap: 10px; flex: 1; }

        .rs-option {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 16px;
          background: #f9fafb; border: 1.5px solid #e5e7eb;
          border-radius: 12px; cursor: pointer; transition: all 0.2s;
        }

        .rs-option:hover { border-color: #c7d2fe; background: #fafafe; }
        .rs-option.selected { border-color: #6366f1; background: #eef2ff; }

        .rs-option-icon {
          width: 38px; height: 38px; border-radius: 10px;
          background: #f3f4f6; display: flex; align-items: center; justify-content: center;
          color: #6b7280; flex-shrink: 0; transition: all 0.2s;
        }

        .rs-option.selected .rs-option-icon { background: #e0e7ff; color: #6366f1; }

        .rs-option-info { flex: 1; }
        .rs-option-label { font-size: 13.5px; font-weight: 700; color: #111827; margin-bottom: 2px; }
        .rs-option-desc { font-size: 11.5px; color: #6b7280; line-height: 1.4; }

        .rs-radio {
          width: 18px; height: 18px; border-radius: 50%;
          border: 2px solid #d1d5db; background: white;
          flex-shrink: 0; transition: all 0.2s;
          display: flex; align-items: center; justify-content: center;
        }

        .rs-option.selected .rs-radio { border-color: #6366f1; background: #6366f1; }
        .rs-option.selected .rs-radio::after {
          content: ''; width: 7px; height: 7px; border-radius: 50%; background: white;
        }

        .rs-error {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px; margin-top: 14px;
          background: #fef2f2; border: 1px solid #fecaca;
          border-radius: 8px; font-size: 12.5px; color: #dc2626; font-weight: 500;
        }

        .rs-btn {
          width: 100%; height: 48px; margin-top: 16px;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          background: #6366f1; color: white;
          border: none; border-radius: 12px;
          font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600;
          cursor: pointer; transition: all 0.2s;
        }

        .rs-btn:hover:not(:disabled) { background: #4f46e5; transform: translateY(-1px); box-shadow: 0 4px 16px rgba(99,102,241,0.35); }
        .rs-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        .spinner {
          width: 15px; height: 15px;
          border: 2px solid rgba(255,255,255,0.3); border-top-color: white;
          border-radius: 50%; animation: spin 0.7s linear infinite;
        }

        @keyframes spin { to { transform: rotate(360deg); } }

        @media (max-width: 600px) {
          .rs-layout { grid-template-columns: 1fr; }
          .rs-title { font-size: 22px; }
        }
      `}</style>

      <div className="rs-page">
        <div className="rs-logo-row">
          <SkillPulseLogo />
          <span className="rs-logo-name"><span>Skill</span>Pulse</span>
        </div>

        <h1 className="rs-title">Configure Your Experience</h1>
        <p className="rs-subtitle">Help us tailor the SkillPulse engine to your professional goals and workflow.</p>

        <div className="rs-layout">
          {/* Left — GitHub Account Info */}
          <div className="rs-account-card">
            <div className="rs-account-label">Linked Account</div>

            <div className="rs-avatar">
              {user?.avatar_url
                ? <img src={user.avatar_url} alt="avatar" />
                : (user?.username?.[0] ?? "?").toUpperCase()
              }
            </div>

            <div className="rs-full-name">{user?.full_name ?? "Loading..."}</div>
            <GitHubVerifiedBadge />

            <div className="rs-divider" />

            <div className="rs-info-block">
              <div className="rs-info-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
                Username
              </div>
              <div className="rs-info-value">{user?.username ?? "—"}</div>
            </div>

            <div className="rs-info-block">
              <div className="rs-info-label">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                </svg>
                Email
              </div>
              <div className="rs-info-value">{user?.work_email ?? "—"}</div>
            </div>
          </div>

          {/* Right — Role Selection */}
          <div className="rs-role-card">
            <div className="rs-role-title">Select your primary role</div>
            <div className="rs-role-subtitle">Role selection is required once and defines your dashboard view.</div>

            <div className="rs-options">
              {roles.map(r => (
                <div
                  key={r.value}
                  className={`rs-option ${selected === r.value ? "selected" : ""}`}
                  onClick={() => setSelected(r.value)}
                >
                  <div className="rs-option-icon">{r.icon}</div>
                  <div className="rs-option-info">
                    <div className="rs-option-label">{r.label}</div>
                    <div className="rs-option-desc">{r.desc}</div>
                  </div>
                  <div className="rs-radio" />
                </div>
              ))}
            </div>

            {error && <div className="rs-error"><span>⚠</span> {error}</div>}

            <button className="rs-btn" onClick={handleContinue} disabled={loading || !selected}>
              {loading
                ? <><div className="spinner" /> Saving...</>
                : <>Continue to Dashboard →</>
              }
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default RoleSelection;
