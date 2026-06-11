import { useEffect, useState } from "react";
import api, { API_BASE_URL } from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

interface SkillsSummary {
  overall: number; delta: number;
  viewer?: { has_github_identity: boolean; github_login: string | null };
  scores: { code_quality: number; maintainability: number; architecture: number; problem_solving: number };
  deltas: { code_quality: number; maintainability: number; architecture: number; problem_solving: number };
  repos: Array<{ analysis_id: number; repo_name: string; full_name: string; branch: string; completed_at: string | null; is_private: boolean; analysis_context?: AnalysisContext }>;
}
interface AnalysisContext { has_github_identity: boolean; github_login: string | null; is_private: boolean; user_contributed: boolean; commit_count_sample: number; latest_commit_at: string | null; }
interface ArchitectureMetricEntry {
  score: number;
  method?: string;
  confidence?: number;
  reason?: string;
  details?: Record<string, unknown>;
}
interface DetailedAnalysis {
  analysis_run_id: number; repo: string; branch: string; status: string;
  scores: { code_quality: number; maintainability: number; architecture: number; security_score: number; problem_solving: number; overall: number };
  detailed_metrics: {
    code_quality: { python_files: number; total_loc: number; avg_cyclomatic_complexity: number; avg_duplication_score: number; style_violations: number; unused_variables: number };
    maintainability: { avg_docstring_coverage: number; missing_docstrings: number; avg_maintainability_index: number; avg_comment_ratio: number; long_functions: number; too_many_params: number };
    architecture: {
      overall?: number;
      note?: string;
      layer_count_srp?: ArchitectureMetricEntry;
      repository_pattern?: ArchitectureMetricEntry;
      dependency_injection?: ArchitectureMetricEntry;
      circular_imports?: ArchitectureMetricEntry;
      open_closed_readiness?: ArchitectureMetricEntry;
      swappable_components?: ArchitectureMetricEntry;
      module_decomposition?: ArchitectureMetricEntry;
      god_class_function?: ArchitectureMetricEntry;
      coupling?: ArchitectureMetricEntry;
      cohesion?: ArchitectureMetricEntry;
    };
    problem_solving: { test_files: number; avg_test_function_ratio: number; avg_cyclomatic_complexity: number; long_functions: number };
  };
  security: { findings_count: number; severity_distribution: { HIGH: number; MEDIUM: number; LOW: number } };
  ai_insights: {
    skills_insights?: { code_quality?: string[]; maintainability?: string[]; architecture?: string[]; problem_solving?: string[] };
    llm_problem_solving?: { algorithms?: { score: number; confidence?: number; evidence?: string[] }; data_structures?: { score: number; confidence?: number; evidence?: string[] }; balanced_complexity?: { score: number; confidence?: number; evidence?: string[] }; edge_cases?: { score: number; confidence?: number; evidence?: string[] }; generated_at?: number };
    llm_skill_scores?: { code_quality?: { adjustment: number; confidence?: number; reason?: string }; maintainability?: { adjustment: number; confidence?: number; reason?: string }; architecture?: { adjustment: number; confidence?: number; reason?: string }; generated_at?: number };
    llm_adjustment_guidance?: { code_quality?: { requested_adjustment?: number; applied_delta?: number; confidence?: number; reason?: string; evidence?: string[]; overall_impact?: number; overall_delta?: number; ignored?: boolean }; maintainability?: { requested_adjustment?: number; applied_delta?: number; confidence?: number; reason?: string; evidence?: string[]; overall_impact?: number; overall_delta?: number; ignored?: boolean }; architecture?: { requested_adjustment?: number; applied_delta?: number; confidence?: number; reason?: string; evidence?: string[]; overall_impact?: number; overall_delta?: number; ignored?: boolean } };
    security_insights?: string;
  };
  completed_at: string | null; analysis_context?: AnalysisContext;
}

const ARCHITECTURE_METHOD_LABELS: Record<string, string> = {
  LLM: "AI semantic review",
  "LLM + AST": "Hybrid · AI + structure",
  "LLM + AST (radon)": "Hybrid · AI + complexity",
  "pydeps + import-linter": "Tool-based · import graph",
  AST: "Static · structure map",
};

type ArchitectureMetricMeta = {
  key: keyof DetailedAnalysis["detailed_metrics"]["architecture"];
  label: string;
  description: string;
  evaluation: "llm" | "hybrid" | "static";
};

const ARCHITECTURE_METRICS: ArchitectureMetricMeta[] = [
  { key: "layer_count_srp", label: "Layer Count / SRP", description: "Logical layering and single-responsibility separation", evaluation: "llm" },
  { key: "repository_pattern", label: "Repository Pattern", description: "Data-access abstraction vs scattered persistence logic", evaluation: "llm" },
  { key: "dependency_injection", label: "Dependency Injection", description: "Injected dependencies vs inline/hard-coded construction", evaluation: "llm" },
  { key: "circular_imports", label: "Circular Imports", description: "Import cycles detected by pydeps and import-linter", evaluation: "static" },
  { key: "open_closed_readiness", label: "Open/Closed Readiness", description: "Extensibility without modifying core modules", evaluation: "llm" },
  { key: "swappable_components", label: "Swappable Components", description: "Abstractions that allow replacing implementations", evaluation: "llm" },
  { key: "module_decomposition", label: "Module Decomposition", description: "Domain-aligned module boundaries (structure + AI review)", evaluation: "hybrid" },
  { key: "god_class_function", label: "God Class / Function", description: "Multi-domain responsibilities and cyclomatic complexity", evaluation: "hybrid" },
  { key: "coupling", label: "Coupling", description: "Semantic coupling and inline concrete service usage", evaluation: "hybrid" },
  { key: "cohesion", label: "Cohesion", description: "Functional relatedness within modules and classes", evaluation: "llm" },
];

const scoreColor = (s: number) => s >= 80 ? "#34d399" : s >= 60 ? "#fbbf24" : "#f87171";
const fmt = (n: number, decimals = 1) => Number.isFinite(n) ? n.toFixed(decimals) : "—";
const pct = (n: number) => `${Math.round((n || 0) * 100)}%`;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const normalize = (v: number, low: number, high: number) => high <= low ? 0 : clamp01((v - low) / (high - low));

const formatArchSub = (entry?: ArchitectureMetricEntry, meta?: ArchitectureMetricMeta) => {
  if (!entry) return "Not available";
  const parts: string[] = [];
  if (entry.method) {
    parts.push(ARCHITECTURE_METHOD_LABELS[entry.method] || entry.method);
  } else if (meta) {
    parts.push(meta.evaluation === "llm" ? "AI semantic review" : meta.evaluation === "hybrid" ? "Hybrid evaluation" : "Tool-based");
  }
  if (entry.confidence != null) parts.push(`conf ${Math.round(entry.confidence * 100)}%`);
  return parts.join(" · ") || "Scored";
};

const computeComplexityScore = (d: DetailedAnalysis) => {
  const cq = d.detailed_metrics?.code_quality || {};
  const m = d.detailed_metrics?.maintainability || {};
  const couplingScore = d.detailed_metrics?.architecture?.coupling?.score;
  const files = Math.max(1, Number(cq.python_files || 0));
  const couplingPenalty = couplingScore != null ? (100 - couplingScore) / 100 : 0.3;
  const penalty = (
    normalize(Number(cq.avg_cyclomatic_complexity || 0), 5, 40) * 0.30
    + normalize(Number(m.long_functions || 0) / files, 0.2, 2.5) * 0.20
    + normalize(Number(m.too_many_params || 0) / files, 0.2, 2.5) * 0.15
    + normalize(Number(cq.avg_duplication_score || 0), 0.05, 0.4) * 0.15
    + couplingPenalty * 0.20
  );
  return Math.round(100 * (1 - clamp01(penalty)));
};
const avgScore = (metrics: Array<{ value: number }>) => { if (!metrics.length) return 0; return Math.round(metrics.reduce((acc, m) => acc + (Number.isFinite(m.value) ? m.value : 0), 0) / metrics.length); };
const llmScore = (d: DetailedAnalysis, key: keyof DetailedAnalysis["scores"]) => { const val = d.scores?.[key]; return typeof val === "number" ? val : null; };

function CircleRing({ value, size = 80, stroke = 6, accent = "#6366f1" }: { value: number; size?: number; stroke?: number; accent?: string }) {
  const r = (size - stroke) / 2; const circ = 2 * Math.PI * r; const filled = (Math.min(Math.max(value, 0), 100) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={accent} strokeWidth={stroke} strokeDasharray={`${filled} ${circ}`} strokeLinecap="round" style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
    </svg>
  );
}

function ScoreRing({ value, size = 80 }: { value: number; size?: number }) {
  const color = scoreColor(value);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <CircleRing value={value} size={size} stroke={6} accent={color} />
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontSize: size * 0.26, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1 }}>{Math.round(value)}</span>
        <span style={{ fontSize: size * 0.14, color: "var(--text-faint)" }}>/ 100</span>
      </div>
    </div>
  );
}

function DeltaBadge({ delta, large = false }: { delta: number; large?: boolean }) {
  if (delta === 0) return null;
  const pos = delta > 0;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: large ? "4px 10px" : "2px 7px", borderRadius: "20px", background: pos ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.12)", color: pos ? "#34d399" : "#f87171", fontSize: large ? "13px" : "11px", fontWeight: 700 }}>
      {pos ? "▲" : "▼"} {pos ? "+" : ""}{Math.abs(delta).toFixed(1)} pts
    </span>
  );
}

function ConfidenceDots({ confidence }: { confidence: number }) {
  const filled = Math.round(confidence * 5);
  return (
    <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: i < filled ? "#34d399" : "var(--border-hover)", border: i < filled ? "none" : "1px solid var(--border-hover)", transition: "background 0.3s" }} />
      ))}
    </div>
  );
}

function MetricBar({ label, value, sub, max = 100, adjustedValue, confidence }: { label: string; value: number; sub?: string; max?: number; adjustedValue?: number; confidence?: number }) {
  const staticPct = Math.min(100, (value / max) * 100); const hasAdjust = adjustedValue != null && adjustedValue !== value;
  const adjPct = hasAdjust ? Math.min(100, ((adjustedValue as number) / max) * 100) : staticPct;
  const penaltyPct = Math.max(0, staticPct - adjPct); const penalized = hasAdjust && (adjustedValue as number) < value;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, color: "var(--text-secondary)", fontWeight: 500, flex: 1 }}>{label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {confidence != null && <ConfidenceDots confidence={confidence} />}
          {hasAdjust ? (
            <span style={{ fontSize: 13, fontWeight: 700 }}>
              <span style={{ color: "var(--text-primary)" }}>{Math.round(value)}</span>
              <span style={{ color: "var(--text-faint)", margin: "0 4px" }}>→</span>
              <span style={{ color: penalized ? "#f87171" : "#34d399" }}>{Math.round(adjustedValue as number)}</span>
            </span>
          ) : (
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>{Math.round(value)}</span>
          )}
        </div>
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -2 }}>{sub}</div>}
      <div style={{ position: "relative", height: 5, background: "var(--border)", borderRadius: 3, overflow: "visible" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", borderRadius: 3, background: "linear-gradient(90deg,#34d399,#10b981)", width: `${adjPct}%`, transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
        {hasAdjust && penaltyPct > 0 && (<div style={{ position: "absolute", left: `${adjPct}%`, top: 0, height: "100%", width: `${penaltyPct}%`, minWidth: 3, background: "rgba(248,113,113,0.55)", transition: "width 0.8s" }} />)}
        {hasAdjust && penaltyPct > 0 && (<div style={{ position: "absolute", left: `${adjPct}%`, top: -2, width: 2, height: 9, background: "#f87171", borderRadius: 1, transform: "translateX(-50%)", boxShadow: "0 0 4px rgba(248,113,113,0.7)" }} />)}
      </div>
    </div>
  );
}

function InsightBox({ lines }: { lines: string[] }) {
  return (
    <div style={{ marginTop: 16, padding: "14px 16px", background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.15)", borderRadius: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "#818cf8", letterSpacing: "0.4px" }}>AI Contribution Guidance</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((l, i) => (
          <li key={i} style={{ display: "flex", gap: 8, fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
            <span style={{ color: "#818cf8", flexShrink: 0, marginTop: 1 }}>•</span><span>{l}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function connectGithub() { const token = localStorage.getItem("token"); if (token) window.location.href = `${API_BASE_URL}/auth/github?action=connect&token=${token}`; }

const DIMENSIONS = [
  {
    key: "code_quality" as const, label: "Code Quality", desc: "Measures quality signals in the Python files touched by your commits",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
    getMetrics: (d: DetailedAnalysis) => {
      const cq = d.detailed_metrics?.code_quality || {}; const adj = d.ai_insights?.llm_adjustment_guidance?.code_quality; const confidence = adj?.confidence ?? undefined;
      const dup = Math.round((cq.avg_duplication_score || 0) * 100); const cc = Number((cq.avg_cyclomatic_complexity || 0).toFixed(2));
      const delta = adj && !adj.ignored ? (adj.applied_delta ?? 0) : 0; const s = (base: number) => Math.min(100, Math.max(0, base + delta));
      const ss = Math.max(0, 100 - (cq.style_violations || 0) * 2); const sv = Math.max(0, 100 - (cq.style_violations || 0) * 3);
      const su = Math.max(0, 100 - (cq.unused_variables || 0) * 5); const sd = Math.max(0, 100 - dup);
      return [{ label: "Code Smells", value: ss, adjustedValue: s(ss), confidence, sub: `${cq.style_violations ?? 0} found · cyclomatic avg ${cc}` }, { label: "Style Violations", value: sv, adjustedValue: s(sv), confidence, sub: `${cq.style_violations ?? 0} total` }, { label: "Unused Variables", value: su, adjustedValue: s(su), confidence, sub: `${cq.unused_variables ?? 0} instances` }, { label: "Code Duplication", value: sd, adjustedValue: s(sd), confidence, sub: `${dup}% duplication` }];
    },
    getScore: (d: DetailedAnalysis) => { const v = llmScore(d, "code_quality"); return v != null ? Math.round(v) : avgScore(DIMENSIONS[0].getMetrics(d)); },
    getInsights: (d: DetailedAnalysis) => d.ai_insights?.skills_insights?.code_quality || [],
  },
  {
    key: "maintainability" as const, label: "Maintainability", desc: "Evaluates maintainability of the contribution-affected code",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>,
    getMetrics: (d: DetailedAnalysis) => {
      const m = d.detailed_metrics?.maintainability || {}; const adj = d.ai_insights?.llm_adjustment_guidance?.maintainability; const confidence = adj?.confidence ?? undefined;
      const delta = adj && !adj.ignored ? (adj.applied_delta ?? 0) : 0; const s = (base: number) => Math.min(100, Math.max(0, base + delta));
      const sd = Math.round((m.avg_docstring_coverage || 0) * 100); const si = Math.min(100, Math.round(m.avg_maintainability_index || 0));
      const sc = Math.min(100, Math.round((m.avg_comment_ratio || 0) * 200)); const sx = computeComplexityScore(d);
      return [{ label: "Documentation Coverage", value: sd, adjustedValue: s(sd), confidence, sub: `${pct(m.avg_docstring_coverage || 0)} · ${m.missing_docstrings ?? 0} missing` }, { label: "Maintainability Index", value: si, adjustedValue: s(si), confidence, sub: `${Math.round(m.avg_maintainability_index || 0)} index score` }, { label: "Code Comments", value: sc, adjustedValue: s(sc), confidence, sub: m.avg_comment_ratio ? `${(m.avg_comment_ratio * 100).toFixed(1)}% ratio` : "Low comment ratio" }, { label: "Complexity Score", value: sx, adjustedValue: s(sx), confidence, sub: `${m.long_functions ?? 0} long fns · ${m.too_many_params ?? 0} over-param'd` }];
    },
    getScore: (d: DetailedAnalysis) => { const v = llmScore(d, "maintainability"); return v != null ? Math.round(v) : avgScore(DIMENSIONS[1].getMetrics(d)); },
    getInsights: (d: DetailedAnalysis) => d.ai_insights?.skills_insights?.maintainability || [],
  },
  {
    key: "architecture" as const, label: "Architecture", desc: "Ten-metric pipeline: AI semantic review, hybrid AST signals, and import-graph tools",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>,
    getMetrics: (d: DetailedAnalysis) => {
      const arch = d.detailed_metrics?.architecture || {};
      if (arch.note && !arch.layer_count_srp) {
        return [{ label: "Architecture metrics", value: arch.overall ?? 0, sub: arch.note }];
      }
      return ARCHITECTURE_METRICS.map(({ key, label, description, evaluation }) => {
        const entry = arch[key] as ArchitectureMetricEntry | undefined;
        const value = entry?.score ?? 0;
        return {
          label,
          value,
          confidence: entry?.confidence,
          sub: `${formatArchSub(entry, { key, label, description, evaluation })} · ${description}`,
        };
      });
    },
    getScore: (d: DetailedAnalysis) => {
      const v = llmScore(d, "architecture");
      if (v != null) return Math.round(v);
      const arch = d.detailed_metrics?.architecture;
      if (arch?.overall != null) return Math.round(arch.overall);
      return avgScore(DIMENSIONS[2].getMetrics(d));
    },
    getInsights: (d: DetailedAnalysis) => {
      const arch = d.detailed_metrics?.architecture || {};
      const fromMetrics = ARCHITECTURE_METRICS.flatMap(({ key, label }) => {
        const entry = arch[key] as ArchitectureMetricEntry | undefined;
        if (!entry?.reason) return [];
        return [`${label}: ${entry.reason}`];
      });
      if (fromMetrics.length) return fromMetrics;
      return d.ai_insights?.skills_insights?.architecture || [];
    },
  },
  {
    key: "problem_solving" as const, label: "Problem Solving", desc: "Analyzes complexity and problem-solving signals in your contribution area",
    icon: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/><circle cx="12" cy="12" r="10"/></svg>,
    getMetrics: (d: DetailedAnalysis) => {
      const llm = d.ai_insights?.llm_problem_solving;
      if (llm && (llm.algorithms || llm.data_structures || llm.balanced_complexity || llm.edge_cases)) {
        return [{ label: "Algorithms", value: llm.algorithms?.score ?? 0, sub: llm.algorithms?.confidence != null ? `Conf ${Math.round((llm.algorithms.confidence || 0) * 100)}%` : "" }, { label: "Data Structures", value: llm.data_structures?.score ?? 0, sub: llm.data_structures?.confidence != null ? `Conf ${Math.round((llm.data_structures.confidence || 0) * 100)}%` : "" }, { label: "Balanced Complexity", value: llm.balanced_complexity?.score ?? 0, sub: llm.balanced_complexity?.confidence != null ? `Conf ${Math.round((llm.balanced_complexity.confidence || 0) * 100)}%` : "" }, { label: "Edge Cases", value: llm.edge_cases?.score ?? 0, sub: llm.edge_cases?.confidence != null ? `Conf ${Math.round((llm.edge_cases.confidence || 0) * 100)}%` : "" }];
      }
      return [{ label: "Algorithms", value: 0, sub: "LLM required" }, { label: "Data Structures", value: 0, sub: "LLM required" }, { label: "Balanced Complexity", value: 0, sub: "LLM required" }, { label: "Edge Cases", value: 0, sub: "LLM required" }];
    },
    getScore: (d: DetailedAnalysis) => { const v = llmScore(d, "problem_solving"); return v != null ? Math.round(v) : 0; },
    getInsights: (d: DetailedAnalysis) => {
      const llm = d.ai_insights?.llm_problem_solving;
      if (llm) {
        const lines = [{ label: "Algorithms", value: llm.algorithms?.evidence || [] }, { label: "Data Structures", value: llm.data_structures?.evidence || [] }, { label: "Balanced Complexity", value: llm.balanced_complexity?.evidence || [] }, { label: "Edge Cases", value: llm.edge_cases?.evidence || [] }].flatMap(e => e.value.map(item => `${e.label}: ${item}`));
        if (lines.length) return lines;
      }
      return d.ai_insights?.skills_insights?.problem_solving || [];
    },
  },
];

export default function DeveloperSkills() {
  const role = localStorage.getItem("role") || "developer";
  const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";
  const [summary, setSummary] = useState<SkillsSummary | null>(null);
  const [detail, setDetail] = useState<DetailedAnalysis | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    (async () => {
      try { const res = await api.get("/analysis/skills/summary"); setSummary(res.data); }
      catch (err: any) { if (err.response?.status === 401) { localStorage.clear(); window.location.href = "/login"; } }
      finally { setLoadingSummary(false); }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    (async () => {
      setLoadingDetail(true);
      try { const res = await api.get(`/analysis/${selectedId}/detailed-metrics`); setDetail(res.data); }
      finally { setLoadingDetail(false); }
    })();
  }, [selectedId]);

  const scores = summary?.scores; const deltas = summary?.deltas; const overall = summary?.overall ?? 0;
  const selectedRepo = summary?.repos.find(r => r.analysis_id === selectedId);
  const activeContext = detail?.analysis_context || selectedRepo?.analysis_context;
  const hasGithubIdentity = Boolean(summary?.viewer?.has_github_identity || activeContext?.has_github_identity);

  const getModeNotice = () => {
    const contributed = Boolean(activeContext?.user_contributed); const githubLogin = activeContext?.github_login || summary?.viewer?.github_login;
    if (hasGithubIdentity && selectedId && contributed) return { title: "Developer Contribution Analysis", body: `Connected as ${githubLogin}. Results are based on Python files touched by your commits.`, tone: "#34d399" };
    if (hasGithubIdentity && selectedId) return { title: "No Contribution Analysis Available", body: `Connected as ${githubLogin || "GitHub user"}. This repo appears only when SkillPulse finds analyzable commits.`, tone: "#fbbf24" };
    if (hasGithubIdentity) return { title: "Select a Contribution Analysis", body: `Connected as ${githubLogin || "your GitHub account"}. Only repos with your contribution analysis are listed.`, tone: accent };
    return { title: "Connect GitHub to Start", body: "Developer skills are calculated from your own GitHub contributions. Connect GitHub, then analyze a repository where your account has commits.", tone: accent };
  };
  const notice = getModeNotice();

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        input, select { font-family: 'DM Sans', sans-serif; }
        .sk { background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%); background-size: 400% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 8px; }
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }
        .dim-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 24px 28px; transition: border-color 0.2s, background 0.3s ease; }
        .dim-card:hover { border-color: var(--border-hover); }
        .skl-select { background: var(--bg-input); border: 1px solid rgba(99,102,241,0.25); border-radius: 12px; color: var(--text-primary); font-family: 'DM Sans', sans-serif; font-size: 13.5px; padding: 10px 14px; outline: none; cursor: pointer; transition: border-color 0.2s; min-width: 220px; }
        .skl-select:focus { border-color: ${accent}80; }
        .skl-select option { background: var(--bg-base); color: var(--text-primary); }
        .skl-label { font-size: 12px; font-weight: 700; color: rgba(167,139,250,0.8); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 8px; display: block; }
        .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 32px; margin-top: 18px; }
        .skl-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; background: linear-gradient(135deg, ${accent}, #ec4899); border: none; border-radius: 10px; color: white; font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 16px ${accent}30; }
        .skl-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 8px 24px ${accent}40; }
        .legend-bar { display: flex; gap: 20px; flex-wrap: wrap; margin-top: 16px; padding: 10px 14px; background: var(--bg-input); border-radius: 8px; border: 1px solid var(--border); }
      `}</style>

      <div style={{ minHeight: "100vh", padding: "36px 40px 80px", color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif", background: "var(--bg-gradient)", transition: "background 0.3s ease" }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>

          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "5px 14px", borderRadius: 999, border: `1px solid ${accent}40`, background: `${accent}12`, fontSize: 11, fontWeight: 700, letterSpacing: "0.8px", color: accent, textTransform: "uppercase" as const, width: "fit-content", marginBottom: 10 }}>Developer Skills</div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 26, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.5px", margin: "0 0 4px" }}>Developer Contribution Dashboard</h1>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>Skill scores based only on your own GitHub contribution scope.</p>
          </div>

          {!loadingSummary && summary && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "16px 20px", background: `${notice.tone}0F`, border: `1px solid ${notice.tone}35`, borderRadius: 14 }}>
              <div style={{ width: 34, height: 34, borderRadius: 10, background: `${notice.tone}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: notice.tone }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", marginBottom: 4 }}>{notice.title}</div>
                <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>{notice.body}</div>
                {!hasGithubIdentity && <button className="skl-btn-primary" style={{ marginTop: 12 }} onClick={connectGithub}>Connect GitHub</button>}
              </div>
            </div>
          )}

          <div className="dim-card">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <label className="skl-label">Overall Contribution Score</label>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{hasGithubIdentity ? "Aggregated only from repositories where SkillPulse analyzed your contributions" : "Connect GitHub to analyze repositories from your own contributions"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {loadingSummary ? <div className="sk" style={{ width: 80, height: 40 }} /> : (
                  <>
                    <div style={{ fontSize: 42, fontWeight: 800, color: "var(--text-primary)", lineHeight: 1, letterSpacing: "-2px" }}>{overall.toFixed(1)}</div>
                    <div style={{ marginTop: 4, display: "flex", justifyContent: "flex-end" }}>{summary && <DeltaBadge delta={summary.delta} large />}</div>
                  </>
                )}
              </div>
            </div>
            {loadingSummary ? (
              <div style={{ display: "flex", gap: 24 }}>
                {[1,2,3,4].map(i => (<div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}><div className="sk" style={{ width: 80, height: 80, borderRadius: "50%" }} /><div className="sk" style={{ width: 80, height: 14 }} /></div>))}
              </div>
            ) : (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {DIMENSIONS.map(dim => { const val = scores?.[dim.key] ?? 0; const delta = deltas?.[dim.key] ?? 0; return (
                  <div key={dim.key} style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
                    <ScoreRing value={val} size={80} />
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 4 }}>{dim.label}</div>
                      <DeltaBadge delta={delta} />
                    </div>
                  </div>
                ); })}
              </div>
            )}
          </div>

          <div className="dim-card" style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, color: "var(--text-secondary)", fontWeight: 500, whiteSpace: "nowrap" }}>View your contribution analysis for:</span>
            {loadingSummary ? <div className="sk" style={{ width: 220, height: 36, borderRadius: 10 }} /> : (
              <select className="skl-select" value={selectedId ?? ""} onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Select a repository…</option>
                {summary?.repos.map(r => (<option key={r.analysis_id} value={r.analysis_id}>{r.repo_name} ({r.branch}) - {r.completed_at ? new Date(r.completed_at).toLocaleDateString() : "latest"}</option>))}
              </select>
            )}
            {!selectedId && !loadingSummary && <span style={{ fontSize: 12, color: "var(--text-faint)", width: "100%" }}>Select a repository to view metrics and AI guidance for the files touched by your commits.</span>}
          </div>

          {selectedId && activeContext && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              {[
                { label: "GitHub Identity", value: activeContext.has_github_identity ? activeContext.github_login : "Not connected", color: "var(--text-primary)" },
                { label: "Repository Access", value: activeContext.is_private ? "Private repository" : "Public repository", color: "var(--text-primary)" },
                { label: "Contribution Scope", value: activeContext.user_contributed ? `${activeContext.commit_count_sample || 1}+ commits found` : activeContext.has_github_identity ? "Not available" : "Connect GitHub to check", color: activeContext.user_contributed ? "#34d399" : "var(--text-primary)" },
              ].map(({ label, value, color }) => (
                <div key={label} className="dim-card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 6, fontWeight: 700 }}>{label}</div>
                  <div style={{ fontSize: 14, color, fontWeight: 700 }}>{value}</div>
                </div>
              ))}
            </div>
          )}

          {selectedId && (
            <>
              {loadingDetail ? (
                <>{[1,2,3,4].map(i => (<div key={i} className="dim-card"><div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}><div className="sk" style={{ width: 80, height: 80, borderRadius: "50%" }} /><div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}><div className="sk" style={{ height: 18, width: "40%" }} /><div className="sk" style={{ height: 13, width: "60%" }} /><div className="sk" style={{ height: 28, width: "22%", borderRadius: 20 }} /></div></div></div>))}</>
              ) : detail ? (
                DIMENSIONS.map(dim => {
                  const score = dim.getScore(detail); const delta = deltas?.[dim.key] ?? 0;
                  const metrics = dim.getMetrics(detail); const insights = dim.getInsights(detail);
                  return (
                    <div key={dim.key} className="dim-card">
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flex: 1 }}>
                          <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center", color: accent }}>{dim.icon}</div>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", marginBottom: 3 }}>{dim.label}</div>
                            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{dim.desc}</div>
                            <div style={{ marginTop: 8 }}><DeltaBadge delta={delta} /></div>
                          </div>
                        </div>
                        <ScoreRing value={score} size={72} />
                      </div>
                      <div style={{ marginTop: 20 }}>
                        <label className="skl-label">Contribution Signals</label>
                        <div className="metrics-grid">{metrics.map((m, i) => (<MetricBar key={i} label={m.label} value={m.value} sub={m.sub} adjustedValue={(m as any).adjustedValue} confidence={(m as any).confidence} />))}</div>
                      </div>
                      {(dim.key === "code_quality" || dim.key === "maintainability") && (
                        <div className="legend-bar">
                          {[{ color: "#10b981", label: "Static (rule-based) score" }, { color: "rgba(248,113,113,0.55)", label: "AI penalty zone" }].map(({ color, label }) => (
                            <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <div style={{ width: 24, height: 5, borderRadius: 3, background: color }} />
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
                            </div>
                          ))}
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <div style={{ display: "flex", gap: 2 }}>{[true, true, true, false, false].map((f, i) => (<div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: f ? "#34d399" : "var(--border-hover)", border: f ? "none" : "1px solid var(--border-hover)" }} />))}</div>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>AI confidence (1–5 dots)</span>
                          </div>
                        </div>
                      )}
                      {dim.key === "architecture" && (
                        <div className="legend-bar">
                          {[
                            { color: "#818cf8", label: "AI semantic review (LLM)" },
                            { color: "#34d399", label: "Hybrid (AI + AST/radon)" },
                            { color: "#fbbf24", label: "Tool-based (import graph)" },
                          ].map(({ color, label }) => (
                            <div key={label} style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <div style={{ width: 24, height: 5, borderRadius: 3, background: color }} />
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
                            </div>
                          ))}
                          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <div style={{ display: "flex", gap: 2 }}>{[true, true, true, false, false].map((f, i) => (<div key={i} style={{ width: 5, height: 5, borderRadius: "50%", background: f ? "#34d399" : "var(--border-hover)", border: f ? "none" : "1px solid var(--border-hover)" }} />))}</div>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>AI confidence on hybrid/semantic metrics</span>
                          </div>
                        </div>
                      )}
                      {insights.length > 0 ? <InsightBox lines={insights} /> : (
                        <div style={{ marginTop: 14, padding: "12px 16px", background: "var(--bg-input)", borderRadius: 10, fontSize: 12, color: "var(--text-faint)" }}>AI guidance is not available for this dimension yet.</div>
                      )}
                    </div>
                  );
                })
              ) : null}
            </>
          )}

          {!selectedId && !loadingSummary && summary && summary.repos.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 20px", background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 16 }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: `${accent}15`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/></svg>
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>No contribution analyses yet</div>
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Connect GitHub and analyze a repository where your account has commits.</div>
            </div>
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}