import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

// ─── Types 
type CandidateRow = {
  candidate_name: string;
  github_login: string;
  overall_score: number;
  code_quality: number;
  problem_solving: number;
  architecture: number;
  maintainability: number;
  security: number;
  repo_count: number;
  contribution_count: number;
  run_id: number;
};

type SortKey = "candidate_name" | "overall_score" | "code_quality" | "problem_solving" | "architecture" | "security" | "priority";
type SortDir = "asc" | "desc";

// ─── Helpers 

const accent = "#6366f1";

const scoreColor = (s: number) => {
  if (s >= 80) return "#34d399";
  if (s >= 60) return "#fbbf24";
  return "#f87171";
};

const priorityBadge = (score: number) => {
  if (score >= 85) return { label: "High Priority",   fg: "#f87171", bg: "rgba(248,113,113,0.1)",  border: "rgba(248,113,113,0.25)"  };
  if (score >= 65) return { label: "Medium Priority", fg: "#fbbf24", bg: "rgba(251,191,36,0.1)",   border: "rgba(251,191,36,0.25)"   };
  return              { label: "Low Priority",    fg: "#94a3b8", bg: "rgba(148,163,184,0.08)", border: "rgba(148,163,184,0.2)"   };
};

const qualityBadge = (score: number) => {
  if (score >= 85) return { label: "Excellent",  fg: "#34d399", bg: "rgba(52,211,153,0.1)",  border: "rgba(52,211,153,0.25)"  };
  if (score >= 65) return { label: "Good",       fg: "#818cf8", bg: "rgba(99,102,241,0.1)",  border: "rgba(99,102,241,0.25)"  };
  return              { label: "Developing", fg: "#fb923c", bg: "rgba(251,146,60,0.1)",  border: "rgba(251,146,60,0.25)"  };
};

const priorityLevel = (s: number) => s >= 85 ? "High" : s >= 65 ? "Medium" : "Low";
const priorityOrder: Record<string, number> = { High: 3, Medium: 2, Low: 1 };

const initials = (name: string) =>
  name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2) || "?";

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

const latestRows = (rows: CandidateRow[]) => {
  const map = new Map<string, CandidateRow>();
  rows.forEach(r => {
    const key = (r.github_login || r.candidate_name || String(r.run_id)).trim().toLowerCase();
    const ex = map.get(key);
    if (!ex || r.run_id > ex.run_id) map.set(key, r);
  });
  return Array.from(map.values());
};

const sortRows = (rows: CandidateRow[], key: SortKey, dir: SortDir) => {
  const sorted = [...rows].sort((a, b) => {
    if (key === "candidate_name") return a.candidate_name.localeCompare(b.candidate_name);
    if (key === "priority") return priorityOrder[priorityLevel(a.overall_score)] - priorityOrder[priorityLevel(b.overall_score)];
    return (a[key] as number) - (b[key] as number);
  });
  return dir === "asc" ? sorted : sorted.reverse();
};

// components

function Skeleton({ w, h, radius = 8 }: { w: number | string; h: number; radius?: number }) {
  return <div className="sk" style={{ width: w, height: h, borderRadius: radius }} />;
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
        <span style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)" }}>{label}</span>
        <span style={{ fontSize: "11.5px", fontWeight: 700, color }}>{clamp(value)}</span>
      </div>
      <div style={{ height: "5px", borderRadius: "999px", background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
        <div style={{ width: `${clamp(value)}%`, height: "100%", background: color, borderRadius: "999px", transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

// ─── Compare Modal

function CompareModal({
  candidate,
  allCandidates,
  onClose,
}: {
  candidate: CandidateRow;
  allCandidates: CandidateRow[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const others = allCandidates.filter(c => c.run_id !== candidate.run_id);
  const opponent = others.find(c => c.run_id === selectedId) ?? null;

  const SKILLS: Array<{ key: keyof CandidateRow; label: string }> = [
    { key: "overall_score",   label: "Overall"         },
    { key: "code_quality",    label: "Code Quality"    },
    { key: "problem_solving", label: "Problem Solving" },
    { key: "architecture",    label: "Architecture"    },
    { key: "maintainability", label: "Maintainability" },
    { key: "security",        label: "Security"        },
  ];

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: "24px" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: "min(720px, 100%)", background: "#0f0f1a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "20px", padding: "28px", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "22px" }}>
          <div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800, color: "white", margin: 0 }}>Compare Candidates</h2>
            <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", margin: "4px 0 0" }}>Side-by-side skill comparison</p>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.5)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>✕</button>
        </div>

        {/* Candidate picker */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", fontWeight: 700, marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Compare {candidate.candidate_name} with:
          </div>
          <select
            value={selectedId ?? ""}
            onChange={e => setSelectedId(Number(e.target.value) || null)}
            style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "white", fontSize: "13px", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
          >
            <option value="" style={{ background: "#0f0f1a" }}>— Select a candidate —</option>
            {others.map(c => (
              <option key={c.run_id} value={c.run_id} style={{ background: "#0f0f1a" }}>
                {c.candidate_name} (Score: {clamp(c.overall_score)})
              </option>
            ))}
          </select>
        </div>

        {/* Comparison grid */}
        {opponent ? (
          <div>
            {/* Name headers */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 40px 1fr", gap: "12px", marginBottom: "20px", alignItems: "center" }}>
              <div style={{ textAlign: "center", padding: "14px", borderRadius: "12px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: `linear-gradient(135deg, ${accent}, #ec4899)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 800, color: "white", margin: "0 auto 8px" }}>{initials(candidate.candidate_name)}</div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "white" }}>{candidate.candidate_name}</div>
                <div style={{ fontSize: "24px", fontWeight: 900, color: scoreColor(candidate.overall_score), marginTop: "4px" }}>{clamp(candidate.overall_score)}</div>
              </div>
              <div style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.3)" }}>VS</div>
              <div style={{ textAlign: "center", padding: "14px", borderRadius: "12px", background: "rgba(251,146,60,0.06)", border: "1px solid rgba(251,146,60,0.2)" }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: "linear-gradient(135deg, #fb923c, #f59e0b)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 800, color: "white", margin: "0 auto 8px" }}>{initials(opponent.candidate_name)}</div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "white" }}>{opponent.candidate_name}</div>
                <div style={{ fontSize: "24px", fontWeight: 900, color: scoreColor(opponent.overall_score), marginTop: "4px" }}>{clamp(opponent.overall_score)}</div>
              </div>
            </div>

            {/* Skills comparison */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {SKILLS.slice(1).map(({ key, label }) => {
                const aVal = clamp(candidate[key] as number);
                const bVal = clamp(opponent[key] as number);
                const aWins = aVal >= bVal;
                return (
                  <div key={key} style={{ padding: "12px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", fontWeight: 600, marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 60px 1fr", gap: "10px", alignItems: "center" }}>
                      <div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: aWins ? scoreColor(aVal) : "rgba(255,255,255,0.5)" }}>{aVal}</span>
                        </div>
                        <div style={{ height: "6px", borderRadius: "999px", background: "rgba(255,255,255,0.07)", overflow: "hidden" }}>
                          <div style={{ width: `${aVal}%`, height: "100%", background: aWins ? accent : "rgba(255,255,255,0.2)", borderRadius: "999px" }} />
                        </div>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        {aWins && aVal !== bVal ? (
                          <span style={{ fontSize: "11px", color: "#818cf8", fontWeight: 700 }}>←</span>
                        ) : !aWins && aVal !== bVal ? (
                          <span style={{ fontSize: "11px", color: "#fb923c", fontWeight: 700 }}>→</span>
                        ) : (
                          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>—</span>
                        )}
                      </div>
                      <div>
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "5px" }}>
                          <span style={{ fontSize: "13px", fontWeight: 700, color: !aWins ? scoreColor(bVal) : "rgba(255,255,255,0.5)" }}>{bVal}</span>
                        </div>
                        <div style={{ height: "6px", borderRadius: "999px", background: "rgba(255,255,255,0.07)", overflow: "hidden", transform: "scaleX(-1)" }}>
                          <div style={{ width: `${bVal}%`, height: "100%", background: !aWins ? "#fb923c" : "rgba(255,255,255,0.2)", borderRadius: "999px" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "32px", color: "rgba(255,255,255,0.25)", fontSize: "13px", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: "12px" }}>
            Select a candidate above to compare
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main 

export default function CandidateEvaluation() {
  const navigate = useNavigate();

  const [candidates, setCandidates]         = useState<CandidateRow[]>([]);
  const [loading, setLoading]               = useState(true);
  const [search, setSearch]                 = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All Priority");
  const [sortKey, setSortKey]               = useState<SortKey>("overall_score");
  const [sortDir, setSortDir]               = useState<SortDir>("desc");
  const [deletingIds, setDeletingIds]       = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget]     = useState<CandidateRow | null>(null);
  const [compareTarget, setCompareTarget]   = useState<CandidateRow | null>(null);
  const [pollingActive, setPollingActive]   = useState(true);

  // ── Fetch
  const load = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const res = await api.get("/analysis/recruiter/candidates");
      setCandidates(latestRows(Array.isArray(res.data) ? res.data : []));
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // ── Polling 
  useEffect(() => {
    let active = true;
    load(true);
    const iv = window.setInterval(() => {
      if (active && pollingActive) load();
    }, 5000);
    return () => { active = false; window.clearInterval(iv); };
  }, [pollingActive]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return candidates.filter(r => {
      const matchQ = !q || r.candidate_name.toLowerCase().includes(q) || r.github_login.toLowerCase().includes(q);
      const matchP = priorityFilter === "All Priority" || priorityLevel(r.overall_score) === priorityFilter;
      return matchQ && matchP;
    });
  }, [candidates, search, priorityFilter]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  const summary = useMemo(() => {
    const total = candidates.length;
    const high  = candidates.filter(r => r.overall_score >= 85).length;
    const avg   = total ? Math.round(candidates.reduce((s, r) => s + r.overall_score, 0) / total) : 0;
    return { total, high, avg };
  }, [candidates]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) { setSortDir(d => d === "asc" ? "desc" : "asc"); return; }
    setSortKey(key); setSortDir("desc");
  };

  // ── Delete 
  const handleDelete = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.run_id;
    setPollingActive(false);
    setDeletingIds(prev => new Set(prev).add(id));
    setDeleteTarget(null);

    try {
      await api.delete(`/recruiter/candidates/${id}`);
      setCandidates(prev => prev.filter(r => r.run_id !== id));
      const res = await api.get("/analysis/recruiter/candidates");
      setCandidates(latestRows(Array.isArray(res.data) ? res.data : []));
    } catch (err) {
      console.error("Delete failed:", err);
      await load();
    } finally {
      setDeletingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
      setPollingActive(true);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }
        .sk {
          background: linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.04) 75%);
          background-size:400% 100%; animation: shimmer 1.5s ease-in-out infinite;
        }
        .cand-card { transition: border-color 0.2s, background 0.2s; }
        .cand-card:hover { border-color: rgba(99,102,241,0.25) !important; background: rgba(255,255,255,0.035) !important; }
        .th-btn { background: transparent; border: none; color: rgba(255,255,255,0.4); font-weight: 600; cursor: pointer; font-size: 12px; font-family: 'DM Sans', sans-serif; display: inline-flex; align-items: center; gap: 4px; }
        .th-btn:hover { color: white; }
        select option { background: #0f0f1a; }
      `}</style>

      {/* ── Background wrapper matching Profile page ── */}
      <div style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 10% 0%, rgba(99,102,241,0.18), transparent 45%), radial-gradient(circle at 90% 20%, rgba(236,72,153,0.12), transparent 40%), #0a0a0f",
        color: "rgba(226,232,240,0.9)",
        fontFamily: "'DM Sans', sans-serif",
      }}>

        {/* Compare modal */}
        {compareTarget && (
          <CompareModal
            candidate={compareTarget}
            allCandidates={sorted}
            onClose={() => setCompareTarget(null)}
          />
        )}

        {/* Delete confirm modal */}
        {deleteTarget && (
          <div onClick={() => setDeleteTarget(null)} style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)", display: "grid", placeItems: "center", padding: "24px" }}>
            <div onClick={e => e.stopPropagation()} style={{ width: "min(440px,100%)", background: "#0f0f1a", border: "1px solid rgba(248,113,113,0.3)", borderRadius: "18px", padding: "24px", boxShadow: "0 28px 80px rgba(0,0,0,0.5)" }}>
              <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                <div style={{ width: 38, height: 38, borderRadius: "10px", background: "rgba(248,113,113,0.12)", display: "grid", placeItems: "center", flexShrink: 0, color: "#f87171" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                </div>
                <div>
                  <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: "17px", fontWeight: 800, color: "white", margin: "0 0 8px" }}>Delete Candidate Analysis</h3>
                  <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", margin: 0, lineHeight: 1.6 }}>
                    This will permanently delete the analysis for <strong style={{ color: "rgba(255,255,255,0.7)" }}>{deleteTarget.candidate_name}</strong>. The repository can be re-analyzed after deletion.
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" }}>
                <button onClick={() => setDeleteTarget(null)} style={{ padding: "9px 16px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "rgba(255,255,255,0.5)", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                <button
                  onClick={handleDelete}
                  disabled={deletingIds.has(deleteTarget.run_id)}
                  style={{ padding: "9px 16px", borderRadius: "9px", border: "none", background: "#dc2626", color: "white", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", opacity: deletingIds.has(deleteTarget.run_id) ? 0.6 : 1 }}
                >
                  {deletingIds.has(deleteTarget.run_id) ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div style={{ maxWidth: "960px", margin: "0 auto", padding: "36px 40px 80px", display: "flex", flexDirection: "column", gap: "24px" }}>

          {/* ── Page Header ── */}
          <div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "5px 12px", borderRadius: "999px", background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8", fontSize: "11px", fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase", marginBottom: "8px" }}>
              Recruiter View
            </div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "26px", fontWeight: 800, color: "white", letterSpacing: "-0.5px", margin: "0 0 4px" }}>
              Candidate Evaluation
            </h1>
            <p style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
              Repository-based candidate screening and interview prioritization
            </p>
          </div>

          {/* ── Summary Stats — matching Profile's talent_overview cards ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px" }}>
            {[
              {
                label: "Total Candidates",
                value: summary.total,
                sub: "Total profiles analyzed",
                bg: "linear-gradient(135deg,rgba(99,102,241,0.8),rgba(236,72,153,0.7))",
                iconBg: "rgba(255,255,255,0.15)",
                iconColor: "rgba(255,255,255,0.9)",
                valColor: "white",
                subColor: "rgba(255,255,255,0.6)",
                border: "none",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                ),
              },
              {
                label: "High Priority",
                value: summary.high,
                sub: "Above priority threshold",
                bg: "rgba(248,113,113,0.06)",
                iconBg: "rgba(248,113,113,0.12)",
                iconColor: "#f87171",
                valColor: "#f87171",
                subColor: "rgba(255,255,255,0.3)",
                border: "1px solid rgba(248,113,113,0.2)",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                ),
              },
              {
                label: "Avg Score",
                value: summary.avg,
                sub: "Across all candidates",
                bg: "rgba(167,139,250,0.06)",
                iconBg: "rgba(167,139,250,0.12)",
                iconColor: "#a78bfa",
                valColor: "#a78bfa",
                subColor: "rgba(255,255,255,0.3)",
                border: "1px solid rgba(167,139,250,0.2)",
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
                ),
              },
            ].map(c => (
              <div key={c.label} style={{ padding: "22px 24px", borderRadius: "16px", background: c.bg, border: c.border }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                  <div style={{ fontSize: "11.5px", fontWeight: 700, color: c.valColor === "white" ? "rgba(255,255,255,0.75)" : c.valColor, textTransform: "uppercase", letterSpacing: "0.5px" }}>{c.label}</div>
                  <div style={{ width: 32, height: 32, borderRadius: "8px", background: c.iconBg, display: "flex", alignItems: "center", justifyContent: "center", color: c.iconColor }}>{c.icon}</div>
                </div>
                <div style={{ fontSize: "42px", fontWeight: 900, color: c.valColor, lineHeight: 1, marginBottom: "6px" }}>{c.value}</div>
                <div style={{ fontSize: "12px", color: c.subColor }}>{c.sub}</div>
              </div>
            ))}
          </div>

          {/* ── Filters ── */}
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "220px", display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", borderRadius: "10px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.3-4.3"/></svg>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or username…"
                style={{ background: "transparent", border: "none", outline: "none", color: "white", fontSize: "13px", flex: 1, fontFamily: "'DM Sans', sans-serif" }}
              />
            </div>
            <select
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value)}
              style={{ padding: "10px 14px", borderRadius: "10px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", color: "white", fontSize: "13px", fontFamily: "'DM Sans', sans-serif", outline: "none" }}
            >
              {["All Priority", "High", "Medium", "Low"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>

          {/* ── Candidate Cards ── */}
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {[1,2,3].map(i => <Skeleton key={i} w="100%" h={160} radius={16} />)}
            </div>
          )}

          {!loading && sorted.length === 0 && (
            <div style={{ textAlign: "center", padding: "64px 32px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "16px" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.3)", marginBottom: "4px" }}>No candidates match the current filters</div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.2)" }}>Try adjusting your search or priority filter</div>
            </div>
          )}

          {!loading && sorted.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {sorted.map(row => {
                const priority   = priorityBadge(row.overall_score);
                const quality    = qualityBadge(row.overall_score);
                const isDeleting = deletingIds.has(row.run_id);

                return (
                  <div
                    key={row.run_id}
                    className="cand-card"
                    style={{
                      padding: "20px 24px",
                      borderRadius: "16px",
                      background: "rgba(255,255,255,0.025)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      display: "grid",
                      gridTemplateColumns: "minmax(0,1fr) 100px",
                      gap: "20px",
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                      {/* Top row */}
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                          <div style={{ width: 44, height: 44, borderRadius: "50%", background: `linear-gradient(135deg, ${accent}, #ec4899)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 800, color: "white", flexShrink: 0 }}>
                            {initials(row.candidate_name)}
                          </div>
                          <div>
                            <div style={{ fontSize: "16px", fontWeight: 700, color: "white" }}>{row.candidate_name}</div>
                            {row.github_login && <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)" }}>@{row.github_login}</div>}
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ padding: "4px 10px", borderRadius: "999px", border: `1px solid ${priority.border}`, background: priority.bg, color: priority.fg, fontSize: "11.5px", fontWeight: 600 }}>{priority.label}</span>
                          <span style={{ padding: "4px 10px", borderRadius: "999px", border: `1px solid ${quality.border}`, background: quality.bg, color: quality.fg, fontSize: "11.5px", fontWeight: 600 }}>{quality.label}</span>
                          <span style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.3)", alignSelf: "center" }}>{row.repo_count} repo{row.repo_count !== 1 ? "s" : ""}</span>
                        </div>
                      </div>

                      {/* Skill bars */}
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "10px 20px" }}>
                        {[
                          { key: "code_quality",    label: "Code Quality"    },
                          { key: "problem_solving", label: "Problem Solving" },
                          { key: "architecture",    label: "Architecture"    },
                          { key: "maintainability", label: "Maintainability" },
                          { key: "security",        label: "Security"        },
                        ].map(({ key, label }) => (
                          <ScoreBar
                            key={key}
                            label={label}
                            value={row[key as keyof CandidateRow] as number}
                            color={scoreColor(row[key as keyof CandidateRow] as number)}
                          />
                        ))}
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <button
                          onClick={() => navigate(`/analysis/${row.run_id}`)}
                          style={{ padding: "8px 14px", borderRadius: "9px", border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.08)", color: "#818cf8", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.15s" }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(99,102,241,0.15)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(99,102,241,0.08)"; }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          View Full Report
                        </button>

                        <button
                          onClick={() => setCompareTarget(row)}
                          style={{ padding: "8px 14px", borderRadius: "9px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.6)", fontSize: "12.5px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: "6px", transition: "all 0.15s" }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "white"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "rgba(255,255,255,0.6)"; }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>
                          Compare
                        </button>

                        <button
                          onClick={() => setDeleteTarget(row)}
                          disabled={isDeleting}
                          style={{ padding: "8px 14px", borderRadius: "9px", border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.06)", color: "#f87171", fontSize: "12.5px", fontWeight: 600, cursor: isDeleting ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", display: "flex", alignItems: "center", gap: "6px", opacity: isDeleting ? 0.5 : 1, transition: "all 0.15s" }}
                          onMouseEnter={e => { if (!isDeleting) e.currentTarget.style.background = "rgba(248,113,113,0.12)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(248,113,113,0.06)"; }}
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
                          {isDeleting ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </div>

                    {/* Overall score */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", borderLeft: "1px solid rgba(255,255,255,0.06)", paddingLeft: "20px" }}>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "4px" }}>Overall</div>
                      <div style={{ fontSize: "44px", fontWeight: 900, color: scoreColor(row.overall_score), lineHeight: 1 }}>{clamp(row.overall_score)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Quick Comparison Table — matching Profile card style ── */}
          {!loading && sorted.length > 1 && (
            <div style={{ padding: "24px 28px", borderRadius: "16px", background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "18px", fontWeight: 800, color: "white", margin: "0 0 4px" }}>Quick Comparison</h2>
              <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", margin: "0 0 16px" }}>Sortable overview of all candidates</p>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                  <thead>
                    <tr>
                      {[
                        { label: "Candidate",       key: "candidate_name"  },
                        { label: "Overall",         key: "overall_score"   },
                        { label: "Code Quality",    key: "code_quality"    },
                        { label: "Problem Solving", key: "problem_solving" },
                        { label: "Architecture",    key: "architecture"    },
                        { label: "Security",        key: "security"        },
                        { label: "Priority",        key: "priority"        },
                      ].map(h => (
                        <th key={h.label} style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                          <button className="th-btn" onClick={() => toggleSort(h.key as SortKey)}>
                            {h.label}
                            {sortKey === h.key && <span style={{ fontSize: "10px" }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row, i) => {
                      const p = priorityBadge(row.overall_score);
                      return (
                        <tr key={row.run_id} style={{ background: i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                          <td style={{ padding: "10px 10px", fontWeight: 600, color: "white" }}>{row.candidate_name}</td>
                          <td style={{ padding: "10px 10px", color: scoreColor(row.overall_score), fontWeight: 700 }}>{clamp(row.overall_score)}</td>
                          <td style={{ padding: "10px 10px", color: "rgba(255,255,255,0.6)" }}>{clamp(row.code_quality)}</td>
                          <td style={{ padding: "10px 10px", color: "rgba(255,255,255,0.6)" }}>{clamp(row.problem_solving)}</td>
                          <td style={{ padding: "10px 10px", color: "rgba(255,255,255,0.6)" }}>{clamp(row.architecture)}</td>
                          <td style={{ padding: "10px 10px", color: "rgba(255,255,255,0.6)" }}>{clamp(row.security)}</td>
                          <td style={{ padding: "10px 10px" }}>
                            <span style={{ padding: "3px 8px", borderRadius: "999px", border: `1px solid ${p.border}`, background: p.bg, color: p.fg, fontSize: "11px", fontWeight: 600 }}>
                              {p.label.replace(" Priority", "")}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}