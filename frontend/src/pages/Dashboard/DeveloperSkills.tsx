import { useState, useEffect } from "react";
import api, { API_BASE_URL } from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SkillsSummary {
  overall: number;
  delta: number;
  viewer?: {
    has_github_identity: boolean;
    github_login: string | null;
  };
  scores: {
    code_quality: number;
    maintainability: number;
    architecture: number;
    problem_solving: number;
  };
  deltas: {
    code_quality: number;
    maintainability: number;
    architecture: number;
    problem_solving: number;
  };
  repos: Array<{
    analysis_id: number;
    repo_name: string;
    full_name: string;
    branch: string;
    completed_at: string | null;
    is_private: boolean;
    analysis_context?: AnalysisContext;
  }>;
}

interface AnalysisContext {
  has_github_identity: boolean;
  github_login: string | null;
  is_private: boolean;
  user_contributed: boolean;
  commit_count_sample: number;
  latest_commit_at: string | null;
}

interface DetailedAnalysis {
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
  detailed_metrics: {
    code_quality: {
      python_files: number;
      total_loc: number;
      avg_cyclomatic_complexity: number;
      avg_duplication_score: number;
      style_violations: number;
      unused_variables: number;
    };
    maintainability: {
      avg_docstring_coverage: number;
      missing_docstrings: number;
      avg_maintainability_index: number;
      avg_comment_ratio: number;
      long_functions: number;
      too_many_params: number;
    };
    architecture: {
      import_coupling_total: number;
      max_inheritance_depth: number;
      avg_nesting_depth: number;
      avg_function_size: number;
      deep_nesting: number;
    };
    problem_solving: {
      test_files: number;
      avg_test_function_ratio: number;
      avg_cyclomatic_complexity: number;
      long_functions: number;
    };
  };
  security: {
    findings_count: number;
    severity_distribution: { HIGH: number; MEDIUM: number; LOW: number };
  };
  ai_insights: {
    skills_insights?: {
      code_quality?: string[];
      maintainability?: string[];
      architecture?: string[];
      problem_solving?: string[];
    };
    security_insights?: string;
  };
  completed_at: string | null;
  analysis_context?: AnalysisContext;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const scoreColor = (s: number) => {
  if (s >= 80) return "#34d399";
  if (s >= 60) return "#fbbf24";
  return "#f87171";
};

const barColor = (s: number) => {
  if (s >= 80) return "linear-gradient(90deg,#34d399,#10b981)";
  if (s >= 60) return "linear-gradient(90deg,#fbbf24,#f59e0b)";
  return "linear-gradient(90deg,#f87171,#ef4444)";
};

const fmt = (n: number, decimals = 1) =>
  Number.isFinite(n) ? n.toFixed(decimals) : "—";

const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function CircleRing({
  value,
  size = 80,
  stroke = 6,
  accent = "#6366f1",
}: {
  value: number;
  size?: number;
  stroke?: number;
  accent?: string;
}) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const filled = (Math.min(Math.max(value, 0), 100) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={accent}
        strokeWidth={stroke}
        strokeDasharray={`${filled} ${circ}`}
        strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)" }}
      />
    </svg>
  );
}

function ScoreRing({ value, size = 80 }: { value: number; size?: number }) {
  const color = scoreColor(value);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <CircleRing value={value} size={size} stroke={6} accent={color} />
      <div style={{
        position: "absolute", inset: 0,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      }}>
        <span style={{ fontSize: size * 0.26, fontWeight: 800, color: "white", lineHeight: 1 }}>
          {Math.round(value)}
        </span>
        <span style={{ fontSize: size * 0.14, color: "rgba(255,255,255,0.35)" }}>/ 100</span>
      </div>
    </div>
  );
}

function DeltaBadge({ delta, large = false }: { delta: number; large?: boolean }) {
  if (delta === 0) return null;
  const pos = delta > 0;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: "4px",
      padding: large ? "4px 10px" : "2px 7px",
      borderRadius: "20px",
      background: pos ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.12)",
      color: pos ? "#34d399" : "#f87171",
      fontSize: large ? "13px" : "11px",
      fontWeight: 700,
    }}>
      {pos ? "▲" : "▼"} {pos ? "+" : ""}{Math.abs(delta).toFixed(1)} pts
    </span>
  );
}

function MetricBar({
  label,
  value,
  sub,
  max = 100,
}: { label: string; value: number; sub?: string; max?: number }) {
  const pctVal = Math.min(100, (value / max) * 100);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: "15px", fontWeight: 700, color: "white" }}>{Math.round(value)}</span>
      </div>
      {sub && (
        <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginTop: "-4px" }}>{sub}</div>
      )}
      <div style={{ height: "4px", background: "rgba(255,255,255,0.07)", borderRadius: "3px", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: "3px",
          background: barColor(value),
          width: `${pctVal}%`,
          transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
        }} />
      </div>
    </div>
  );
}

function InsightBox({ lines }: { lines: string[] }) {
  return (
    <div style={{
      marginTop: "16px",
      padding: "14px 16px",
      background: "rgba(99,102,241,0.06)",
      border: "1px solid rgba(99,102,241,0.15)",
      borderRadius: "12px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "10px" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <span style={{ fontSize: "11.5px", fontWeight: 700, color: "#818cf8", letterSpacing: "0.4px" }}>AI Contribution Guidance</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
        {lines.map((l, i) => (
          <li key={i} style={{ display: "flex", gap: "8px", fontSize: "12.5px", color: "rgba(255,255,255,0.5)", lineHeight: 1.55 }}>
            <span style={{ color: "#818cf8", flexShrink: 0, marginTop: "1px" }}>•</span>
            <span>{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "16px", padding: "28px",
      marginBottom: "16px",
    }}>
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
        <div className="sk" style={{ width: "80px", height: "80px", borderRadius: "50%" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="sk" style={{ height: "18px", width: "40%" }} />
          <div className="sk" style={{ height: "13px", width: "60%" }} />
          <div className="sk" style={{ height: "28px", width: "22%", borderRadius: "20px" }} />
        </div>
      </div>
    </div>
  );
}

function connectGithub() {
  const token = localStorage.getItem("token");
  if (token) {
    window.location.href = `${API_BASE_URL}/auth/github?action=connect&token=${token}`;
  }
}

function ModeNotice({
  hasGithubIdentity,
  context,
  selected,
  accent,
}: {
  hasGithubIdentity: boolean;
  context?: AnalysisContext;
  selected: boolean;
  accent: string;
}) {
  const contributed = Boolean(context?.user_contributed);
  const githubLogin = context?.github_login;

  let title = "Connect GitHub to Start";
  let body = "Developer skills are calculated only from your own GitHub contributions. Connect GitHub, then analyze a repository where your account has commits.";
  let tone = accent;

  if (hasGithubIdentity && selected && contributed) {
    title = "Developer Contribution Analysis";
    body = `Connected as ${githubLogin}. These results are based on Python files touched by your commits in this repository.`;
    tone = "#34d399";
  } else if (hasGithubIdentity && selected) {
    title = "No Contribution Analysis Available";
    body = `Connected as ${githubLogin || "GitHub user"}. This repository will only appear here when SkillPulse finds analyzable commits from this account.`;
    tone = "#fbbf24";
  } else if (hasGithubIdentity) {
    title = "Select a Contribution Analysis";
    body = `Connected as ${summaryGithubName(githubLogin)}. Only repositories with your contribution analysis are listed here.`;
  }

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: "14px",
      padding: "18px 20px",
      background: `${tone}0F`,
      border: `1px solid ${tone}35`,
      borderRadius: "14px",
      marginBottom: "24px",
    }}>
      <div style={{
        width: "34px",
        height: "34px",
        borderRadius: "10px",
        background: `${tone}18`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: tone,
      }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "white", marginBottom: "4px" }}>
          {title}
        </div>
        <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
          {body}
        </div>
        {!hasGithubIdentity && (
          <button
            onClick={connectGithub}
            style={{
              marginTop: "12px",
              padding: "8px 14px",
              border: "none",
              borderRadius: "9px",
              background: `linear-gradient(135deg, ${accent}, #ec4899)`,
              color: "white",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Connect GitHub
          </button>
        )}
      </div>
    </div>
  );
}

function summaryGithubName(login?: string | null) {
  return login ? login : "your GitHub account";
}

// ─── Dimension configs ────────────────────────────────────────────────────────

const DIMENSIONS = [
  {
    key: "code_quality" as const,
    label: "Code Quality",
    desc: "Measures quality signals in the Python files touched by your commits",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
      </svg>
    ),
    getMetrics: (d: DetailedAnalysis) => {
      const m = d.detailed_metrics?.code_quality || {};
      const dup = Math.round((m.avg_duplication_score || 0) * 100);
      return [
        { label: "Code Smells",       value: Math.max(0, 100 - (m.style_violations || 0) * 2),   sub: `${m.style_violations ?? 0} found` },
        { label: "Style Violations",  value: Math.max(0, 100 - (m.style_violations || 0) * 3),   sub: `${m.style_violations ?? 0} total` },
        { label: "Unused Variables",  value: Math.max(0, 100 - (m.unused_variables || 0) * 5),   sub: `${m.unused_variables ?? 0} instances` },
        { label: "Code Duplication",  value: Math.max(0, 100 - dup),                             sub: `${dup}%` },
      ];
    },
    getInsights: (d: DetailedAnalysis) => d.ai_insights?.skills_insights?.code_quality || [],
  },
  {
    key: "maintainability" as const,
    label: "Maintainability",
    desc: "Evaluates maintainability of the contribution-affected code",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    getMetrics: (d: DetailedAnalysis) => {
      const m = d.detailed_metrics?.maintainability || {};
      return [
        { label: "Documentation Coverage", value: Math.round((m.avg_docstring_coverage || 0) * 100), sub: pct(m.avg_docstring_coverage || 0) },
        { label: "Test Coverage",          value: Math.min(100, Math.round((m.avg_maintainability_index || 0))),            sub: `${Math.round(m.avg_maintainability_index || 0)}%` },
        { label: "Code Comments",          value: Math.min(100, Math.round((m.avg_comment_ratio || 0) * 200)), sub: m.avg_comment_ratio ? "Adequate" : "Low" },
        { label: "Complexity Score",       value: Math.max(0, 100 - (m.long_functions || 0) * 5),            sub: (m.long_functions || 0) > 3 ? "High" : "Medium" },
      ];
    },
    getInsights: (d: DetailedAnalysis) => d.ai_insights?.skills_insights?.maintainability || [],
  },
  {
    key: "architecture" as const,
    label: "Architecture",
    desc: "Assesses structure and coupling around the files you contributed to",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" />
      </svg>
    ),
    getMetrics: (d: DetailedAnalysis) => {
      const m = d.detailed_metrics?.architecture || {};
      const coupling = Math.max(0, 100 - (m.import_coupling_total || 0) * 2);
      const inherit  = Math.max(0, 100 - (m.max_inheritance_depth || 0) * 10);
      const fnSize   = Math.max(0, 100 - Math.max(0, (m.avg_function_size || 0) - 20) * 2);
      return [
        { label: "Class Design",       value: Math.min(100, coupling + 10),          sub: coupling > 70 ? "Good" : "Needs work" },
        { label: "Coupling",           value: coupling,                              sub: coupling > 70 ? "Low" : "High" },
        { label: "Function Size",      value: fnSize,                                sub: `${fmt(m.avg_function_size || 0, 0)} LOC avg` },
        { label: "Inheritance Depth",  value: inherit,                               sub: `${m.max_inheritance_depth ?? 0} levels` },
      ];
    },
    getInsights: (d: DetailedAnalysis) => d.ai_insights?.skills_insights?.architecture || [],
  },
  {
    key: "problem_solving" as const,
    label: "Problem Solving",
    desc: "Analyzes complexity and problem-solving signals in your contribution area",
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
    getMetrics: (d: DetailedAnalysis) => {
      const m = d.detailed_metrics?.problem_solving || {};
      const cc = m.avg_cyclomatic_complexity || 0;
      const ccScore = Math.max(0, 100 - Math.max(0, cc - 3) * 8);
      return [
        { label: "Cyclomatic Complexity", value: ccScore,                                          sub: cc < 5 ? "Low" : cc < 10 ? "Medium" : "High" },
        { label: "Nesting Depth",         value: Math.max(0, 100 - (d.detailed_metrics?.architecture?.avg_nesting_depth || 0) * 20), sub: `${fmt(d.detailed_metrics?.architecture?.avg_nesting_depth || 0)} avg` },
        { label: "Modularity",            value: Math.max(0, 100 - (m.long_functions || 0) * 4),  sub: (m.long_functions || 0) === 0 ? "High" : "Medium" },
        { label: "Algorithm Efficiency",  value: Math.max(0, 100 - Math.max(0, cc - 2) * 6),      sub: ccScore > 70 ? "Good" : "Needs work" },
      ];
    },
    getInsights: (d: DetailedAnalysis) => d.ai_insights?.skills_insights?.problem_solving || [],
  },
];

// ─── Main component ───────────────────────────────────────────────────────────

export default function DeveloperSkills() {
  const role = localStorage.getItem("role") || "developer";
  const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";

  const [summary, setSummary]     = useState<SkillsSummary | null>(null);
  const [detail,  setDetail]      = useState<DetailedAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingDetail,  setLoadingDetail]  = useState(false);

  // ── Fetch summary ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/analysis/skills/summary");
        setSummary(res.data);
      } catch (err: any) {
        if (err.response?.status === 401) {
          localStorage.clear();
          window.location.href = "/login";
        }
      } finally {
        setLoadingSummary(false);
      }
    })();
  }, []);

  // ── Fetch detail when repo selected ───────────────────────────────────────
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    (async () => {
      setLoadingDetail(true);
      try {
        const res = await api.get(`/analysis/${selectedId}/detailed-metrics`);
        setDetail(res.data);
      } finally {
        setLoadingDetail(false);
      }
    })();
  }, [selectedId]);

  const scores  = summary?.scores;
  const deltas  = summary?.deltas;
  const overall = summary?.overall ?? 0;
  const selectedRepo = summary?.repos.find(r => r.analysis_id === selectedId);
  const activeContext = detail?.analysis_context || selectedRepo?.analysis_context;
  const hasGithubIdentity = Boolean(summary?.viewer?.has_github_identity || activeContext?.has_github_identity);
  const scoreTitle = "Overall Contribution Score";
  const scoreSubtitle = hasGithubIdentity
    ? "Aggregated only from repositories where SkillPulse analyzed your GitHub contributions"
    : "Connect GitHub to analyze repositories from your own contributions";

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');

        .sk {
          background: linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.04) 75%);
          background-size: 400% 100%;
          animation: shimmer 1.5s ease-in-out infinite;
          border-radius: 8px;
        }
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }

        .dim-card {
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px; padding: 24px 28px;
          margin-bottom: 16px;
          transition: border-color 0.2s;
        }
        .dim-card:hover { border-color: rgba(255,255,255,0.12); }

        .sp-select {
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px;
          color: white;
          font-family: 'DM Sans', sans-serif;
          font-size: 13.5px;
          padding: 9px 14px;
          outline: none; cursor: pointer;
          transition: border-color 0.2s;
          min-width: 220px;
        }
        .sp-select:focus { border-color: ${accent}80; }
        .sp-select option { background: #1a1a2e; }

        .metrics-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px 32px;
          margin-top: 18px;
        }
      `}</style>

      <div style={{
        padding: "32px 36px",
        maxWidth: "920px",
        fontFamily: "'DM Sans', sans-serif",
      }}>

        {/* ── Page header ── */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "26px", fontWeight: 800,
            color: "white", letterSpacing: "-0.5px",
            margin: "0 0 6px",
          }}>
            Developer Contribution Dashboard
          </h1>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
            Skill scores based only on your own GitHub contribution scope
          </p>
        </div>

        {!loadingSummary && summary && (
          <ModeNotice
            hasGithubIdentity={hasGithubIdentity}
            context={activeContext}
            selected={Boolean(selectedId)}
            accent={accent}
          />
        )}

        {/* ── Overall Score Card ── */}
        <div style={{
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "16px", padding: "28px 32px",
          marginBottom: "24px",
        }}>
          {/* Header row */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.6)", marginBottom: "2px" }}>
                {scoreTitle}
              </div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
                {scoreSubtitle}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {loadingSummary
                ? <div className="sk" style={{ width: "80px", height: "40px" }} />
                : (
                  <>
                    <div style={{ fontSize: "42px", fontWeight: 800, color: "white", lineHeight: 1, letterSpacing: "-2px" }}>
                      {overall.toFixed(1)}
                    </div>
                    <div style={{ marginTop: "4px", display: "flex", justifyContent: "flex-end" }}>
                      {summary && <DeltaBadge delta={summary.delta} large />}
                    </div>
                  </>
                )}
            </div>
          </div>

          {/* 4 rings */}
          {loadingSummary ? (
            <div style={{ display: "flex", gap: "24px" }}>
              {[1,2,3,4].map(i => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <div className="sk" style={{ width: "80px", height: "80px", borderRadius: "50%" }} />
                  <div className="sk" style={{ width: "80px", height: "14px" }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              {DIMENSIONS.map(dim => {
                const val   = scores?.[dim.key] ?? 0;
                const delta = deltas?.[dim.key] ?? 0;
                return (
                  <div key={dim.key} style={{ flex: 1, minWidth: "140px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                    <ScoreRing value={val} size={80} />
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.75)", marginBottom: "4px" }}>
                        {dim.label}
                      </div>
                      <DeltaBadge delta={delta} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Repo selector ── */}
        <div style={{
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "16px", padding: "20px 28px",
          marginBottom: "24px",
          display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.5)", fontWeight: 500, whiteSpace: "nowrap" }}>
            View your contribution analysis for:
          </span>
          {loadingSummary ? (
            <div className="sk" style={{ width: "220px", height: "36px", borderRadius: "10px" }} />
          ) : (
            <select
              className="sp-select"
              value={selectedId ?? ""}
              onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select a repository…</option>
              {summary?.repos.map(r => (
                <option key={r.analysis_id} value={r.analysis_id}>
                  {r.repo_name} ({r.branch}) - {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "latest"}
                </option>
              ))}
            </select>
          )}
          {!selectedId && !loadingSummary && (
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.25)", width: "100%" }}>
              Select a repository to view metrics and AI guidance for the files touched by your commits.
            </span>
          )}
        </div>

        {selectedId && activeContext && (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "12px",
            marginBottom: "24px",
          }}>
            <div style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "6px", fontWeight: 700 }}>
                GitHub Identity
              </div>
              <div style={{ fontSize: "14px", color: "white", fontWeight: 700 }}>
                {activeContext.has_github_identity ? activeContext.github_login : "Not connected"}
              </div>
            </div>
            <div style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "6px", fontWeight: 700 }}>
                Repository Access
              </div>
              <div style={{ fontSize: "14px", color: "white", fontWeight: 700 }}>
                {activeContext.is_private ? "Private repository" : "Public repository"}
              </div>
            </div>
            <div style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: "6px", fontWeight: 700 }}>
                Contribution Scope
              </div>
              <div style={{ fontSize: "14px", color: activeContext.user_contributed ? "#34d399" : "white", fontWeight: 700 }}>
                {activeContext.user_contributed
                  ? `${activeContext.commit_count_sample || 1}+ commits found`
                  : activeContext.has_github_identity
                    ? "Not available"
                    : "Connect GitHub to check"}
              </div>
            </div>
          </div>
        )}

        {/* ── Dimension cards ── */}
        {selectedId && (
          <>
            {loadingDetail ? (
              <>{[1,2,3,4].map(i => <SkeletonCard key={i} />)}</>
            ) : detail ? (
              DIMENSIONS.map(dim => {
                const score    = detail.scores[dim.key === "problem_solving" ? "problem_solving" : dim.key as keyof typeof detail.scores] ?? 0;
                const delta    = deltas?.[dim.key] ?? 0;
                const metrics  = dim.getMetrics(detail);
                const insights = dim.getInsights(detail);
                return (
                  <div key={dim.key} className="dim-card">
                    {/* Header */}
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", flex: 1 }}>
                        {/* Icon */}
                        <div style={{
                          width: "38px", height: "38px", borderRadius: "10px", flexShrink: 0,
                          background: `${accent}18`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: accent,
                        }}>
                          {dim.icon}
                        </div>
                        {/* Title */}
                        <div>
                          <div style={{ fontSize: "16px", fontWeight: 700, color: "white", marginBottom: "3px" }}>
                            {dim.label}
                          </div>
                          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>
                            {dim.desc}
                          </div>
                          <div style={{ marginTop: "8px" }}>
                            <DeltaBadge delta={delta} />
                          </div>
                        </div>
                      </div>

                      {/* Ring */}
                      <ScoreRing value={score} size={72} />
                    </div>

                    {/* Key Metrics */}
                    <div style={{ marginTop: "20px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "14px" }}>
                        Contribution Signals
                      </div>
                      <div className="metrics-grid">
                        {metrics.map((m, i) => (
                          <MetricBar key={i} label={m.label} value={m.value} sub={m.sub} />
                        ))}
                      </div>
                    </div>

                    {/* AI Guidance */}
                    {insights.length > 0 && <InsightBox lines={insights} />}
                    {insights.length === 0 && (
                      <div style={{
                        marginTop: "14px", padding: "12px 16px",
                        background: "rgba(255,255,255,0.03)",
                        borderRadius: "10px",
                        fontSize: "12px", color: "rgba(255,255,255,0.2)",
                      }}>
                        AI guidance is not available for this dimension yet.
                      </div>
                    )}
                  </div>
                );
              })
            ) : null}
          </>
        )}

        {/* ── Empty state (no repo selected, not loading) ── */}
        {!selectedId && !loadingSummary && summary && summary.repos.length === 0 && (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "16px",
          }}>
            <div style={{
              width: "60px", height: "60px", borderRadius: "16px",
              background: `${accent}15`,
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 16px",
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="6" /><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
              </svg>
            </div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: "6px" }}>
              No contribution analyses yet
            </div>
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)" }}>
              Connect GitHub and analyze a repository where your account has commits.
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
