import { useEffect, useMemo, useState, type CSSProperties } from "react";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

interface RepoOption {
  analysis_id: number;
  repo_name: string;
  full_name: string;
  branch: string;
  completed_at: string | null;
}

interface SkillGap {
  domain: string;
  score: number;
  gap: number;
  priority: "High" | "Medium" | "Low";
  target_difficulty: "Beginner" | "Intermediate" | "Advanced";
  estimated_gain: number;
}

interface ResourceItem {
  id: string;
  title: string;
  provider: string;
  type: string;
  difficulty: string;
  topics: string[];
  duration: string;
  rating: number;
  url: string;
  pages?: number;
  explanation?: string;
  expected_gain?: number;
  final_score?: number;
}

interface LearningPayload {
  analysis_run_id: number;
  repo: string;
  branch: string;
  scores: {
    code_quality: number;
    maintainability: number;
    architecture: number;
    problem_solving: number;
    security_score: number;
    overall: number;
  };
  issues: string[];
  skill_gaps: SkillGap[];
  recommendations: ResourceItem[];
  security_focus: {
    enabled: boolean;
    threshold: number;
    resources: ResourceItem[];
  };
  generated_at: string;
}

const priorityColors: Record<string, { fg: string; bg: string; border: string }> = {
  High: { fg: "#fb7185", bg: "rgba(251,113,133,0.12)", border: "rgba(251,113,133,0.35)" },
  Medium: { fg: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.35)" },
  Low: { fg: "#34d399", bg: "rgba(52,211,153,0.12)", border: "rgba(52,211,153,0.35)" },
};

const categoryAccent: Record<string, string> = {
  Maintainability: "#a855f7",
  "Problem Solving": "#22d3ee",
  Architecture: "#3b82f6",
  "Code Quality": "#22c55e",
  Security: "#10b981",
};

const scoreColor = (s: number) => {
  if (s >= 88) return "#34d399";
  if (s >= 82) return "#fbbf24";
  return "#fb7185";
};

const fmt = (n: number, decimals = 0) => (Number.isFinite(n) ? n.toFixed(decimals) : "—");
const lower = (value?: string) => (value || "").toLowerCase();

const typeLabel = (value?: string) => {
  if (!value) return "Resource";
  const normalized = value.toLowerCase();
  if (normalized.includes("video")) return "Video";
  if (normalized.includes("book")) return "Book";
  if (normalized.includes("article")) return "Article";
  if (normalized.includes("course")) return "Course";
  return value;
};

const typeIcon = (value?: string) => {
  const kind = typeLabel(value);
  const stroke = "rgba(255,255,255,0.82)";
  if (kind === "Book") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19a2 2 0 0 1 2-2h12" />
        <path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" />
      </svg>
    );
  }
  if (kind === "Video") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="14" height="14" rx="2" />
        <path d="M17 9l4-2v10l-4-2" />
      </svg>
    );
  }
  if (kind === "Article") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 4h12l4 4v12a2 2 0 0 1-2 2H4z" />
        <path d="M14 4v4h4" />
        <path d="M8 13h8" />
        <path d="M8 17h6" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20s8-4 8-10a4 4 0 0 0-8-2 4 4 0 0 0-8 2c0 6 8 10 8 10z" />
    </svg>
  );
};

export default function DeveloperLearning() {
  const role = localStorage.getItem("role") || "developer";
  const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";

  const priorityOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [plan, setPlan] = useState<LearningPayload | null>(null);
  const [planCache, setPlanCache] = useState<Record<number, LearningPayload>>({});

  useEffect(() => {
    (async () => {
      setLoadingRepos(true);
      try {
        const res = await api.get("/analysis/skills/summary");
        const repoList: RepoOption[] = res.data.repos || [];
        setRepos(repoList);
      } finally {
        setLoadingRepos(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setPlan(null);
      return;
    }

    (async () => {
      const cached = planCache[selectedId];
      if (cached) {
        setPlan(cached);
        setLoadingPlan(false);
        return;
      }

      setPlan(null);
      setLoadingPlan(true);
      try {
        const res = await api.get(`/analysis/${selectedId}/learning-recommendations`);
        setPlan(res.data);
        setPlanCache((prev) => ({ ...prev, [selectedId]: res.data }));
      } finally {
        setLoadingPlan(false);
      }
    })();
  }, [selectedId, planCache]);

  const sortedGaps = useMemo(() => {
    if (!plan?.skill_gaps) return [];
    return [...plan.skill_gaps].sort((a, b) => b.gap - a.gap);
  }, [plan]);

  const selectedRepo = repos.find((repo) => repo.analysis_id === selectedId);
  const overallPriority = useMemo(() => {
    if (!plan?.skill_gaps?.length) return "Low";
    return plan.skill_gaps.reduce((best, current) =>
      priorityOrder[current.priority] > priorityOrder[best.priority] ? current : best,
    ).priority;
  }, [plan, priorityOrder]);
  const overallScore = plan?.scores?.overall ?? 0;
  const securityScore = plan?.scores?.security_score ?? 0;
  const overallPct = Math.round(overallScore);
  const securityPct = Math.round(securityScore);
  const overallAccent = categoryAccent["Code Quality"];

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');

        :root {
          color-scheme: dark;
        }

        .learn-shell {
          position: relative;
          padding: 36px 42px 60px;
          min-height: 100vh;
          color: white;
          font-family: 'DM Sans', sans-serif;
          background:
            radial-gradient(circle at 15% 15%, rgba(59,130,246,0.14), transparent 45%),
            radial-gradient(circle at 85% 20%, rgba(34,211,238,0.12), transparent 40%),
            radial-gradient(circle at 30% 85%, rgba(34,197,94,0.12), transparent 45%),
            #0F1117;
        }
        .learn-shell::after {
          content: '';
          position: absolute;
          inset: 0;
          background-image: linear-gradient(120deg, rgba(255,255,255,0.03) 1px, transparent 1px);
          background-size: 44px 44px;
          opacity: 0.3;
          pointer-events: none;
        }
        .learn-container {
          position: relative;
          z-index: 1;
          max-width: 1120px;
          margin: 0 auto;
        }
        .learn-card {
          background: #1A1D2E;
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 18px;
          padding: 22px 26px;
          box-shadow: 0 18px 50px rgba(0,0,0,0.35);
          transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }
        .learn-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 24px 60px rgba(0,0,0,0.4);
          border-color: rgba(255,255,255,0.12);
        }
        .learn-label {
          font-size: 11.5px;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          color: rgba(255,255,255,0.45);
        }
        .learn-title {
          font-size: 30px;
          font-weight: 700;
          margin: 6px 0 4px;
        }
        .learn-subtitle {
          color: rgba(255,255,255,0.55);
          font-size: 14px;
          max-width: 520px;
        }
        .learn-select {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.15);
          color: white;
          border-radius: 12px;
          padding: 10px 14px;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          outline: none;
          min-width: 240px;
        }
        .learn-select:focus { border-color: ${accent}80; }
        .learn-select option { background: #15192a; }

        .learn-hero {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.65fr);
          gap: 18px;
          margin-top: 24px;
        }
        .learn-hero-main {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 18px;
          align-items: center;
        }
        .learn-hero-side {
          display: flex;
          flex-direction: column;
          gap: 12px;
          justify-content: space-between;
        }
        .learn-ring {
          width: 168px;
          height: 168px;
          border-radius: 50%;
          background: conic-gradient(var(--accent) calc(var(--pct) * 1%), rgba(255,255,255,0.08) 0);
          display: grid;
          place-items: center;
          position: relative;
        }
        .learn-ring-inner {
          width: 128px;
          height: 128px;
          border-radius: 50%;
          background: #0F1117;
          border: 1px solid rgba(255,255,255,0.08);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-family: 'Space Mono', monospace;
        }
        .learn-score {
          font-size: 40px;
          font-weight: 700;
          letter-spacing: -1px;
          font-family: 'Space Mono', monospace;
        }
        .learn-score-small {
          font-size: 28px;
          font-weight: 700;
          font-family: 'Space Mono', monospace;
        }
        .learn-priority {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
        }
        .learn-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 600;
        }
        .learn-issues {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 16px;
        }
        .learn-chip {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 12px;
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          color: rgba(255,255,255,0.75);
        }
        .learn-score-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 14px;
          margin-top: 18px;
        }
        .learn-mini {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .learn-mini-score {
          font-size: 28px;
          font-weight: 700;
          font-family: 'Space Mono', monospace;
        }

        .learn-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-top: 16px;
        }
        .learn-gap-card {
          display: grid;
          gap: 12px;
          padding: 16px;
          border-radius: 16px;
          background: rgba(255,255,255,0.03);
          border: 1px solid rgba(255,255,255,0.08);
          min-height: 180px;
        }
        .learn-gap-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .learn-gap-progress {
          height: 8px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          overflow: hidden;
        }
        .learn-gap-progress span {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, var(--accent), rgba(255,255,255,0.3));
        }
        .learn-gap-meta {
          display: grid;
          gap: 6px;
          font-size: 13px;
          color: rgba(255,255,255,0.55);
        }
        .learn-gain {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 700;
          background: rgba(59,130,246,0.16);
          color: #60a5fa;
        }

        .learn-resource {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 16px;
          background: rgba(255,255,255,0.035);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px;
          transition: border-color 0.2s ease, transform 0.2s ease, background 0.2s ease;
          cursor: pointer;
        }
        .learn-resource:hover {
          border-color: rgba(255,255,255,0.18);
          background: rgba(255,255,255,0.06);
          transform: translateY(-2px);
        }
        .learn-resource-icon {
          width: 46px;
          height: 46px;
          border-radius: 14px;
          background: rgba(255,255,255,0.08);
          display: grid;
          place-items: center;
        }

        .learn-resource-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .learn-resource-title {
          font-size: 16px;
          font-weight: 700;
          color: white;
        }

        .learn-resource-subtitle {
          font-size: 12.5px;
          color: rgba(255,255,255,0.5);
        }

        .learn-resource-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }

        .learn-tag {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px;
          border-radius: 999px;
          font-size: 11px;
          color: rgba(255,255,255,0.7);
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
        }
        .learn-tag svg {
          width: 12px;
          height: 12px;
        }

        .learn-resource-actions {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .learn-start-btn {
          border: none;
          background: linear-gradient(135deg, #111827, #0f172a);
          color: white;
          padding: 10px 22px;
          border-radius: 14px;
          font-size: 13.5px;
          font-weight: 700;
          letter-spacing: 0.3px;
          cursor: pointer;
          box-shadow: 0 10px 22px rgba(15,23,42,0.5);
          transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
        }

        .learn-start-btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 14px 26px rgba(15,23,42,0.55);
          filter: brightness(1.05);
        }

        .learn-start-btn:active {
          transform: translateY(0);
          box-shadow: 0 8px 16px rgba(15,23,42,0.45);
        }

        .learn-resource a {
          color: #7dd3fc;
          text-decoration: none;
          font-size: 12.5px;
        }

        .learn-progress {
          height: 6px;
          border-radius: 999px;
          background: rgba(255,255,255,0.08);
          overflow: hidden;
        }

        .learn-progress span {
          display: block;
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, ${accent}, #22d3ee);
        }

        @media (max-width: 980px) {
          .learn-hero {
            grid-template-columns: 1fr;
          }
          .learn-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="learn-shell">
        <div className="learn-container">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 20 }}>
            <div>
              <div className="learn-label">Learning Radar</div>
              <h1 className="learn-title">Learning Gap Analysis</h1>
              <p className="learn-subtitle">
                Personalized learning plan based on code quality, architecture, and security signals from your latest analysis.
              </p>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 260 }}>
              <span className="learn-label">Repository</span>
              <select
                className="learn-select"
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value ? Number(e.target.value) : null)}
                disabled={loadingRepos}
              >
                <option value="">Select a repository</option>
                {repos.map((repo) => (
                  <option key={repo.analysis_id} value={repo.analysis_id}>
                    {repo.repo_name} ({repo.branch})
                  </option>
                ))}
              </select>
              {selectedRepo && (
                <span style={{ fontSize: 11.5, color: "rgba(255,255,255,0.4)" }}>
                  {selectedRepo.full_name}
                </span>
              )}
            </div>
          </div>

          <div className="learn-hero">
            <div className="learn-card learn-hero-main">
              <div>
                <div className="learn-label">Overall Score</div>
                <div className="learn-score">{plan ? fmt(overallScore, 0) : "—"}</div>
                <div className="learn-priority" style={{ color: priorityColors[overallPriority].fg, background: priorityColors[overallPriority].bg, border: `1px solid ${priorityColors[overallPriority].border}`, marginTop: 10 }}>
                  {overallPriority} Priority
                </div>
                <div className="learn-issues">
                  {plan?.issues?.length ? plan.issues.map((issue) => (
                    <span key={issue} className="learn-chip">{issue}</span>
                  )) : (
                    <span className="learn-chip">No major issues detected</span>
                  )}
                </div>
              </div>
              <div className="learn-ring" style={{ "--pct": overallPct, "--accent": overallAccent } as CSSProperties}>
                <div className="learn-ring-inner">
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", letterSpacing: "0.7px" }}>Score</div>
                  <div className="learn-score-small">{plan ? fmt(overallScore, 0) : "—"}</div>
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>/ 100</div>
                </div>
              </div>
            </div>

            <div className="learn-card learn-hero-side">
              <div>
                <div className="learn-label">Security Score</div>
                <div className="learn-score-small" style={{ color: categoryAccent.Security }}>
                  {plan ? fmt(securityScore, 0) : "—"}
                </div>
                <div className="learn-progress" style={{ marginTop: 10 }}>
                  <span style={{ width: `${securityPct}%`, background: `linear-gradient(90deg, ${categoryAccent.Security}, rgba(255,255,255,0.35))` }} />
                </div>
              </div>
              <div>
                <div className="learn-label">Generated</div>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>
                  {plan?.generated_at ? new Date(plan.generated_at).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="learn-card" style={{ marginTop: 18 }}>
            <div className="learn-label">Overall Category Scores</div>
            <div className="learn-score-row">
              {[
                { label: "Maintainability", value: plan?.scores.maintainability ?? 0 },
                { label: "Problem Solving", value: plan?.scores.problem_solving ?? 0 },
                { label: "Architecture", value: plan?.scores.architecture ?? 0 },
                { label: "Code Quality", value: plan?.scores.code_quality ?? 0 },
              ].map((item) => (
                <div key={item.label} className="learn-mini">
                  <div className="learn-label">{item.label}</div>
                  <div className="learn-mini-score" style={{ color: categoryAccent[item.label] }}>
                    {plan ? fmt(item.value, 0) : "—"}
                  </div>
                  <div className="learn-progress">
                    <span style={{ width: `${Math.min(100, Math.round(item.value))}%`, background: `linear-gradient(90deg, ${categoryAccent[item.label]}, rgba(255,255,255,0.35))` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="learn-card" style={{ marginTop: 18 }}>
            <div className="learn-label">Skill Gaps</div>
            {loadingPlan && <div style={{ marginTop: 10, color: "rgba(255,255,255,0.4)" }}>Loading recommendations...</div>}
            {!loadingPlan && (
              <div className="learn-grid">
                {sortedGaps.map((gap) => (
                  <div key={gap.domain} className="learn-gap-card" style={{ "--accent": categoryAccent[gap.domain] || accent } as CSSProperties}>
                    <div className="learn-gap-top">
                      <div style={{ fontWeight: 600 }}>{gap.domain}</div>
                      <span className="learn-priority" style={{ color: priorityColors[gap.priority].fg, background: priorityColors[gap.priority].bg, border: `1px solid ${priorityColors[gap.priority].border}` }}>
                        {gap.priority}
                      </span>
                    </div>
                    <div className="learn-gap-progress">
                      <span style={{ width: `${Math.min(100, gap.score)}%` }} />
                    </div>
                    <div className="learn-gap-meta">
                      <div>Score: {fmt(gap.score, 0)}</div>
                      <div>Gap: {fmt(gap.gap, 0)}</div>
                      <div>Target: {gap.target_difficulty}</div>
                    </div>
                    <div>
                      <span className="learn-gain">Estimated Gain +{gap.estimated_gain}</span>
                    </div>
                  </div>
                ))}
                {!sortedGaps.length && (
                  <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 13 }}>
                    Select a repository to see skill gaps.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="learn-card">
            <div className="learn-label">Recommended Learning Path</div>
            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {plan?.recommendations?.length ? plan.recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="learn-resource"
                  onClick={() => window.open(rec.url, "_blank", "noopener,noreferrer")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      window.open(rec.url, "_blank", "noopener,noreferrer");
                    }
                  }}
                >
                  <div className="learn-resource-icon">{typeIcon(rec.type)}</div>
                  <div className="learn-resource-main">
                    <div className="learn-resource-title">{rec.title}</div>
                    <div className="learn-resource-subtitle">{rec.provider} · {typeLabel(rec.type)}</div>
                    <div className="learn-resource-tags">
                      <span className="learn-tag">{typeLabel(rec.type)}</span>
                      <span className="learn-tag">{rec.difficulty}</span>
                      <span className="learn-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M12 7v5l3 2" />
                        </svg>
                        {rec.duration}
                      </span>
                      <span className="learn-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z" />
                        </svg>
                        {fmt(rec.rating, 1)}
                      </span>
                      {rec.pages && <span className="learn-tag">{rec.pages} pages</span>}
                    </div>
                    {rec.explanation && (
                      <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.6)" }}>
                        {rec.explanation}
                      </div>
                    )}
                  </div>
                  <div className="learn-resource-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      className="learn-start-btn"
                      onClick={() => window.open(rec.url, "_blank", "noopener,noreferrer")}
                      type="button"
                    >
                      Start
                    </button>
                  </div>
                </div>
              )) : (
                <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 13 }}>No recommendations yet.</div>
              )}
            </div>
          </div>

          {plan?.security_focus?.enabled && (
            <div className="learn-card">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="learn-label">Security Focus</span>
                <span className="learn-pill" style={{ color: "#f87171", background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.35)" }}>
                  Priority
                </span>
              </div>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", marginTop: 10 }}>
                Security score is below {plan.security_focus.threshold}. Prioritize these resources to strengthen secure coding practices.
              </p>
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {plan.security_focus.resources.map((rec) => (
                  <div key={rec.id} className="learn-resource">
                    <div style={{ fontSize: 15, fontWeight: 700 }}>{rec.title}</div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{rec.provider} · {rec.type}</div>
                    <a href={rec.url} target="_blank" rel="noreferrer">Open resource</a>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="learn-card">
            <div className="learn-label">Progress Tracking</div>
            <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)" }}>Plan completion</div>
                <div className="learn-progress" style={{ marginTop: 8 }}>
                  <span style={{ width: "18%" }} />
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.45)" }}>
                Tracking unlocks after your first learning session.
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
