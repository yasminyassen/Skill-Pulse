import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/auth";
import DashboardLayout from "./DashboardLayout";

// ─── Types 

interface AnalysisResult {
  analysis_run_id: number;
  repo: string;
  branch: string;
  status: string;
  scores: {
    code_quality: number;
    maintainability: number;
    architecture: number;
    security_score: number;
    problem_solving: number;
    overall: number;
  };
  security_findings_count: number;
  ai_insights: Record<string, any>;
  completed_at: string | null;
}

// ─── Helpers 

const scoreColor = (s: number) => {
  if (s >= 80) return "#34d399";
  if (s >= 60) return "#fbbf24";
  if (s >= 40) return "#fb923c";
  return "#f87171";
};

const scoreGradient = (s: number) => {
  if (s >= 80) return "linear-gradient(135deg,#34d399,#059669)";
  if (s >= 60) return "linear-gradient(135deg,#fbbf24,#d97706)";
  if (s >= 40) return "linear-gradient(135deg,#fb923c,#ea580c)";
  return "linear-gradient(135deg,#f87171,#dc2626)";
};

const scoreLabel = (s: number) => {
  if (s >= 85) return "Excellent";
  if (s >= 70) return "Good";
  if (s >= 50) return "Average";
  if (s >= 30) return "Poor";
  return "Critical";
};

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));



function ScoreRing({
  value,
  size = 120,
  stroke = 6,
  label,
  delay = 0,
}: {
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
  delay?: number;
}) {
  const [animated, setAnimated] = useState(0);
  const color = scoreColor(value);
  const r = (size - stroke * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (animated / 100) * circ;

  useEffect(() => {
    const t = setTimeout(() => setAnimated(clamp(value)), 100 + delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: `stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1) ${delay}ms` }}
        />
      </svg>
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: size * 0.22, fontWeight: 900, color, lineHeight: 1, fontFamily: "'Syne',sans-serif" }}>
          {clamp(value)}
        </span>
        {label && (
          <span style={{ fontSize: size * 0.09, color: "rgba(255,255,255,0.35)", marginTop: 3, letterSpacing: "0.5px", textTransform: "uppercase" }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Horizontal score bar 

function ScoreBar({
  label,
  value,
  delay = 0,
  icon,
}: {
  label: string;
  value: number;
  delay?: number;
  icon?: React.ReactNode;
}) {
  const [width, setWidth] = useState(0);
  const color = scoreColor(value);

  useEffect(() => {
    const t = setTimeout(() => setWidth(clamp(value)), 200 + delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {icon && (
            <div style={{
              width: 28, height: 28, borderRadius: "8px",
              background: `${color}18`,
              border: `1px solid ${color}30`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color,
            }}>
              {icon}
            </div>
          )}
          <span style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>{label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{
            fontSize: "10px", fontWeight: 700, letterSpacing: "0.5px",
            textTransform: "uppercase", color,
            padding: "2px 7px", borderRadius: "999px",
            background: `${color}15`, border: `1px solid ${color}30`,
          }}>
            {scoreLabel(value)}
          </span>
          <span style={{ fontSize: "18px", fontWeight: 800, color, fontFamily: "'Syne',sans-serif", minWidth: 32, textAlign: "right" }}>
            {clamp(value)}
          </span>
        </div>
      </div>
      <div style={{ height: "8px", borderRadius: "999px", background: "rgba(255,255,255,0.05)", overflow: "hidden", position: "relative" }}>
        <div style={{
          height: "100%", borderRadius: "999px",
          background: scoreGradient(value),
          width: `${width}%`,
          transition: `width 1s cubic-bezier(.4,0,.2,1) ${delay}ms`,
          boxShadow: `0 0 12px ${color}50`,
        }} />
      </div>
    </div>
  );
}

// ─── Insight card

function InsightCard({
  title,
  content,
  accent = "#6366f1",
  icon,
  delay = 0,
}: {
  title: string;
  content: string | string[];
  accent?: string;
  icon: React.ReactNode;
  delay?: number;
}) {
  const items = Array.isArray(content) ? content : [content];
  return (
    <div
      className="insight-card"
      style={{
        padding: "20px 22px",
        borderRadius: "16px",
        background: `${accent}08`,
        border: `1px solid ${accent}20`,
        animationDelay: `${delay}ms`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
        <div style={{
          width: 32, height: 32, borderRadius: "9px",
          background: `${accent}18`, border: `1px solid ${accent}30`,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: accent,
        }}>
          {icon}
        </div>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: "0.2px" }}>
          {title}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {items.map((item, i) => (
          <div key={i} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
            <div style={{
              width: 5, height: 5, borderRadius: "50%",
              background: accent, flexShrink: 0, marginTop: 6,
            }} />
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.7 }}>
              {item}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat pill 

function StatPill({ label, value, color = "rgba(255,255,255,0.4)" }: {
  label: string; value: string | number; color?: string;
}) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "14px 20px", borderRadius: "12px",
      background: "rgba(255,255,255,0.03)",
      border: "1px solid rgba(255,255,255,0.07)",
      gap: "4px", minWidth: 90,
    }}>
      <span style={{ fontSize: "20px", fontWeight: 800, color, fontFamily: "'Syne',sans-serif" }}>{value}</span>
      <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</span>
    </div>
  );
}

// ─── Score icons 

const Icons = {
  code: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
    </svg>
  ),
  wrench: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
    </svg>
  ),
  blueprint: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
    </svg>
  ),
  brain: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9.5 2a2.5 2.5 0 0 1 5 0v.5"/><path d="M2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10H2z"/>
      <path d="M12 12V6.5"/>
    </svg>
  ),
  shield: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
  star: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  lightbulb: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="9" y1="18" x2="15" y2="18"/><line x1="10" y1="22" x2="14" y2="22"/>
      <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
    </svg>
  ),
  chart: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/>
      <line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  ),
};

// ─── Main

export default function AnalysisDetail() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const navigate = useNavigate();
  const role = localStorage.getItem("role") || "developer";

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [polling, setPolling] = useState(false);
  const [securityVisible, setSecurityVisible] = useState(true);
  const [visible, setVisible] = useState(false);

  const dashboardPath = `/dashboard/${role}/analysis`;

  // ── Fetch eval settings for recruiter
  useEffect(() => {
    if (role === "recruiter") {
      api.get("/recruiter/profile-dashboard")
        .then((res) => {
          const u = res.data?.user;
          if (u && u.security_score_visible !== undefined) {
            setSecurityVisible(u.security_score_visible);
          }
        })
        .catch(() => {});
    }
  }, [role]);

  // ── Fetch / poll ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!analysisId) { setNotFound(true); setLoading(false); return; }

    const fetchResult = async () => {
      try {
        const res = await api.get(`/analysis/${analysisId}`);
        const data = res.data;
        if (data.status === "pending" && !data.analysis_run_id) {
          setNotFound(true); setLoading(false); return;
        }
        setResult(data); setLoading(false);
        setPolling(data.status === "running" || data.status === "pending");
        setTimeout(() => setVisible(true), 60);
      } catch (err: any) {
        if (err.response?.status === 401) { localStorage.clear(); window.location.href = "/login"; return; }
        setNotFound(true); setLoading(false);
      }
    };

    fetchResult();
  }, [analysisId]);

  // ── Polling 
  useEffect(() => {
    if (!polling || !analysisId) return;
    const iv = setInterval(async () => {
      try {
        const res = await api.get(`/analysis/${analysisId}`);
        setResult(res.data);
        if (res.data.status === "completed" || res.data.status === "failed") {
          setPolling(false); clearInterval(iv);
          setTimeout(() => setVisible(true), 60);
        }
      } catch { clearInterval(iv); }
    }, 3000);
    return () => clearInterval(iv);
  }, [polling, analysisId]);

  const repoName = result?.repo?.split("/").pop() ?? result?.repo ?? "Repository";
  const repoOrg  = result?.repo?.split("/")[0] ?? "";

  // ── Parse ai_insights keys smartly 
  const insights = result?.ai_insights ?? {};

  const getInsightArr = (key: string): string[] => {
    const val = insights[key];
    if (!val) return [];
    if (Array.isArray(val)) return val.map(String);
    if (typeof val === "string") return val.split(/\n|•|\-/).map(s => s.trim()).filter(Boolean);
    return [String(val)];
  };

  const strengths    = getInsightArr("strengths")    || getInsightArr("strong_points");
  const improvements = getInsightArr("improvements") || getInsightArr("weaknesses") || getInsightArr("areas_for_improvement");
  const summary      = typeof insights.summary === "string" ? insights.summary : null;
  const recommendations = getInsightArr("recommendations") || getInsightArr("suggestions");

  // extra catch-all keys
  const knownKeys = new Set(["summary","strengths","strong_points","improvements","weaknesses","areas_for_improvement","recommendations","suggestions"]);
  const extraInsights = Object.entries(insights).filter(([k]) => !knownKeys.has(k));

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=DM+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&display=swap');

        @keyframes spin    { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }
        @keyframes fadeUp  { from{opacity:0;transform:translateY(18px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.8)} }
        @keyframes glow    { 0%,100%{box-shadow:0 0 20px rgba(99,102,241,0.15)} 50%{box-shadow:0 0 40px rgba(99,102,241,0.35)} }

        .sk {
          background: linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.04) 75%);
          background-size: 400% 100%;
          animation: shimmer 1.5s ease-in-out infinite;
        }
        .fade-up {
          opacity: 0;
          animation: fadeUp 0.55s cubic-bezier(.22,1,.36,1) forwards;
        }
        .insight-card {
          opacity: 0;
          animation: fadeUp 0.55s cubic-bezier(.22,1,.36,1) forwards;
        }
        .pulse { animation: pulse 1.4s ease-in-out infinite; }
        .glow  { animation: glow 2.5s ease-in-out infinite; }

        .back-btn:hover { background: rgba(255,255,255,0.08) !important; color: white !important; }
        .tag-btn:hover  { background: rgba(99,102,241,0.15) !important; }
        .score-card     { transition: transform 0.2s, border-color 0.2s; }
        .score-card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.14) !important; }
      `}</style>

      <div style={{
        minHeight: "100vh",
        padding: "32px 40px 80px",
        fontFamily: "'DM Sans', sans-serif",
        color: "rgba(226,232,240,0.9)",
        background: "radial-gradient(circle at 15% 0%, rgba(99,102,241,0.12), transparent 50%), radial-gradient(circle at 85% 10%, rgba(236,72,153,0.08), transparent 40%), #09090f",
        maxWidth: 900,
      }}>

        {/* ── Back ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "32px" }}>
          <button
            className="back-btn"
            onClick={() => navigate(dashboardPath)}
            style={{
              width: 38, height: 38, borderRadius: "11px",
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "rgba(255,255,255,0.4)", cursor: "pointer", flexShrink: 0,
              transition: "all 0.15s",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div>
            <h1 style={{
              fontFamily: "'Syne',sans-serif", fontSize: "21px", fontWeight: 800,
              color: "white", margin: 0, letterSpacing: "-0.4px",
            }}>
              {loading ? "Loading…" : notFound ? "Not Found" : repoName}
            </h1>
            {result && (
              <p style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.3)", margin: "2px 0 0" }}>
                {result.repo} · {result.branch}
              </p>
            )}
          </div>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="sk" style={{ height: 160, borderRadius: 20 }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div className="sk" style={{ height: 260, borderRadius: 20 }} />
              <div className="sk" style={{ height: 260, borderRadius: 20 }} />
            </div>
            <div className="sk" style={{ height: 200, borderRadius: 20 }} />
          </div>
        )}

        {/* ── Not found ── */}
        {!loading && notFound && (
          <div style={{ textAlign: "center", padding: "72px 32px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 24 }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "#f87171" }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: "22px", fontWeight: 800, color: "white", margin: "0 0 10px" }}>Analysis Not Found</h2>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: "0 0 28px", maxWidth: 360, marginLeft: "auto", marginRight: "auto", lineHeight: 1.7 }}>
              This analysis doesn't exist or you don't have permission to view it.
            </p>
            <button onClick={() => navigate(dashboardPath)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: "#6366f1", color: "white", fontSize: "13.5px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
              Back to Analyses
            </button>
          </div>
        )}

        {/* ── Running ── */}
        {!loading && !notFound && result && (result.status === "running" || result.status === "pending") && (
          <div style={{ textAlign: "center", padding: "72px 32px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 24 }}>
            <div className="glow" style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "#818cf8" }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" style={{ animation: "spin 2s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            </div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: "22px", fontWeight: 800, color: "white", margin: "0 0 10px" }}>Analysis in Progress</h2>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: "0 0 6px", lineHeight: 1.7 }}>
              <strong style={{ color: "rgba(255,255,255,0.6)" }}>{repoName}</strong> is being analyzed right now.
            </p>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)", margin: "0 0 28px" }}>This page updates automatically.</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: "rgba(255,255,255,0.3)", fontSize: "12px" }}>
              <span className="pulse" style={{ width: 6, height: 6, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
              Polling for updates…
            </div>
          </div>
        )}

        {/* ── Failed ── */}
        {!loading && !notFound && result?.status === "failed" && (
          <div style={{ textAlign: "center", padding: "72px 32px", background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.15)", borderRadius: 24 }}>
            <div style={{ width: 72, height: 72, borderRadius: 20, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "#f87171" }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            </div>
            <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: "22px", fontWeight: 800, color: "white", margin: "0 0 10px" }}>Analysis Failed</h2>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: "0 0 28px", lineHeight: 1.7 }}>
              Something went wrong analyzing <strong style={{ color: "rgba(255,255,255,0.6)" }}>{repoName}</strong>.
            </p>
            <button onClick={() => navigate(dashboardPath)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: "#6366f1", color: "white", fontSize: "13.5px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" }}>
              Try Again
            </button>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            COMPLETED RESULT
        ══════════════════════════════════════════════════════════════════ */}
        {!loading && !notFound && result?.status === "completed" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

            {/* ── Hero ── */}
            <div
              className="fade-up"
              style={{
                padding: "28px 32px",
                borderRadius: 22,
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.08)",
                display: "flex", alignItems: "center", gap: 32,
                animationDelay: "0ms",
                position: "relative", overflow: "hidden",
              }}
            >
              {/* Soft glow behind ring */}
              <div style={{
                position: "absolute", left: 10, top: "50%",
                transform: "translateY(-50%)",
                width: 160, height: 160, borderRadius: "50%",
                background: `radial-gradient(circle, ${scoreColor(result.scores.overall)}18, transparent 70%)`,
                pointerEvents: "none",
              }} />

              <ScoreRing value={result.scores.overall} size={110} stroke={7} label="Overall" />

              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <div style={{
                    padding: "3px 10px", borderRadius: 999,
                    background: "rgba(99,102,241,0.12)",
                    border: "1px solid rgba(99,102,241,0.3)",
                    fontSize: "10px", fontWeight: 700, letterSpacing: "0.7px",
                    color: "#818cf8", textTransform: "uppercase",
                  }}>
                    {repoOrg}
                  </div>
                  <div style={{
                    padding: "3px 10px", borderRadius: 999,
                    background: `${scoreColor(result.scores.overall)}12`,
                    border: `1px solid ${scoreColor(result.scores.overall)}30`,
                    fontSize: "10px", fontWeight: 700,
                    color: scoreColor(result.scores.overall), textTransform: "uppercase",
                  }}>
                    {scoreLabel(result.scores.overall)}
                  </div>
                </div>

                <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: "20px", fontWeight: 800, color: "white", margin: "0 0 6px" }}>
                  {repoName}
                </h2>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", fontSize: "12px", color: "rgba(255,255,255,0.35)", marginBottom: 16 }}>
                  <span>Branch: <strong style={{ color: "rgba(255,255,255,0.55)" }}>{result.branch}</strong></span>
                  <span>
                    Security findings: <strong style={{ color: result.security_findings_count > 0 ? "#f87171" : "#34d399" }}>
                      {result.security_findings_count}
                    </strong>
                  </span>
                  {result.completed_at && (
                    <span>Completed: <strong style={{ color: "rgba(255,255,255,0.55)" }}>
                      {new Date(result.completed_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </strong></span>
                  )}
                </div>

                <button
                  className="tag-btn"
                  onClick={() => navigate(`/dashboard/developer/analysis?highlight=${result.analysis_run_id}`)}
                  style={{
                    padding: "8px 16px", borderRadius: 9,
                    border: "1px solid rgba(99,102,241,0.3)",
                    background: "rgba(99,102,241,0.08)",
                    color: "#818cf8", fontSize: "12.5px", fontWeight: 600,
                    cursor: "pointer", fontFamily: "'DM Sans',sans-serif",
                    display: "inline-flex", alignItems: "center", gap: 6,
                    transition: "background 0.15s",
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                  </svg>
                  View in Analysis Dashboard
                </button>
              </div>

              {/* Mini stat pills */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
                <StatPill label="Run ID" value={`#${result.analysis_run_id}`} color="rgba(255,255,255,0.5)" />
                <StatPill
                  label="Security"
                  value={result.security_findings_count === 0 ? "Clean" : `${result.security_findings_count} issues`}
                  color={result.security_findings_count === 0 ? "#34d399" : "#f87171"}
                />
              </div>
            </div>

            {/* ── Score breakdown + mini rings ── */}
            <div
              className="fade-up"
              style={{
                padding: "26px 28px",
                borderRadius: 22,
                background: "rgba(255,255,255,0.025)",
                border: "1px solid rgba(255,255,255,0.07)",
                animationDelay: "80ms",
              }}
            >
              <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: "15px", fontWeight: 800, color: "white", margin: "0 0 20px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#6366f1" }}>{Icons.chart}</span>
                Score Breakdown
              </h2>

              {/* Mini ring row */}
              <div style={{ display: "flex", gap: 16, justifyContent: "space-around", marginBottom: 28, flexWrap: "wrap" }}>
                {[
                  { label: "Code", value: result.scores.code_quality },
                  { label: "Architecture", value: result.scores.architecture },
                  { label: "Problem\nSolving", value: result.scores.problem_solving },
                  { label: "Maintain.", value: result.scores.maintainability },
                  ...(securityVisible ? [{ label: "Security", value: result.scores.security_score }] : []),
                ].map((item, i) => (
                  <div key={item.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <ScoreRing value={item.value} size={68} stroke={5} delay={i * 100} />
                    <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.4)", textAlign: "center", whiteSpace: "pre-line", textTransform: "uppercase", letterSpacing: "0.4px" }}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>

              {/* Detailed bars */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16, borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 20 }}>
                <ScoreBar label="Code Quality"    value={result.scores.code_quality}    delay={0}   icon={Icons.code}      />
                <ScoreBar label="Architecture"    value={result.scores.architecture}    delay={60}  icon={Icons.blueprint}  />
                <ScoreBar label="Problem Solving" value={result.scores.problem_solving} delay={120} icon={Icons.brain}     />
                <ScoreBar label="Maintainability" value={result.scores.maintainability} delay={180} icon={Icons.wrench}    />
                {securityVisible && (
                  <ScoreBar label="Security"      value={result.scores.security_score}  delay={240} icon={Icons.shield}    />
                )}
              </div>

              {/* Security hidden notice */}
              {!securityVisible && (
                <div style={{
                  marginTop: 16, padding: "10px 14px", borderRadius: 10,
                  background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)",
                  fontSize: "12px", color: "rgba(251,191,36,0.7)", fontWeight: 600,
                  display: "flex", alignItems: "center", gap: 8,
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  Security score is hidden by your evaluation settings
                </div>
              )}
            </div>



          </div>
        )}
      </div>
    </DashboardLayout>
  );
}