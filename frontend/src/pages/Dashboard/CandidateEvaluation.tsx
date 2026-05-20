import { useEffect, useMemo, useState } from "react";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

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

type SortKey =
  | "candidate_name"
  | "overall_score"
  | "code_quality"
  | "problem_solving"
  | "architecture"
  | "security"
  | "priority";

type SortDirection = "asc" | "desc";

type BadgeTone = {
  label: string;
  fg: string;
  bg: string;
  border: string;
};

const pageBg = "#0d1117";
const cardBg = "#161b22";
const muted = "rgba(148,163,184,0.72)";
const accent = "#00c9a7";
const ctaGradient = "linear-gradient(135deg, #00c9a7 0%, #f5a623 100%)";

const priorityBadge = (score: number): BadgeTone => {
  if (score >= 85) {
    return { label: "High Priority", fg: "#fecdd3", bg: "rgba(248,113,113,0.16)", border: "rgba(248,113,113,0.45)" };
  }
  if (score >= 65) {
    return { label: "Medium Priority", fg: "#fde68a", bg: "rgba(245,158,11,0.16)", border: "rgba(245,158,11,0.45)" };
  }
  return { label: "Low Priority", fg: "#cbd5f5", bg: "rgba(148,163,184,0.18)", border: "rgba(148,163,184,0.45)" };
};

const qualityBadge = (score: number): BadgeTone => {
  if (score >= 85) {
    return { label: "Excellent", fg: "#bbf7d0", bg: "rgba(34,197,94,0.16)", border: "rgba(34,197,94,0.45)" };
  }
  if (score >= 65) {
    return { label: "Good", fg: "#bae6fd", bg: "rgba(14,165,233,0.16)", border: "rgba(14,165,233,0.45)" };
  }
  return { label: "Developing", fg: "#fed7aa", bg: "rgba(249,115,22,0.16)", border: "rgba(249,115,22,0.45)" };
};

const priorityLevel = (score: number) => {
  if (score >= 85) return "High";
  if (score >= 65) return "Medium";
  return "Low";
};

const priorityOrder: Record<string, number> = {
  High: 3,
  Medium: 2,
  Low: 1,
};

const initialsFromName = (name: string) => {
  if (!name) return "?";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

const formatNumber = (value: number) => (Number.isFinite(value) ? value.toLocaleString() : "0");

const sortRows = (rows: CandidateRow[], key: SortKey, dir: SortDirection) => {
  const sorted = [...rows].sort((a, b) => {
    if (key === "candidate_name") {
      return a.candidate_name.localeCompare(b.candidate_name);
    }
    if (key === "priority") {
      return priorityOrder[priorityLevel(a.overall_score)] - priorityOrder[priorityLevel(b.overall_score)];
    }
    const aValue = a[key];
    const bValue = b[key];
    return aValue - bValue;
  });
  return dir === "asc" ? sorted : sorted.reverse();
};

const candidateKey = (row: CandidateRow) => (
  (row.github_login || row.candidate_name || String(row.run_id)).trim().toLowerCase()
);

const latestCandidateRows = (rows: CandidateRow[]) => {
  const byCandidate = new Map<string, CandidateRow>();
  rows.forEach((row) => {
    const key = candidateKey(row);
    const existing = byCandidate.get(key);
    if (!existing || row.run_id > existing.run_id) {
      byCandidate.set(key, row);
    }
  });
  return Array.from(byCandidate.values());
};

export default function CandidateEvaluation() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("All Priority");
  const [sortKey, setSortKey] = useState<SortKey>("overall_score");
  const [sortDir, setSortDir] = useState<SortDirection>("desc");
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CandidateRow | null>(null);

  useEffect(() => {
    let active = true;

    const loadCandidates = async (showLoading = false) => {
      if (showLoading) {
        setLoading(true);
      }
      try {
        const res = await api.get("/analysis/recruiter/candidates");
        if (!active) return;
        setCandidates(latestCandidateRows(Array.isArray(res.data) ? res.data : []));
      } finally {
        if (active && showLoading) setLoading(false);
      }
    };

    loadCandidates(true);
    const interval = window.setInterval(() => {
      loadCandidates();
    }, 5000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return candidates.filter((row) => {
      const matchesQuery =
        !query ||
        row.candidate_name.toLowerCase().includes(query) ||
        row.github_login.toLowerCase().includes(query);
      const priority = priorityLevel(row.overall_score);
      const matchesPriority = priorityFilter === "All Priority" || priority === priorityFilter;
      return matchesQuery && matchesPriority;
    });
  }, [candidates, search, priorityFilter]);

  const sorted = useMemo(() => sortRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);

  const summary = useMemo(() => {
    const total = candidates.length;
    const high = candidates.filter((row) => row.overall_score >= 85).length;
    const avgScore = total
      ? Math.round(candidates.reduce((sum, row) => sum + row.overall_score, 0) / total)
      : 0;
    const totalContributions = candidates.reduce((sum, row) => sum + row.contribution_count, 0);
    const timeSaved = totalContributions ? Math.max(1, Math.round(totalContributions / 45)) : 0;
    return { total, high, avgScore, timeSaved };
  }, [candidates]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("desc");
  };

  const handleDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    const runId = deleteTarget.run_id;
    setDeletingIds((prev) => {
      const next = new Set(prev);
      next.add(runId);
      return next;
    });

    try {
      await api.delete(`/analysis/recruiter/candidates/${runId}`);
      setCandidates((prev) => prev.filter((row) => row.run_id !== runId));
      setDeleteTarget(null);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(runId);
        return next;
      });
    }
  };

  return (
    <DashboardLayout>
      <div
        style={{
          minHeight: "100vh",
          background: `radial-gradient(circle at 15% 10%, rgba(0,201,167,0.16), transparent 48%), radial-gradient(circle at 85% 0%, rgba(245,166,35,0.14), transparent 40%), ${pageBg}`,
          color: "#f8fafc",
          padding: "36px 40px 70px",
          fontFamily: "'DM Sans', sans-serif",
        }}
      >
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "20px", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                padding: "6px 12px",
                borderRadius: "999px",
                background: "rgba(0,201,167,0.16)",
                border: "1px solid rgba(0,201,167,0.4)",
                color: "#a7f3d0",
                fontSize: "11px",
                fontWeight: 700,
                letterSpacing: "0.7px",
                textTransform: "uppercase",
                width: "fit-content",
              }}>
                Recruiter View
              </div>
              <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "32px", fontWeight: 800, margin: 0 }}>
                Candidate Evaluation
              </h1>
              <p style={{ margin: 0, color: muted, maxWidth: "520px", fontSize: "14.5px" }}>
                Repository-based candidate screening and interview prioritization
              </p>
            </div>
            <button
              type="button"
              style={{
                border: "none",
                padding: "10px 18px",
                borderRadius: "999px",
                background: ctaGradient,
                color: "#0b0f14",
                fontWeight: 700,
                fontSize: "13px",
                cursor: "pointer",
                boxShadow: "0 8px 18px rgba(0,0,0,0.28)",
              }}
            >
              Export Shortlist
            </button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
            {[
              {
                label: "Total Candidates",
                value: summary.total,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14" />
                    <path d="M6 11l6-6 6 6" />
                  </svg>
                ),
              },
              {
                label: "High Priority",
                value: summary.high,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2l3 7h7l-5.5 4.2 2 7.8-6.5-4.6-6.5 4.6 2-7.8L2 9h7z" />
                  </svg>
                ),
              },
              {
                label: "Avg Score",
                value: summary.avgScore,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 17l6-6 4 4 7-7" />
                    <path d="M21 7v6h-6" />
                  </svg>
                ),
              },
              {
                label: "Time Saved (hrs)",
                value: summary.timeSaved,
                icon: (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 3" />
                  </svg>
                ),
              },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: cardBg,
                  borderRadius: "16px",
                  padding: "16px",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "14px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  <span style={{ fontSize: "12px", color: muted }}>{stat.label}</span>
                  <span style={{ fontSize: "22px", fontWeight: 700 }}>{formatNumber(stat.value)}</span>
                </div>
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "12px",
                  background: "rgba(0,201,167,0.14)",
                  display: "grid",
                  placeItems: "center",
                  color: "#8ff7e3",
                }}>
                  {stat.icon}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "14px", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", flex: 1, minWidth: "260px" }}>
              <div style={{
                flex: 1,
                minWidth: "240px",
                background: cardBg,
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.06)",
                display: "flex",
                alignItems: "center",
                padding: "10px 14px",
                gap: "10px",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: muted }}>
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.3-4.3" />
                </svg>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by Name or GitHub username..."
                  style={{
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "#f8fafc",
                    fontSize: "14px",
                    flex: 1,
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value)}
                style={{
                  background: cardBg,
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#f8fafc",
                  padding: "10px 12px",
                  fontSize: "13px",
                }}
              >
                {["All Priority", "High", "Medium", "Low"].map((option) => (
                  <option key={option} value={option} style={{ color: "#0b0f14" }}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
            {loading && (
              <div style={{ color: muted, fontSize: "14px" }}>Loading candidate scores...</div>
            )}
            {!loading && sorted.length === 0 && (
              <div style={{ color: muted, fontSize: "14px" }}>No candidates match the current filters.</div>
            )}
            {!loading && sorted.map((row) => {
              const priority = priorityBadge(row.overall_score);
              const quality = qualityBadge(row.overall_score);
              return (
                <div
                  key={row.run_id}
                  style={{
                    background: cardBg,
                    borderRadius: "18px",
                    padding: "20px",
                    border: "1px solid rgba(255,255,255,0.06)",
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(120px, 160px)",
                    gap: "18px",
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <div style={{
                          width: "46px",
                          height: "46px",
                          borderRadius: "50%",
                          background: "rgba(0,201,167,0.18)",
                          border: "1px solid rgba(0,201,167,0.45)",
                          display: "grid",
                          placeItems: "center",
                          fontWeight: 700,
                        }}>
                          {initialsFromName(row.candidate_name)}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <span style={{ fontSize: "16px", fontWeight: 700 }}>{row.candidate_name}</span>
                          <span style={{ color: muted, fontSize: "12.5px" }}>@{row.github_login}</span>
                        </div>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                        <span style={{
                          padding: "6px 10px",
                          borderRadius: "999px",
                          border: `1px solid ${priority.border}`,
                          background: priority.bg,
                          color: priority.fg,
                          fontSize: "12px",
                          fontWeight: 600,
                        }}>
                          {priority.label}
                        </span>
                        <span style={{
                          padding: "6px 10px",
                          borderRadius: "999px",
                          border: `1px solid ${quality.border}`,
                          background: quality.bg,
                          color: quality.fg,
                          fontSize: "12px",
                          fontWeight: 600,
                        }}>
                          {quality.label}
                        </span>
                        <span style={{ fontSize: "12px", color: muted }}>
                          {row.repo_count} repos | {formatNumber(row.contribution_count)} contributions
                        </span>
                      </div>
                    </div>

                    <div style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: "14px",
                    }}>
                      {[
                        { label: "Code Quality", value: row.code_quality },
                        { label: "Problem Solving", value: row.problem_solving },
                        { label: "Architecture", value: row.architecture },
                        { label: "Maintainability", value: row.maintainability },
                        { label: "Security", value: row.security },
                      ].map((item) => (
                        <div key={item.label} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                            <span style={{ fontSize: "12px", color: muted }}>{item.label}</span>
                            <span style={{ fontSize: "12px", color: "#f8fafc", fontWeight: 600 }}>
                              {clampScore(item.value)}
                            </span>
                          </div>
                          <div style={{ height: "6px", borderRadius: "999px", background: "rgba(148,163,184,0.22)", overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${clampScore(item.value)}%`,
                                height: "100%",
                                background: accent,
                                borderRadius: "999px",
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                      <button
                        type="button"
                        style={{
                          borderRadius: "10px",
                          padding: "10px 14px",
                          background: "rgba(15,23,42,0.8)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          color: "#f8fafc",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        View Full Report
                      </button>
                      <button
                        type="button"
                        style={{
                          borderRadius: "10px",
                          padding: "10px 14px",
                          background: "transparent",
                          border: "1px solid rgba(255,255,255,0.3)",
                          color: "#e2e8f0",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Compare
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(row)}
                        disabled={deletingIds.has(row.run_id)}
                        style={{
                          borderRadius: "10px",
                          padding: "10px 14px",
                          background: "rgba(248,113,113,0.12)",
                          border: "1px solid rgba(248,113,113,0.4)",
                          color: "#fecaca",
                          fontSize: "12.5px",
                          fontWeight: 600,
                          cursor: deletingIds.has(row.run_id) ? "not-allowed" : "pointer",
                          opacity: deletingIds.has(row.run_id) ? 0.6 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "8px",
                        }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M19 6l-1 14H6L5 6" />
                          <path d="M10 11v5" />
                          <path d="M14 11v5" />
                        </svg>
                        {deletingIds.has(row.run_id) ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>

                  <div style={{
                    borderLeft: "1px solid rgba(255,255,255,0.08)",
                    paddingLeft: "18px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "flex-end",
                    gap: "6px",
                  }}>
                    <span style={{ fontSize: "11px", color: muted, textTransform: "uppercase", letterSpacing: "0.6px" }}>
                      Overall Score
                    </span>
                    <span style={{ fontSize: "40px", fontWeight: 800 }}>{clampScore(row.overall_score)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{
            background: "rgba(15,23,42,0.6)",
            borderRadius: "14px",
            padding: "16px 18px",
            border: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            gap: "12px",
            alignItems: "flex-start",
          }}>
            <div style={{
              width: "32px",
              height: "32px",
              borderRadius: "10px",
              background: "rgba(56,189,248,0.16)",
              display: "grid",
              placeItems: "center",
              color: "#7dd3fc",
              flexShrink: 0,
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 16v-4" />
                <path d="M12 8h.01" />
              </svg>
            </div>
            <p style={{ margin: 0, color: "rgba(226,232,240,0.8)", fontSize: "13.5px", lineHeight: 1.5 }}>
              SkillPulse analyzes candidates' GitHub repositories to provide objective skill scores. Interview priority
              recommendations are based on overall scores, skill balance, and code quality metrics. This data-driven
              approach reduces interview costs and eliminates bias in initial screening.
            </p>
          </div>

          <div style={{
            background: cardBg,
            borderRadius: "16px",
            padding: "18px",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div>
                <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Quick Comparison</h2>
                <p style={{ margin: "4px 0 0", color: muted, fontSize: "12.5px" }}>Sortable overview of candidate scores</p>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: muted }}>
                    {[
                      { label: "Candidate", key: "candidate_name" },
                      { label: "Overall", key: "overall_score" },
                      { label: "Code Quality", key: "code_quality" },
                      { label: "Problem Solving", key: "problem_solving" },
                      { label: "Architecture", key: "architecture" },
                      { label: "Security", key: "security" },
                      { label: "Priority", key: "priority" },
                    ].map((header) => (
                      <th key={header.label} style={{ padding: "10px 8px", fontWeight: 600 }}>
                        <button
                          type="button"
                          onClick={() => toggleSort(header.key as SortKey)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "inherit",
                            fontWeight: 600,
                            cursor: "pointer",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "6px",
                          }}
                        >
                          {header.label}
                          {sortKey === header.key && (
                            <span style={{ fontSize: "10px" }}>{sortDir === "asc" ? "^" : "v"}</span>
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row, index) => {
                    const priority = priorityBadge(row.overall_score);
                    return (
                      <tr key={row.run_id} style={{ background: index % 2 === 0 ? "rgba(255,255,255,0.02)" : "transparent" }}>
                        <td style={{ padding: "12px 8px", fontWeight: 600 }}>{row.candidate_name}</td>
                        <td style={{ padding: "12px 8px" }}>{clampScore(row.overall_score)}</td>
                        <td style={{ padding: "12px 8px" }}>{clampScore(row.code_quality)}</td>
                        <td style={{ padding: "12px 8px" }}>{clampScore(row.problem_solving)}</td>
                        <td style={{ padding: "12px 8px" }}>{clampScore(row.architecture)}</td>
                        <td style={{ padding: "12px 8px" }}>{clampScore(row.security)}</td>
                        <td style={{ padding: "12px 8px" }}>
                          <span style={{
                            padding: "5px 10px",
                            borderRadius: "999px",
                            border: `1px solid ${priority.border}`,
                            background: priority.bg,
                            color: priority.fg,
                            fontSize: "11.5px",
                            fontWeight: 600,
                          }}>
                            {priority.label.replace(" Priority", "")}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {deleteTarget && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-candidate-title"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(2,6,23,0.72)",
              display: "grid",
              placeItems: "center",
              padding: "24px",
            }}
          >
            <div style={{
              width: "min(460px, 100%)",
              background: cardBg,
              border: "1px solid rgba(248,113,113,0.35)",
              borderRadius: "18px",
              boxShadow: "0 28px 90px rgba(0,0,0,0.45)",
              padding: "22px",
            }}>
              <div style={{ display: "flex", gap: "14px", alignItems: "flex-start" }}>
                <div style={{
                  width: "38px",
                  height: "38px",
                  borderRadius: "12px",
                  background: "rgba(248,113,113,0.14)",
                  color: "#fecaca",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                    <path d="M10 11v5" />
                    <path d="M14 11v5" />
                  </svg>
                </div>
                <div>
                  <h2 id="delete-candidate-title" style={{ margin: 0, fontSize: "19px", fontWeight: 800 }}>
                    Delete Candidate Analysis
                  </h2>
                  <p style={{ margin: "10px 0 0", color: muted, fontSize: "14px", lineHeight: 1.55 }}>
                    This will permanently delete the candidate analysis history, scores, recommendations, and cached results. The repository can be analyzed again after deletion.
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "22px" }}>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deletingIds.has(deleteTarget.run_id)}
                  style={{
                    borderRadius: "10px",
                    padding: "10px 14px",
                    background: "rgba(15,23,42,0.8)",
                    border: "1px solid rgba(255,255,255,0.12)",
                    color: "#f8fafc",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: deletingIds.has(deleteTarget.run_id) ? "not-allowed" : "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deletingIds.has(deleteTarget.run_id)}
                  style={{
                    borderRadius: "10px",
                    padding: "10px 14px",
                    background: "rgba(220,38,38,0.9)",
                    border: "1px solid rgba(248,113,113,0.5)",
                    color: "#fff",
                    fontSize: "13px",
                    fontWeight: 800,
                    cursor: deletingIds.has(deleteTarget.run_id) ? "not-allowed" : "pointer",
                    opacity: deletingIds.has(deleteTarget.run_id) ? 0.65 : 1,
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18" />
                    <path d="M8 6V4h8v2" />
                    <path d="M19 6l-1 14H6L5 6" />
                  </svg>
                  {deletingIds.has(deleteTarget.run_id) ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
