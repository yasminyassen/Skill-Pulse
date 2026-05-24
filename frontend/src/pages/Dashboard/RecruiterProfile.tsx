import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

interface RecruiterProfile {
  user: {
    full_name: string;
    username: string;
    email: string;
    avatar_url: string | null;
    organization: string | null;
    job_title: string | null;
    department: string | null;
    hiring_focus: string | null;
    member_since: string | null;
    security_score_visible: boolean | null;
    high_priority_threshold: number | null;
    weight_code_quality: number | null;
    weight_security: number | null;
    weight_git_activity: number | null;   
  };
  talent_overview: {
    candidates_evaluated: number;
    high_priority: number;
    profiles_shortlisted: number;
  };
  recent_activity: Array<{
    title: string;
    description: string;
    score: number | null;
    completed_at: string | null;
  }>;
}

const _initials = (name: string) =>
  name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

const _fmtMonthYear = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

const _fmtAgo = (iso: string | null) => {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const _scoreColor = (s: number) =>
  s >= 80 ? "#34d399" : s >= 60 ? "#fbbf24" : "#f87171";

const I = {
  Building: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/></svg>,
  Briefcase: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>,
  Target: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  Calendar: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Users: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  Alert: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>,
  Star: () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>,
  File: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 13"/></svg>,
  Chart: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>,
  ArrowRight: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>,
  Shield: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  Edit: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>,
  Loader: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>,
  Close: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>,
  Sliders: () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>,
  EyeOff: () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>,
};

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-pressed={on} style={{ width: 44, height: 24, borderRadius: 12, background: on ? "#6366f1" : "rgba(148,163,184,0.2)", border: "none", position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}>
      <div style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
    </button>
  );
}

function WeightSlider({ label, color, value, onChange }: { label: string; color: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "rgba(255,255,255,0.7)", fontFamily: "'DM Sans',sans-serif" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color, fontFamily: "'DM Sans',sans-serif", minWidth: 38, textAlign: "right" }}>{value}%</span>
      </div>
      <div style={{ position: "relative", height: 6, borderRadius: 6, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 6, background: color, width: `${value}%`, transition: "width 0.15s" }} />
        <input
          type="range" min={0} max={100} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ position: "absolute", top: -7, left: 0, width: "100%", height: 20, opacity: 0, cursor: "pointer", margin: 0 }}
        />
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.7)", backdropFilter: "blur(6px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ width: "100%", maxWidth: 500, margin: "0 16px", background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20, padding: "28px 32px", boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 17, fontWeight: 800, color: "white", margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <I.Close />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function RecruiterProfilePage() {
  const navigate = useNavigate();

  const [profile, setProfile] = useState<RecruiterProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editOrg, setEditOrg] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDept, setEditDept] = useState("");
  const [editFocus, setEditFocus] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const [securityOn, setSecurityOn] = useState(true);
  const [savingEval, setSavingEval] = useState(false);

  const [prefOpen, setPrefOpen] = useState(false);
  // 3 weights بس — بدون git و req
  const [wCodeQuality, setWCodeQuality] = useState(40);
  const [wSecurity, setWSecurity] = useState(30);
  const [wProblemSolving, setWProblemSolving] = useState(30);

  const [prioOpen, setPrioOpen] = useState(false);
  const [threshold, setThreshold] = useState(75);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/recruiter/profile-dashboard");
        setProfile(res.data);
        setEditOrg(res.data.user.organization ?? "");
        setEditTitle(res.data.user.job_title ?? "");
        setEditDept(res.data.user.department ?? "");
        setEditFocus(res.data.user.hiring_focus ?? "");
        setSecurityOn(res.data.user.security_score_visible ?? true);
        setThreshold(res.data.user.high_priority_threshold ?? 75);
        setWCodeQuality(res.data.user.weight_code_quality ?? 40);
        setWSecurity(res.data.user.weight_security ?? 30);
        setWProblemSolving(res.data.user.weight_git_activity ?? 30);  // weight_git_activity = problem_solving
      } catch (err: any) {
        if (err?.response?.status === 401) { localStorage.clear(); navigate("/login"); }
      } finally { setLoading(false); }
    })();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await api.patch("/recruiter/profile", {
        organization: editOrg.trim() || null,
        job_title: editTitle.trim() || null,
        department: editDept.trim() || null,
        hiring_focus: editFocus.trim() || null,
      });
      setProfile((prev) => prev ? { ...prev, user: { ...prev.user, ...res.data } } : prev);
      setEditOpen(false);
      showToast("Profile updated successfully", true);
    } catch { showToast("Failed to save. Try again.", false); }
    finally { setSaving(false); }
  }, [editOrg, editTitle, editDept, editFocus]);

  const saveEvalSettings = useCallback(async (patch: Record<string, unknown>) => {
    setSavingEval(true);
    try {
      await api.patch("/recruiter/eval-settings", patch);
      showToast("Settings saved", true);
    } catch { showToast("Failed to save settings.", false); }
    finally { setSavingEval(false); }
  }, []);

  const handleSecurityToggle = () => {
    const next = !securityOn;
    setSecurityOn(next);
    saveEvalSettings({ security_score_visible: next });
  };

  const handleSavePreferences = async () => {
    await saveEvalSettings({
      weight_code_quality: wCodeQuality,
      weight_security: wSecurity,
      weight_git_activity: wProblemSolving,   // بنحفظه في weight_git_activity في الـ DB
    });
    setPrefOpen(false);
  };

  const handleSaveThreshold = async () => {
    await saveEvalSettings({ high_priority_threshold: threshold });
    setPrioOpen(false);
  };

  // الـ total لازم يوصل 100
  const totalWeight = wCodeQuality + wSecurity + wProblemSolving;
  const weightOk = totalWeight === 100;

  const card = (content: React.ReactNode, extra?: React.CSSProperties) => (
    <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "24px 28px", ...extra }}>{content}</div>
  );

  const sectionTitle = (text: string) => (
    <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color: "white", margin: "0 0 16px" }}>{text}</h2>
  );

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }
        .rsk { background:linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.04) 75%); background-size:400% 100%; animation:shimmer 1.5s ease-in-out infinite; border-radius:8px; }
        .rp-action-btn { padding:6px 14px; border-radius:8px; border:none; font-size:13px; font-weight:700; cursor:pointer; font-family:'DM Sans',sans-serif; color:#a78bfa; background:rgba(167,139,250,0.1); transition:background 0.15s; }
        .rp-action-btn:hover { background:rgba(167,139,250,0.18); }
        .rp-view-btn { width:100%; padding:10px 0; border-radius:10px; border:1px solid rgba(255,255,255,0.07); background:transparent; color:rgba(255,255,255,0.4); font-size:13px; font-weight:600; cursor:pointer; font-family:'DM Sans',sans-serif; display:flex; align-items:center; justify-content:center; gap:6px; margin-top:16px; transition:all 0.15s; }
        .rp-view-btn:hover { color:white; border-color:rgba(255,255,255,0.15); }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; width:16px; height:16px; border-radius:50%; background:#6366f1; cursor:pointer; }
        .security-hidden-badge { display:inline-flex; align-items:center; gap:5px; padding:2px 8px; border-radius:20px; background:rgba(248,113,113,0.1); border:1px solid rgba(248,113,113,0.25); color:#f87171; font-size:10.5px; font-weight:700; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", bottom: 28, right: 28, zIndex: 9999, padding: "12px 20px", borderRadius: 12, background: toast.ok ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)", border: `1px solid ${toast.ok ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`, color: toast.ok ? "#34d399" : "#f87171", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, fontFamily: "'DM Sans',sans-serif", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}>
          {toast.ok ? "✓" : "✕"} {toast.msg}
        </div>
      )}

      {/* Evaluation Preferences Modal — 3 sliders بس */}
      {prefOpen && (
        <Modal title="Evaluation Preferences" onClose={() => setPrefOpen(false)}>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.35)", marginTop: 0, marginBottom: 20, lineHeight: 1.6 }}>
            Set how SkillPulse weighs each skill category. Weights must add up to <strong style={{ color: weightOk ? "#34d399" : "#f87171" }}>100%</strong> (currently <strong style={{ color: weightOk ? "#34d399" : "#f87171" }}>{totalWeight}%</strong>).
          </p>
          <WeightSlider label="Code Quality"     color="#6366f1" value={wCodeQuality}     onChange={setWCodeQuality} />
          <WeightSlider label="Security"          color="#f87171" value={wSecurity}         onChange={setWSecurity} />
          <WeightSlider label="Problem Solving"   color="#34d399" value={wProblemSolving}   onChange={setWProblemSolving} />
          <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setPrefOpen(false)} style={{ padding: "8px 18px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
            <button onClick={handleSavePreferences} disabled={!weightOk || savingEval} style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: weightOk ? "#6366f1" : "rgba(99,102,241,0.3)", color: "white", fontSize: 13, fontWeight: 700, cursor: weightOk && !savingEval ? "pointer" : "not-allowed", fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
              {savingEval && <I.Loader />} Save Preferences
            </button>
          </div>
        </Modal>
      )}

      {/* Priority Threshold Modal */}
      {prioOpen && (
        <Modal title="Priority Thresholds" onClose={() => setPrioOpen(false)}>
          <p style={{ fontSize: 12.5, color: "rgba(255,255,255,0.35)", marginTop: 0, marginBottom: 24, lineHeight: 1.6 }}>
            Candidates scoring above this threshold will be automatically flagged as <strong style={{ color: "#f87171" }}>High Priority</strong>.
          </p>
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{ fontSize: 56, fontWeight: 900, color: threshold >= 80 ? "#34d399" : threshold >= 60 ? "#fbbf24" : "#f87171", fontFamily: "'Syne',sans-serif", lineHeight: 1 }}>{threshold}</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginTop: 4 }}>minimum score / 100</div>
          </div>
          <div style={{ position: "relative", height: 6, borderRadius: 6, background: "rgba(255,255,255,0.06)", marginBottom: 10 }}>
            <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 6, background: threshold >= 80 ? "#34d399" : threshold >= 60 ? "#fbbf24" : "#f87171", width: `${threshold}%`, transition: "width 0.1s, background 0.2s" }} />
            <input type="range" min={0} max={100} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} style={{ position: "absolute", top: -10, left: 0, width: "100%", height: 26, opacity: 0, cursor: "pointer", margin: 0 }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "rgba(255,255,255,0.2)" }}>
            <span>0</span><span>25</span><span>50</span><span>75</span><span>100</span>
          </div>
          <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", fontSize: 12.5, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
            {threshold >= 80 ? "🟢 Strict — only top performers flagged" : threshold >= 60 ? "🟡 Balanced — moderate filter" : "🔴 Lenient — many candidates may be flagged"}
          </div>
          <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => setPrioOpen(false)} style={{ padding: "8px 18px", borderRadius: 9, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
            <button onClick={handleSaveThreshold} disabled={savingEval} style={{ padding: "8px 20px", borderRadius: 9, border: "none", background: "#6366f1", color: "white", fontSize: 13, fontWeight: 700, cursor: savingEval ? "not-allowed" : "pointer", fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
              {savingEval && <I.Loader />} Save Threshold
            </button>
          </div>
        </Modal>
      )}

      <div style={{ minHeight: "100vh", padding: "36px 40px 80px", color: "rgba(226,232,240,0.9)", fontFamily: "'DM Sans',sans-serif", background: "radial-gradient(circle at 10% 0%,rgba(99,102,241,0.18),transparent 45%),radial-gradient(circle at 90% 20%,rgba(236,72,153,0.12),transparent 40%),#0a0a0f" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Page header */}
          <div>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: "white", letterSpacing: "-0.5px", margin: "0 0 4px" }}>Recruiter Profile</h1>
            <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.35)", margin: 0 }}>Manage your evaluation preferences and decision-support settings</p>
          </div>

          {/* Profile card */}
          {card(
            loading ? (
              <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
                <div className="rsk" style={{ width: 72, height: 72, borderRadius: "50%" }} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div className="rsk" style={{ height: 20, width: "38%" }} />
                  <div className="rsk" style={{ height: 13, width: "24%" }} />
                </div>
              </div>
            ) : profile?.user ? (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                    {profile.user.avatar_url
                      ? <img src={profile.user.avatar_url} alt={profile.user.full_name} style={{ width: 72, height: 72, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(99,102,241,0.35)" }} />
                      : <div style={{ width: 72, height: 72, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#ec4899)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 800, color: "#fff", flexShrink: 0 }}>{_initials(profile.user.full_name)}</div>
                    }
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "white", marginBottom: 3 }}>{profile.user.full_name}</div>
                      <div style={{ fontSize: 13, color: "rgba(167,139,250,0.9)", fontWeight: 600, marginBottom: 10 }}>{profile.user.job_title || "Technical Recruiter"}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {[profile.user.username, profile.user.email, "Recruiter"].map((lbl) => (
                          <span key={lbl} style={{ padding: "4px 11px", borderRadius: 20, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{lbl}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setEditOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
                    <I.Edit /> Edit Profile
                  </button>
                </div>

                {editOpen && (
                  <div style={{ padding: "16px 20px", borderRadius: 12, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)", marginBottom: 20, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    {[
                      { label: "Organization", val: editOrg, set: setEditOrg },
                      { label: "Job Title", val: editTitle, set: setEditTitle },
                      { label: "Department", val: editDept, set: setEditDept },
                      { label: "Hiring Focus", val: editFocus, set: setEditFocus },
                    ].map(({ label, val, set }) => (
                      <div key={label}>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", fontWeight: 700, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                        <input value={val} onChange={(e) => set(e.target.value)} placeholder={`Enter ${label.toLowerCase()}…`} style={{ width: "100%", padding: "8px 12px", borderRadius: 8, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontSize: 13, outline: "none", fontFamily: "'DM Sans',sans-serif", boxSizing: "border-box" }} />
                      </div>
                    ))}
                    <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                      <button onClick={() => setEditOpen(false)} style={{ padding: "7px 16px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "rgba(255,255,255,0.4)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>Cancel</button>
                      <button onClick={handleSave} disabled={saving} style={{ padding: "7px 18px", borderRadius: 8, border: "none", background: saving ? "rgba(99,102,241,0.5)" : "#6366f1", color: "white", fontSize: 13, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "'DM Sans',sans-serif", display: "flex", alignItems: "center", gap: 6 }}>
                        {saving && <I.Loader />}{saving ? "Saving…" : "Save Changes"}
                      </button>
                    </div>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  {[
                    { Icon: I.Building,  label: "Organization", value: profile.user.organization || "Not set" },
                    { Icon: I.Briefcase, label: "Department",    value: profile.user.department   || "Not set" },
                    { Icon: I.Target,    label: "Hiring Focus",  value: profile.user.hiring_focus || "Not set" },
                    { Icon: I.Calendar,  label: "Member Since",  value: _fmtMonthYear(profile.user.member_since) },
                  ].map(({ Icon, label, value }) => (
                    <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: 10, paddingRight: 12 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)", flexShrink: 0 }}><Icon /></div>
                      <div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: 3 }}>{label}</div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: "white" }}>{value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null
          )}

          {/* Talent Overview */}
          {!loading && profile?.talent_overview && (
            <div>
              {sectionTitle("Talent Decision Overview")}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
                {[
                  { Icon: I.Users, label: "Candidates Evaluated",   value: profile.talent_overview.candidates_evaluated, sub: "Total profiles analyzed",    bg: "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(236,72,153,0.7))", iconBg: "rgba(255,255,255,0.15)", iconColor: "rgba(255,255,255,0.9)", valColor: "white",   subColor: "rgba(255,255,255,0.6)", border: "none" },
                  { Icon: I.Alert, label: "High-Priority Identified", value: profile.talent_overview.high_priority,        sub: "Above priority threshold",   bg: "rgba(248,113,113,0.06)",  iconBg: "rgba(248,113,113,0.12)", iconColor: "#f87171", valColor: "#f87171", subColor: "rgba(255,255,255,0.3)", border: "1px solid rgba(248,113,113,0.2)" },
                  { Icon: I.Star,  label: "Profiles Shortlisted",    value: profile.talent_overview.profiles_shortlisted,  sub: "Marked for consideration",   bg: "rgba(167,139,250,0.06)",  iconBg: "rgba(167,139,250,0.12)", iconColor: "#a78bfa", valColor: "#a78bfa", subColor: "rgba(255,255,255,0.3)", border: "1px solid rgba(167,139,250,0.2)" },
                ].map((c) => (
                  <div key={c.label} style={{ padding: "22px 24px", borderRadius: 16, background: c.bg, border: c.border }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: c.valColor === "white" ? "rgba(255,255,255,0.75)" : c.valColor, textTransform: "uppercase", letterSpacing: "0.5px" }}>{c.label}</div>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: c.iconBg, display: "flex", alignItems: "center", justifyContent: "center", color: c.iconColor }}><c.Icon /></div>
                    </div>
                    <div style={{ fontSize: 42, fontWeight: 900, color: c.valColor, lineHeight: 1, marginBottom: 6 }}>{c.value}</div>
                    <div style={{ fontSize: 12, color: c.subColor }}>{c.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bottom 2-col */}
          {!loading && profile && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>

              {/* Recent Activity */}
              {card(
                <>
                  {sectionTitle("Recent Decision Activity")}
                  {!securityOn && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.15)", marginBottom: 14 }}>
                      <I.EyeOff />
                      <span style={{ fontSize: 12, color: "rgba(248,113,113,0.85)", fontWeight: 600 }}>Security scores are hidden in candidate reports</span>
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {(profile.recent_activity ?? []).slice(0, 5).map((act, i, arr) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 8px", borderBottom: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(99,102,241,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa", flexShrink: 0 }}>
                            {act.title.toLowerCase().includes("compar") ? <I.Chart /> : <I.File />}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 700, color: "white", marginBottom: 2 }}>{act.title}</div>
                            <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.35)" }}>{act.description}</div>
                          </div>
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>{_fmtAgo(act.completed_at)}</div>
                          {act.score !== null && securityOn && (
                            <div style={{ fontSize: 13, fontWeight: 700, color: _scoreColor(act.score!), marginTop: 2 }}>{act.score}</div>
                          )}
                          {act.score !== null && !securityOn && (
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", marginTop: 2, fontStyle: "italic" }}>hidden</div>
                          )}
                        </div>
                      </div>
                    ))}
                    {(!profile.recent_activity || profile.recent_activity.length === 0) && (
                      <div style={{ padding: "20px 0", textAlign: "center", color: "rgba(255,255,255,0.25)", fontSize: 13 }}>No recent activity yet.</div>
                    )}
                  </div>
                  <button className="rp-view-btn" onClick={() => navigate("/dashboard/recruiter/candidates")}>
                    View All Decision Logs <I.ArrowRight />
                  </button>
                </>
              )}

              {/* Evaluation Settings */}
              {card(
                <>
                  {sectionTitle("Evaluation Settings")}
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                    {/* Evaluation Preferences — 3 weight badges */}
                    <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(99,102,241,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa", flexShrink: 0 }}><I.Sliders /></div>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: "white", marginBottom: 4 }}>Evaluation Preferences</div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>Adjust how SkillPulse weighs skill categories for your hiring needs.</div>
                          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            {[
                              { label: "Code",     val: wCodeQuality,   color: "#6366f1" },
                              { label: "Security", val: wSecurity,       color: "#f87171" },
                              { label: "Problem Solving",  val: wProblemSolving, color: "#34d399" },
                            ].map((w) => (
                              <span key={w.label} style={{ fontSize: 10.5, fontWeight: 700, color: w.color, background: `${w.color}18`, padding: "2px 8px", borderRadius: 20, border: `1px solid ${w.color}30` }}>{w.label} {w.val}%</span>
                            ))}
                          </div>
                        </div>
                      </div>
                      <button className="rp-action-btn" onClick={() => setPrefOpen(true)}>Configure</button>
                    </div>

                    {/* Priority Thresholds */}
                    <div style={{ padding: "14px 16px", borderRadius: 12, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(248,113,113,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", flexShrink: 0 }}><I.Alert /></div>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: "white", marginBottom: 4 }}>Priority Thresholds</div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>Define the minimum score to flag a candidate as "High Priority".</div>
                          <div style={{ marginTop: 8 }}>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: threshold >= 80 ? "#34d399" : threshold >= 60 ? "#fbbf24" : "#f87171", background: threshold >= 80 ? "rgba(52,211,153,0.1)" : threshold >= 60 ? "rgba(251,191,36,0.1)" : "rgba(248,113,113,0.1)", padding: "2px 8px", borderRadius: 20, border: `1px solid ${threshold >= 80 ? "rgba(52,211,153,0.3)" : threshold >= 60 ? "rgba(251,191,36,0.3)" : "rgba(248,113,113,0.3)"}` }}>
                              Threshold: {threshold}
                            </span>
                          </div>
                        </div>
                      </div>
                      <button className="rp-action-btn" onClick={() => setPrioOpen(true)}>Manage</button>
                    </div>

                    {/* Security Score Visibility */}
                    <div style={{ padding: "14px 16px", borderRadius: 12, background: securityOn ? "rgba(255,255,255,0.02)" : "rgba(248,113,113,0.04)", border: securityOn ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(248,113,113,0.15)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, transition: "all 0.2s" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div style={{ width: 34, height: 34, borderRadius: 8, background: securityOn ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.1)", display: "flex", alignItems: "center", justifyContent: "center", color: securityOn ? "#34d399" : "#f87171", flexShrink: 0, transition: "all 0.2s" }}><I.Shield /></div>
                        <div>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: "white", marginBottom: 4 }}>Security Score Visibility</div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", lineHeight: 1.5 }}>Show or hide security vulnerability analysis in candidate reports.</div>
                          <div style={{ marginTop: 7 }}>
                            <span style={{ fontSize: 10.5, fontWeight: 700, color: securityOn ? "#34d399" : "#f87171", background: securityOn ? "rgba(52,211,153,0.1)" : "rgba(248,113,113,0.1)", padding: "2px 8px", borderRadius: 20, border: `1px solid ${securityOn ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.25)"}` }}>
                              {securityOn ? "● Visible" : "● Hidden"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <Toggle on={securityOn} onToggle={handleSecurityToggle} />
                    </div>

                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}