import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from "recharts";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProfileDashboard {
  user: {
    id: number;
    full_name: string;
    username: string;
    email: string;
    role: string | null;
    avatar_url: string | null;
    github_login: string | null;
    member_since: string | null;
    organization: string | null;
    job_title: string | null;
  };
  integrations: {
    github: { connected: boolean; login: string | null };
  };
  progress_overview: {
    overall_delta: number;
    best_skill: string | null;
    best_skill_score: number;
    most_improved: string | null;
    most_improved_delta: number;
    focus_area: string | null;
  };
  skill_timeline: Array<{
    date: string | null;
    repo_name: string;
    code_quality: number;
    maintainability: number;
    architecture: number;
    problem_solving: number;
    security: number;
    overall: number;
  }>;
  recent_improvements: Array<{
    skill: string;
    score: number;
    previous: number;
    delta: number;
  }>;
  recent_activity: Array<{
    type: string;
    repo_name: string;
    full_name: string;
    branch: string;
    status: string;
    triggered_at: string | null;
    completed_at: string | null;
    score: number | null;
    analysis_id: number;
  }>;
  settings: {
    account_settings: string;
    connected_repositories: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (diff < 60)     return "just now";
  if (diff < 3600)   return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

const fmtMonthYear = (iso: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" });
};

const fmtChartDate = (iso: string | null) => {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const scoreColor = (s: number) => {
  if (s >= 80) return "#34d399";
  if (s >= 60) return "#fbbf24";
  return "#f87171";
};

const initials = (name: string) =>
  name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);

// ─── Sub-components ───────────────────────────────────────────────────────────

function Skeleton({ w, h, radius = 8 }: { w: number | string; h: number; radius?: number }) {
  return <div className="sk" style={{ width: w, height: h, borderRadius: radius }} />;
}

function DeltaBadge({ delta, large = false }: { delta: number; large?: boolean }) {
  const pos = delta >= 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "3px",
      padding: large ? "5px 12px" : "2px 8px",
      borderRadius: "20px",
      background: pos ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.10)",
      color: pos ? "#34d399" : "#f87171",
      fontSize: large ? "14px" : "11px", fontWeight: 700,
    }}>
      {pos ? "↑" : "↓"} {pos ? "+" : ""}{delta.toFixed(1)}
    </span>
  );
}

function ScorePill({ score }: { score: number }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: "3px 10px", borderRadius: "20px",
      background: `${scoreColor(score)}18`, color: scoreColor(score),
      fontSize: "13px", fontWeight: 800,
    }}>
      {score.toFixed(0)}
    </span>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: "12px", padding: "12px 16px", fontSize: "12px",
    }}>
      <div style={{ color: "var(--text-muted)", marginBottom: "8px", fontWeight: 600 }}>{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color }} />
          <span style={{ color: "var(--text-secondary)" }}>{p.name}</span>
          <span style={{ color: "var(--text-primary)", fontWeight: 700, marginLeft: "auto" }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function DeveloperProfile() {
  const navigate = useNavigate();
  const role = localStorage.getItem("role") || "developer";
  const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";

  const [data, setData]       = useState<ProfileDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<"30" | "90" | "all">("90");
  const [editOpen, setEditOpen]   = useState(false);

  const [editOrg,   setEditOrg]   = useState("");
  const [editTitle, setEditTitle] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/analysis/profile-dashboard");
        setData(res.data);
        setEditOrg(res.data.user.organization   ?? "");
        setEditTitle(res.data.user.job_title    ?? "");
      } catch (err: any) {
        if (err.response?.status === 401) {
          localStorage.clear();
          window.location.href = "/login";
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await api.patch("/analysis/profile", {
        organization: editOrg.trim() || null,
        job_title:    editTitle.trim() || null,
      });
      setData(prev => prev ? {
        ...prev,
        user: { ...prev.user, organization: res.data.organization, job_title: res.data.job_title },
      } : prev);
      setEditOpen(false);
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [editOrg, editTitle]);

  const filteredTimeline = (() => {
    if (!data?.skill_timeline.length) return [];
    if (timeRange === "all") return data.skill_timeline;
    const days   = timeRange === "30" ? 30 : 90;
    const cutoff = new Date(Date.now() - days * 86400 * 1000);
    const filtered = data.skill_timeline.filter(p => p.date && new Date(p.date) >= cutoff);
    return filtered.length ? filtered : data.skill_timeline;
  })();

  const user = data?.user;
  const po   = data?.progress_overview;

  const CHART_LINES: Array<{ key: string; label: string; color: string }> = [
    { key: "code_quality",    label: "Code Quality",    color: "#6366f1" },
    { key: "problem_solving", label: "Problem Solving", color: "#a78bfa" },
    { key: "architecture",    label: "Architecture",    color: "#38bdf8" },
    { key: "maintainability", label: "Maintainability", color: "#fb923c" },
    { key: "security",        label: "Security",        color: "#f472b6" },
  ];

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        input, select, textarea { font-family: 'DM Sans', sans-serif; }

        .prof-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 11px 24px;
          background: linear-gradient(135deg, ${accent}, #ec4899);
          border: none; border-radius: 12px; color: white;
          font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 700;
          cursor: pointer; transition: all 0.2s;
          box-shadow: 0 4px 16px ${accent}30;
        }
        .prof-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px ${accent}40; }
        .prof-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .prof-btn-ghost {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 16px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 9px; color: var(--text-secondary);
          font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all 0.2s;
        }
        .prof-btn-ghost:hover { background: var(--bg-card-hover); color: var(--text-primary); border-color: var(--border-hover); }

        .hover-card { transition: border-color 0.18s, transform 0.18s; }
        .hover-card:hover { border-color: var(--border-hover) !important; transform: translateY(-1px); }

        .settings-row {
          display: flex; align-items: center; gap: 14px;
          padding: 15px 18px; border-radius: 12px;
          background: var(--bg-card);
          border: 1px solid var(--border);
          cursor: pointer; transition: all 0.15s;
          color: var(--text-secondary); font-size: 14px; font-weight: 500;
          text-decoration: none;
        }
        .settings-row:hover { background: var(--bg-card-hover); border-color: var(--border-hover); color: var(--text-primary); }

        .time-btn {
          padding: 6px 14px; border-radius: 8px; border: 1px solid var(--border);
          background: transparent; color: var(--text-muted);
          font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s;
          font-family: 'DM Sans', sans-serif;
        }
        .time-btn.active { background: rgba(99,102,241,0.18); border-color: rgba(99,102,241,0.4); color: #818cf8; }
        .time-btn:hover:not(.active) { color: var(--text-primary); border-color: var(--border-hover); }

        .recharts-cartesian-grid-horizontal line,
        .recharts-cartesian-grid-vertical line { stroke: var(--border) !important; }
        .recharts-text { fill: var(--text-muted) !important; font-family: 'DM Sans',sans-serif !important; font-size: 11px !important; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        padding: "36px 40px 80px",
        color: "var(--text-primary)",
        fontFamily: "'DM Sans', sans-serif",
        background: "var(--bg-gradient)",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── Header ── */}
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "5px 14px", borderRadius: 999,
              border: `1px solid ${accent}40`, background: `${accent}12`,
              fontSize: 11, fontWeight: 700, letterSpacing: "0.8px",
              color: accent, textTransform: "uppercase" as const,
              width: "fit-content", marginBottom: 10,
            }}>
              Developer Profile
            </div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.5px", margin: "0 0 4px" }}>
              Your profile & progress
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
              Track your skill timeline, improvements, and recent activity.
            </p>
          </div>

          {/* ═══ 1. DEVELOPER INFO CARD ═══ */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "24px 28px" }}>
            {loading ? (
              <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
                <Skeleton w={76} h={76} radius={50} />
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
                  <Skeleton w="40%" h={22} />
                  <Skeleton w="28%" h={14} />
                  <div style={{ display: "flex", gap: "8px" }}>
                    <Skeleton w={100} h={28} radius={20} />
                    <Skeleton w={160} h={28} radius={20} />
                  </div>
                </div>
              </div>
            ) : user ? (
              <>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.full_name} style={{ width: 76, height: 76, borderRadius: "50%", objectFit: "cover", border: `2px solid ${accent}40` }} />
                    ) : (
                      <div style={{ width: 76, height: 76, borderRadius: "50%", flexShrink: 0, background: `linear-gradient(135deg, ${accent}, #ec4899)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "26px", fontWeight: 800, color: "white" }}>
                        {initials(user.full_name)}
                      </div>
                    )}
                    <div>
                      <div style={{ fontSize: "22px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "3px" }}>{user.full_name}</div>
                      <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "10px" }}>
                        {user.job_title || "Software Developer"}
                      </div>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        {[
                          { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>, label: user.username },
                          { icon: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>, label: user.email },
                        ].map(({ icon, label }) => (
                          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 12px", borderRadius: "20px", background: "var(--bg-card-hover)", border: "1px solid var(--border)", fontSize: "12px", color: "var(--text-secondary)" }}>
                            {icon}{label}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <button onClick={() => setEditOpen(!editOpen)} className="prof-btn-ghost">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                    </svg>
                    Edit Profile
                  </button>
                </div>

                {editOpen && (
                  <div style={{ padding: "16px 20px", borderRadius: "12px", background: `${accent}0A`, border: `1px solid ${accent}30`, marginBottom: "20px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    {[
                      { label: "Organization", value: editOrg,   setter: setEditOrg   },
                      { label: "Job Title",    value: editTitle, setter: setEditTitle  },
                    ].map(({ label, value, setter }) => (
                      <div key={label}>
                        <div style={{ fontSize: "11px", color: "rgba(167,139,250,0.8)", fontWeight: 700, marginBottom: "6px", letterSpacing: "0.8px", textTransform: "uppercase" }}>{label}</div>
                        <input
                          value={value}
                          onChange={e => setter(e.target.value)}
                          placeholder={`Enter ${label.toLowerCase()}…`}
                          style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", background: "var(--bg-input)", border: `1px solid ${accent}25`, color: "var(--text-primary)", fontSize: "13px", outline: "none", boxSizing: "border-box" }}
                        />
                      </div>
                    ))}
                    {saveError && (
                      <div style={{ gridColumn: "1/-1", fontSize: "12px", color: "#f87171", padding: "8px 12px", borderRadius: "8px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)" }}>
                        {saveError}
                      </div>
                    )}
                    <div style={{ gridColumn: "1/-1", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                      <button className="prof-btn-ghost" onClick={() => { setEditOpen(false); setSaveError(null); }} disabled={saving}>Cancel</button>
                      <button className="prof-btn-primary" onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save Changes"}</button>
                    </div>
                  </div>
                )}

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", paddingTop: "20px", borderTop: "1px solid var(--border)" }}>
                  {[
                    { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>, label: "Organization", value: user.organization || "Not set" },
                    { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>, label: "Job Title", value: user.job_title || "Not set" },
                    { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S9 17.23 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>, label: "GitHub", value: user.github_login ? `@${user.github_login}` : "Not connected" },
                    { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>, label: "Member Since", value: fmtMonthYear(user.member_since) },
                  ].map(({ icon, label, value }) => (
                    <div key={label} style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                      <div style={{ width: 36, height: 36, borderRadius: "10px", flexShrink: 0, background: "var(--bg-card-hover)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)" }}>
                        {icon}
                      </div>
                      <div>
                        <div style={{ fontSize: "11px", color: "var(--text-faint)", fontWeight: 600, marginBottom: "3px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>{value}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {/* ═══ 2. PROGRESS OVERVIEW ═══ */}
          <div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.3px", margin: "0 0 16px" }}>Progress Overview</h2>
            {loading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "12px" }}>
                {[1,2,3,4].map(i => <Skeleton key={i} w="100%" h={130} radius={16} />)}
              </div>
            ) : po ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "12px" }}>
                <div style={{ padding: "20px 22px", borderRadius: "16px", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.15)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "#34d399", textTransform: "uppercase", letterSpacing: "0.5px" }}>Overall Progress</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
                  </div>
                  <div style={{ fontSize: "40px", fontWeight: 900, color: "var(--text-primary)", lineHeight: 1, marginBottom: "6px" }}>
                    {po.overall_delta >= 0 ? "+" : ""}{po.overall_delta.toFixed(0)}
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>points gained</div>
                </div>
                {[
                  { label: "Best Skill", value: po.best_skill ?? "—", sub: `${po.best_skill_score.toFixed(0)} / 100`, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="2"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>, subColor: "var(--text-secondary)" },
                  { label: "Most Improved", value: po.most_improved ?? "—", sub: `${po.most_improved_delta >= 0 ? "+" : ""}${po.most_improved_delta.toFixed(1)} points`, icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>, subColor: "#34d399" },
                  { label: "Focus Area", value: po.focus_area ?? "—", sub: "Needs attention", icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fb923c" strokeWidth="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>, subColor: "#fb923c" },
                ].map(({ label, value, sub, icon, subColor }) => (
                  <div key={label} style={{ padding: "20px 22px", borderRadius: "16px", background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "14px" }}>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
                      {icon}
                    </div>
                    <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-primary)", marginBottom: "6px", lineHeight: 1.2 }}>{value}</div>
                    <div style={{ fontSize: "12px", color: subColor, fontWeight: 600 }}>{sub}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* ═══ 3. SKILL TIMELINE ═══ */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "24px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.3px", margin: 0 }}>Skill Progress Timeline</h2>
              <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                {(["30","90","all"] as const).map(r => (
                  <button key={r} className={`time-btn${timeRange === r ? " active" : ""}`} onClick={() => setTimeRange(r)}>
                    {r === "all" ? "All Time" : `Last ${r} Days`}
                  </button>
                ))}
              </div>
            </div>
            {loading ? (
              <Skeleton w="100%" h={260} radius={12} />
            ) : filteredTimeline.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={filteredTimeline} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={fmtChartDate} tick={{ fontSize: 11 }} />
                  <YAxis domain={[60, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend wrapperStyle={{ fontSize: "12px", paddingTop: "16px" }} formatter={(value) => <span style={{ color: "var(--text-secondary)", fontSize: "11px" }}>{value}</span>} />
                  {CHART_LINES.map(l => (
                    <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={2} dot={{ r: 4, fill: l.color, strokeWidth: 0 }} activeDot={{ r: 6 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", fontSize: "13px" }}>
                No skill data yet. Complete a repository analysis to see your timeline.
              </div>
            )}
          </div>

          {/* ═══ 4. RECENT IMPROVEMENTS ═══ */}
          <div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.3px", margin: "0 0 16px" }}>Recent Skill Improvements</h2>
            {loading ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "12px" }}>
                {[1,2,3,4,5].map(i => <Skeleton key={i} w="100%" h={110} radius={14} />)}
              </div>
            ) : data?.recent_improvements.length ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: "12px" }}>
                {data.recent_improvements.map(imp => (
                  <div key={imp.skill} className="hover-card" style={{ padding: "18px 20px", borderRadius: "14px", background: "var(--bg-card)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "10px" }}>{imp.skill}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "8px" }}>
                      <span style={{ fontSize: "28px", fontWeight: 900, color: "var(--text-primary)", lineHeight: 1 }}>{imp.score.toFixed(0)}</span>
                      <DeltaBadge delta={imp.delta} />
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "10px" }}>Previous: {imp.previous.toFixed(0)}</div>
                    <div style={{ height: "4px", background: "var(--border)", borderRadius: "3px", overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: "3px", background: imp.delta >= 0 ? "#34d399" : "#f87171", width: `${Math.min(100, imp.score)}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "40px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "16px", color: "var(--text-muted)", fontSize: "13px" }}>
                No improvement data yet. Run two or more analyses to compare progress.
              </div>
            )}
          </div>

          {/* ═══ 5. RECENT ACTIVITY ═══ */}
          <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16, padding: "24px 28px" }}>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.3px", margin: "0 0 16px" }}>Recent Activity</h2>
            {loading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[1,2,3].map(i => <Skeleton key={i} w="100%" h={64} radius={12} />)}
              </div>
            ) : data?.recent_activity.length ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {data.recent_activity.slice(0, 5).map((act, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "14px", padding: "14px 16px", borderRadius: "12px", background: "var(--bg-card-hover)", border: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <div style={{ width: 38, height: 38, borderRadius: "10px", flexShrink: 0, background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                          </svg>
                        </div>
                        <div>
                          <div style={{ fontSize: "13.5px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "2px" }}>Repository analyzed</div>
                          <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                            {act.repo_name} · {fmtDate(act.completed_at || act.triggered_at)}
                          </div>
                        </div>
                      </div>
                      {act.score != null && <ScorePill score={act.score} />}
                      {act.status !== "completed" && (
                        <span style={{ padding: "3px 10px", borderRadius: "20px", background: "rgba(251,191,36,0.12)", color: "#fbbf24", fontSize: "11px", fontWeight: 700 }}>
                          {act.status}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                {data.recent_activity.length > 5 && (
                  <button className="prof-btn-ghost" style={{ width: "100%", marginTop: "12px", justifyContent: "center" }}>
                    View All Activity →
                  </button>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)", fontSize: "13px" }}>
                No activity yet. Analyze a repository to get started.
              </div>
            )}
          </div>

          {/* ═══ 6. SETTINGS ═══ */}
          <div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.3px", margin: "0 0 16px" }}>Profile Settings</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>, label: "Account Settings", desc: "Manage your account details and password", route: "/settings/account" },
                { icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S9 17.23 9 18v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>, label: "Connected Repositories", desc: "View and manage your linked repositories", route: "/settings/repositories" },
              ].map(({ icon, label, desc, route }) => (
                <div key={label} className="settings-row" onClick={() => navigate(route)}>
                  <div style={{ width: 36, height: 36, borderRadius: "10px", flexShrink: 0, background: "var(--bg-card-hover)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: "1px" }}>{label}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{desc}</div>
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}
