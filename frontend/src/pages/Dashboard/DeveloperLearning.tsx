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
  High:   { fg: "#fb7185", bg: "rgba(251,113,133,0.12)", border: "rgba(251,113,133,0.35)" },
  Medium: { fg: "#f59e0b", bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.35)"  },
  Low:    { fg: "#34d399", bg: "rgba(52,211,153,0.12)",  border: "rgba(52,211,153,0.35)"  },
};

const categoryAccent: Record<string, string> = {
  Maintainability: "#a855f7",
  "Problem Solving": "#22d3ee",
  Architecture: "#3b82f6",
  "Code Quality": "#22c55e",
  Security: "#10b981",
};

const fmt = (n: number, decimals = 0) => (Number.isFinite(n) ? n.toFixed(decimals) : "—");

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
  if (kind === "Book") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19a2 2 0 0 1 2-2h12" /><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z" />
    </svg>
  );
  if (kind === "Video") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="14" height="14" rx="2" /><path d="M17 9l4-2v10l-4-2" />
    </svg>
  );
  if (kind === "Article") return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4h12l4 4v12a2 2 0 0 1-2 2H4z" /><path d="M14 4v4h4" /><path d="M8 13h8" /><path d="M8 17h6" />
    </svg>
  );
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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
        setRepos(res.data.repos || []);
      } finally {
        setLoadingRepos(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) { setPlan(null); return; }
    (async () => {
      const cached = planCache[selectedId];
      if (cached) { setPlan(cached); setLoadingPlan(false); return; }
      setPlan(null); setLoadingPlan(true);
      try {
        const res = await api.get(`/analysis/${selectedId}/learning-recommendations`);
        setPlan(res.data);
        setPlanCache(prev => ({ ...prev, [selectedId]: res.data }));
      } finally {
        setLoadingPlan(false);
      }
    })();
  }, [selectedId, planCache]);

  const sortedGaps = useMemo(() => {
    if (!plan?.skill_gaps) return [];
    return [...plan.skill_gaps].sort((a, b) => b.gap - a.gap);
  }, [plan]);

  const selectedRepo = repos.find(r => r.analysis_id === selectedId);
  const overallPriority = useMemo(() => {
    if (!plan?.skill_gaps?.length) return "Low";
    return plan.skill_gaps.reduce((best, cur) =>
      priorityOrder[cur.priority] > priorityOrder[best.priority] ? cur : best,
    ).priority;
  }, [plan, priorityOrder]);

  const overallScore   = plan?.scores?.overall ?? 0;
  const securityScore  = plan?.scores?.security_score ?? 0;
  const overallPct     = Math.round(overallScore);
  const securityPct    = Math.round(securityScore);

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        input, select, textarea { font-family: 'DM Sans', sans-serif; }

        .lrn-card {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 16px; padding: 24px 28px;
          transition: border-color 0.2s;
        }
        .lrn-card:hover { border-color: var(--border-hover); }

        .lrn-select {
          width: 100%; padding: 10px 14px;
          background: var(--bg-input);
          border: 1px solid rgba(99,102,241,0.25);
          border-radius: 12px; color: var(--text-primary);
          font-size: 14px; outline: none; cursor: pointer;
          transition: border-color 0.2s;
          font-family: 'DM Sans', sans-serif;
        }
        .lrn-select:focus { border-color: ${accent}80; }
        .lrn-select option { background: var(--bg-base); color: var(--text-primary); }
        .lrn-select:disabled { opacity: 0.5; cursor: not-allowed; }

        .lrn-label {
          font-size: 12px; font-weight: 700;
          color: rgba(167,139,250,0.8);
          text-transform: uppercase; letter-spacing: 0.8px;
          margin-bottom: 8px; display: block;
        }

        .lrn-ring {
          width: 160px; height: 160px; border-radius: 50%;
          background: conic-gradient(var(--accent) calc(var(--pct) * 1%), var(--border) 0);
          display: grid; place-items: center;
        }
        .lrn-ring-inner {
          width: 122px; height: 122px; border-radius: 50%;
          background: var(--bg-base);
          border: 1px solid var(--border);
          display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 4px;
        }

        .lrn-priority {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 5px 12px; border-radius: 999px;
          font-size: 12px; font-weight: 700;
        }
        .lrn-chip {
          padding: 5px 10px; border-radius: 999px;
          font-size: 12px;
          background: var(--bg-card-hover);
          border: 1px solid var(--border);
          color: var(--text-secondary);
        }
        .lrn-progress {
          height: 6px; border-radius: 999px;
          background: var(--border); overflow: hidden;
        }
        .lrn-progress span {
          display: block; height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, ${accent}, #22d3ee);
        }
        .lrn-mini {
          background: var(--bg-card-hover);
          border: 1px solid var(--border);
          border-radius: 14px; padding: 14px 16px;
          display: flex; flex-direction: column; gap: 8px;
        }
        .lrn-gap-card {
          padding: 16px; border-radius: 14px;
          background: var(--bg-card-hover);
          border: 1px solid var(--border);
        }
        .lrn-gap-bar {
          height: 7px; border-radius: 999px;
          background: var(--border); overflow: hidden;
        }
        .lrn-gap-bar span {
          display: block; height: 100%; border-radius: 999px;
          background: linear-gradient(90deg, var(--accent), rgba(255,255,255,0.3));
        }
        .lrn-gain {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 4px 10px; border-radius: 999px;
          font-size: 12px; font-weight: 700;
          background: rgba(59,130,246,0.16); color: #60a5fa;
        }
        .lrn-resource {
          display: flex; align-items: center; gap: 14px;
          padding: 14px 16px;
          background: var(--bg-card-hover);
          border: 1px solid var(--border);
          border-radius: 14px; cursor: pointer;
          transition: border-color 0.2s, transform 0.2s, background 0.2s;
        }
        .lrn-resource:hover { border-color: var(--border-hover); background: var(--bg-card); transform: translateY(-2px); }
        .lrn-resource-icon {
          width: 44px; height: 44px; border-radius: 12px;
          background: var(--bg-card); display: grid; place-items: center; flex-shrink: 0;
          color: var(--text-secondary);
        }
        .lrn-tag {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 3px 8px; border-radius: 999px;
          font-size: 11px; color: var(--text-secondary);
          background: var(--bg-card-hover);
          border: 1px solid var(--border);
        }
        .lrn-tag svg { width: 11px; height: 11px; }
        .lrn-start-btn {
          border: none; padding: 9px 20px; border-radius: 12px;
          background: linear-gradient(135deg, ${accent}, #ec4899);
          color: white; font-size: 13px; font-weight: 700;
          cursor: pointer; transition: all 0.2s; white-space: nowrap;
          box-shadow: 0 4px 16px ${accent}30;
          font-family: 'DM Sans', sans-serif;
        }
        .lrn-start-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px ${accent}40; }

        .sk {
          background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%);
          background-size: 400% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 8px;
        }
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }
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
              Learning Radar
            </div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.5px", margin: "0 0 4px" }}>
              Learning Gap Analysis
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
              Personalized learning plan based on code quality, architecture, and security signals from your latest analysis.
            </p>
          </div>

          {/* ── Repo selector ── */}
          <div className="lrn-card">
            <label className="lrn-label">Repository</label>
            <select className="lrn-select" value={selectedId ?? ""} onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)} disabled={loadingRepos}>
              <option value="">Select a repository</option>
              {repos.map(r => (
                <option key={r.analysis_id} value={r.analysis_id}>{r.repo_name} ({r.branch})</option>
              ))}
            </select>
            {selectedRepo && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>{selectedRepo.full_name}</div>
            )}
          </div>

          {/* ── Hero: Overall + Security ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 18, alignItems: "stretch" }}>
            <div className="lrn-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24 }}>
              <div style={{ flex: 1 }}>
                <label className="lrn-label">Overall Score</label>
                <div style={{ fontSize: 42, fontWeight: 900, color: "var(--text-primary)", lineHeight: 1, marginBottom: 10 }}>
                  {plan ? fmt(overallScore) : "—"}
                </div>
                <span className="lrn-priority" style={{ color: priorityColors[overallPriority].fg, background: priorityColors[overallPriority].bg, border: `1px solid ${priorityColors[overallPriority].border}` }}>
                  {overallPriority} Priority
                </span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 }}>
                  {plan?.issues?.length ? plan.issues.map(issue => (
                    <span key={issue} className="lrn-chip">{issue}</span>
                  )) : <span className="lrn-chip">No major issues detected</span>}
                </div>
              </div>
              <div className="lrn-ring" style={{ "--pct": overallPct, "--accent": categoryAccent["Code Quality"] } as CSSProperties}>
                <div className="lrn-ring-inner">
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.7px" }}>Score</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{plan ? fmt(overallScore) : "—"}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>/ 100</div>
                </div>
              </div>
            </div>
            <div className="lrn-card" style={{ minWidth: 200, display: "flex", flexDirection: "column", gap: 20, justifyContent: "space-between" }}>
              <div>
                <label className="lrn-label">Security Score</label>
                <div style={{ fontSize: 32, fontWeight: 800, color: categoryAccent.Security, marginBottom: 10 }}>
                  {plan ? fmt(securityScore) : "—"}
                </div>
                <div className="lrn-progress">
                  <span style={{ width: `${securityPct}%`, background: `linear-gradient(90deg, ${categoryAccent.Security}, rgba(255,255,255,0.35))` }} />
                </div>
              </div>
              <div>
                <label className="lrn-label">Generated</label>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
                  {plan?.generated_at ? new Date(plan.generated_at).toLocaleString() : "—"}
                </div>
              </div>
            </div>
          </div>

          {/* ── Category Scores ── */}
          <div className="lrn-card">
            <label className="lrn-label">Category Scores</label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginTop: 14 }}>
              {[
                { label: "Maintainability",  value: plan?.scores.maintainability  ?? 0 },
                { label: "Problem Solving",  value: plan?.scores.problem_solving  ?? 0 },
                { label: "Architecture",     value: plan?.scores.architecture     ?? 0 },
                { label: "Code Quality",     value: plan?.scores.code_quality     ?? 0 },
              ].map(item => (
                <div key={item.label} className="lrn-mini">
                  <label className="lrn-label" style={{ marginBottom: 0 }}>{item.label}</label>
                  <div style={{ fontSize: 28, fontWeight: 800, color: categoryAccent[item.label] || accent }}>
                    {plan ? fmt(item.value) : "—"}
                  </div>
                  <div className="lrn-progress">
                    <span style={{ width: `${Math.min(100, Math.round(item.value))}%`, background: `linear-gradient(90deg, ${categoryAccent[item.label] || accent}, rgba(255,255,255,0.35))` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Skill Gaps ── */}
          <div className="lrn-card">
            <label className="lrn-label">Skill Gaps</label>
            {loadingPlan && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                <div className="sk" style={{ width: 200, height: 14 }} />
              </div>
            )}
            {!loadingPlan && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginTop: 14 }}>
                {sortedGaps.map(gap => (
                  <div key={gap.domain} className="lrn-gap-card" style={{ "--accent": categoryAccent[gap.domain] || accent } as CSSProperties}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{gap.domain}</span>
                      <span className="lrn-priority" style={{ color: priorityColors[gap.priority].fg, background: priorityColors[gap.priority].bg, border: `1px solid ${priorityColors[gap.priority].border}` }}>
                        {gap.priority}
                      </span>
                    </div>
                    <div className="lrn-gap-bar" style={{ marginBottom: 10 }}>
                      <span style={{ width: `${Math.min(100, gap.score)}%` }} />
                    </div>
                    <div style={{ fontSize: 12.5, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 3, marginBottom: 10 }}>
                      <span>Score: {fmt(gap.score)}</span>
                      <span>Gap: {fmt(gap.gap)}</span>
                      <span>Target: {gap.target_difficulty}</span>
                    </div>
                    <span className="lrn-gain">+{gap.estimated_gain} estimated gain</span>
                  </div>
                ))}
                {!sortedGaps.length && (
                  <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Select a repository to see skill gaps.</div>
                )}
              </div>
            )}
          </div>

          {/* ── Learning Path ── */}
          <div className="lrn-card">
            <label className="lrn-label">Recommended Learning Path</label>
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              {plan?.recommendations?.length ? plan.recommendations.map(rec => (
                <div key={rec.id} className="lrn-resource" onClick={() => window.open(rec.url, "_blank", "noopener,noreferrer")}>
                  <div className="lrn-resource-icon">{typeIcon(rec.type)}</div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5 }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{rec.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{rec.provider} · {typeLabel(rec.type)}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <span className="lrn-tag">{typeLabel(rec.type)}</span>
                      <span className="lrn-tag">{rec.difficulty}</span>
                      <span className="lrn-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
                        {rec.duration}
                      </span>
                      <span className="lrn-tag">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17l-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3z"/></svg>
                        {fmt(rec.rating, 1)}
                      </span>
                      {rec.pages && <span className="lrn-tag">{rec.pages} pages</span>}
                    </div>
                    {rec.explanation && (
                      <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{rec.explanation}</div>
                    )}
                  </div>
                  <div onClick={e => e.stopPropagation()}>
                    <button className="lrn-start-btn" onClick={() => window.open(rec.url, "_blank", "noopener,noreferrer")}>Start</button>
                  </div>
                </div>
              )) : (
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>No recommendations yet. Select a repository to generate a learning plan.</div>
              )}
            </div>
          </div>

          {/* ── Security Focus ── */}
          {plan?.security_focus?.enabled && (
            <div className="lrn-card" style={{ borderColor: "rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <label className="lrn-label" style={{ marginBottom: 0 }}>Security Focus</label>
                <span style={{ display: "inline-flex", padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, background: "rgba(248,113,113,0.12)", color: "#f87171", border: "1px solid rgba(248,113,113,0.3)" }}>
                  Priority
                </span>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: "0 0 12px" }}>
                Security score is below {plan.security_focus.threshold}. Prioritize these resources to strengthen secure coding practices.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {plan.security_focus.resources.map(rec => (
                  <div key={rec.id} className="lrn-resource" onClick={() => window.open(rec.url, "_blank", "noopener,noreferrer")}>
                    <div className="lrn-resource-icon">{typeIcon(rec.type)}</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>{rec.title}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{rec.provider} · {rec.type}</div>
                    </div>
                    <div onClick={e => e.stopPropagation()}>
                      <button className="lrn-start-btn" onClick={() => window.open(rec.url, "_blank", "noopener,noreferrer")}>Open</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Progress Tracking ── */}
          <div className="lrn-card">
            <label className="lrn-label">Progress Tracking</label>
            <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginBottom: 8 }}>Plan completion</div>
                <div className="lrn-progress">
                  <span style={{ width: "18%" }} />
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
                Tracking unlocks after your first learning session.
              </div>
            </div>
          </div>

        </div>
      </div>
    </DashboardLayout>
  );
}