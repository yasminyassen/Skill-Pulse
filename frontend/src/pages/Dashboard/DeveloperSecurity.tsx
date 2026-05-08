import { useEffect, useMemo, useState } from "react";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

interface RepoOption {
  analysis_id: number;
  repo_name: string;
  full_name: string;
  branch: string;
  completed_at: string | null;
}

interface SecurityScoreBreakdown {
  overall: number;
  code_security: number;
  dependency_security: number;
  weights: {
    code_security: number;
    dependency_security: number;
  };
  finding_counts: {
    code_security: number;
    dependency_security: number;
  };
}

interface SecurityDetail {
  analysis_run_id: number;
  repo: string;
  branch: string;
  scores: {
    security_score: number;
    security_score_breakdown?: SecurityScoreBreakdown;
  };
  ai_insights?: {
    security_insights?: string;
  };
}

interface SecurityFinding {
  tool?: string;
  rule?: string;
  owasp_category?: string;
  line_number?: number;
  description?: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  file_path: string;
}

interface SecurityReport {
  analysis_id: number;
  total_findings: number;
  severity_distribution: Record<string, number>;
  tool_distribution: Record<string, number>;
  owasp_distribution: Record<string, number>;
  top_vulnerable_files?: Record<string, number>;
  categorized_findings: Record<string, Record<string, Omit<SecurityFinding, "severity" | "file_path">[]>>;
  failed_tools?: string[];
  security_score_breakdown?: SecurityScoreBreakdown | null;
}

const severityConfig = {
  HIGH: { label: "High", color: "#f87171", bg: "rgba(248,113,113,0.1)", border: "rgba(248,113,113,0.28)" },
  MEDIUM: { label: "Medium", color: "#fb923c", bg: "rgba(251,146,60,0.1)", border: "rgba(251,146,60,0.28)" },
  LOW: { label: "Low", color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.28)" },
};

const safeNumber = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const scoreColor = (score: number) => {
  if (score >= 80) return "#34d399";
  if (score >= 60) return "#fbbf24";
  return "#f87171";
};

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

function SkeletonCard() {
  return (
    <div className="dim-card">
      <div style={{ display: "flex", gap: "20px", alignItems: "flex-start" }}>
        <div className="sk" style={{ width: "72px", height: "72px", borderRadius: "50%" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "10px" }}>
          <div className="sk" style={{ height: "18px", width: "40%" }} />
          <div className="sk" style={{ height: "13px", width: "60%" }} />
          <div className="sk" style={{ height: "28px", width: "22%", borderRadius: "20px" }} />
        </div>
      </div>
    </div>
  );
}

function EmptyCard({ title, body, accent }: { title: string; body: string; accent: string }) {
  return (
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
        color: accent,
      }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
        </svg>
      </div>
      <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: "6px" }}>
        {title}
      </div>
      <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)" }}>
        {body}
      </div>
    </div>
  );
}

function SecurityNotice({ selected, repoName, accent }: { selected: boolean; repoName?: string; accent: string }) {
  const title = selected ? "Repository Security Details" : "Select a Security Analysis";
  const body = selected
    ? `Inspecting scanner findings, vulnerable files, and AI security summary for ${repoName}.`
    : "Security scores summarize scanner findings from repositories where SkillPulse analyzed your GitHub contributions.";

  return (
    <div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: "14px",
      padding: "18px 20px",
      background: `${accent}0F`,
      border: `1px solid ${accent}35`,
      borderRadius: "14px",
      marginBottom: "24px",
    }}>
      <div style={{
        width: "34px",
        height: "34px",
        borderRadius: "10px",
        background: `${accent}18`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        color: accent,
      }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "14px", fontWeight: 700, color: "white", marginBottom: "4px" }}>
          {title}
        </div>
        <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
          {body}
        </div>
      </div>
    </div>
  );
}

function flattenFindings(report: SecurityReport | null): SecurityFinding[] {
  if (!report?.categorized_findings) return [];
  const rows: SecurityFinding[] = [];
  (["HIGH", "MEDIUM", "LOW"] as const).forEach(severity => {
    const files = report.categorized_findings[severity] || {};
    Object.entries(files).forEach(([filePath, findings]) => {
      findings.forEach(finding => rows.push({ ...finding, severity, file_path: filePath }));
    });
  });
  return rows;
}

function countBySeverity(report: SecurityReport | null, severity: "HIGH" | "MEDIUM" | "LOW") {
  const files = report?.categorized_findings?.[severity] || {};
  return Object.values(files).reduce((total, findings) => total + findings.length, 0);
}

function FindingCard({ finding }: { finding: SecurityFinding }) {
  const cfg = severityConfig[finding.severity];
  const title = finding.rule || finding.description?.split(".")[0] || "Security finding";
  return (
    <div style={{
      borderLeft: `3px solid ${cfg.color}`,
      background: "rgba(255,255,255,0.025)",
      borderRadius: "12px",
      padding: "16px 18px",
      borderTop: "1px solid rgba(255,255,255,0.06)",
      borderRight: "1px solid rgba(255,255,255,0.06)",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "7px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "14px", fontWeight: 800, color: "white" }}>{title}</span>
            <span style={{ fontSize: "10px", fontWeight: 800, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, padding: "2px 7px", borderRadius: "999px" }}>
              {cfg.label}
            </span>
          </div>
          <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.48)", lineHeight: 1.55 }}>
            {finding.description || "No description was provided by the scanner."}
          </div>
        </div>
        <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.05)", padding: "5px 8px", borderRadius: "8px", whiteSpace: "nowrap" }}>
          {finding.tool || "scanner"}
        </span>
      </div>
      <div style={{ height: "1px", background: "rgba(255,255,255,0.06)", margin: "13px 0" }} />
      <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", fontSize: "11.5px", color: "rgba(255,255,255,0.38)" }}>
        <span><strong style={{ color: "rgba(255,255,255,0.58)" }}>OWASP:</strong> {finding.owasp_category || "Unknown"}</span>
        <span><strong style={{ color: "rgba(255,255,255,0.58)" }}>File:</strong> {finding.file_path}</span>
        <span><strong style={{ color: "rgba(255,255,255,0.58)" }}>Line:</strong> {finding.line_number || 0}</span>
      </div>
    </div>
  );
}

export default function DeveloperSecurity() {
  const role = localStorage.getItem("role") || "developer";
  const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";

  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detail, setDetail] = useState<SecurityDetail | null>(null);
  const [report, setReport] = useState<SecurityReport | null>(null);
  const [aggregateSecurityScore, setAggregateSecurityScore] = useState<number | null>(null);
  const [aggregateBreakdown, setAggregateBreakdown] = useState<SecurityScoreBreakdown | null>(null);

  useEffect(() => {
    (async () => {
      setLoadingRepos(true);
      try {
        const res = await api.get("/analysis/skills/summary");
        const repoList: RepoOption[] = res.data.repos || [];
        setRepos(repoList);

        const details = await Promise.all(
          repoList.map(repo =>
            api.get(`/analysis/${repo.analysis_id}/detailed-metrics`)
              .then(r => r.data as SecurityDetail)
              .catch(() => null),
          ),
        );
        const scores = details
          .map(item => item?.scores?.security_score)
          .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

        const breakdowns = details
          .map(item => item?.scores?.security_score_breakdown)
          .filter((item): item is SecurityScoreBreakdown => Boolean(item));

        setAggregateSecurityScore(scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null);
        setAggregateBreakdown(averageBreakdowns(breakdowns));
      } finally {
        setLoadingRepos(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setReport(null);
      return;
    }

    (async () => {
      setLoadingDetail(true);
      try {
        const [detailRes, reportRes] = await Promise.all([
          api.get(`/analysis/${selectedId}/detailed-metrics`),
          api.get(`/security-report/${selectedId}`),
        ]);
        setDetail(detailRes.data);
        setReport(reportRes.data);
      } finally {
        setLoadingDetail(false);
      }
    })();
  }, [selectedId]);

  const findings = useMemo(() => flattenFindings(report), [report]);
  const topOwasp = Object.entries(report?.owasp_distribution || {})
    .sort((a, b) => safeNumber(b[1]) - safeNumber(a[1]))
    .slice(0, 4);
  const topFiles = Object.entries(report?.top_vulnerable_files || {})
    .sort((a, b) => safeNumber(b[1]) - safeNumber(a[1]))
    .slice(0, 4);

  const selectedRepo = repos.find(repo => repo.analysis_id === selectedId);
  const selectedBreakdown = detail?.scores?.security_score_breakdown || report?.security_score_breakdown || null;
  const failedTools = report?.failed_tools || [];
  const score = aggregateSecurityScore ?? 0;
  const breakdown = aggregateBreakdown;

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
          border-radius: 16px;
          padding: 24px 28px;
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
          outline: none;
          cursor: pointer;
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
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "26px", fontWeight: 800,
            color: "white", letterSpacing: "-0.5px",
            margin: "0 0 6px",
          }}>
            Security Overview
          </h1>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
            OWASP-aligned security findings for your analyzed contribution scope
          </p>
        </div>

        {!loadingRepos && (
          <SecurityNotice
            selected={Boolean(selectedRepo)}
            repoName={selectedRepo ? `${selectedRepo.repo_name} (${selectedRepo.branch})` : undefined}
            accent={accent}
          />
        )}

        <div style={{
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "16px", padding: "28px 32px",
          marginBottom: "24px",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "28px" }}>
            <div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.6)", marginBottom: "2px" }}>
                Security Score
              </div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
                Aggregated across repositories with completed security analysis
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              {loadingRepos ? (
                <div className="sk" style={{ width: "80px", height: "40px" }} />
              ) : (
                <div style={{ fontSize: "42px", fontWeight: 800, color: "white", lineHeight: 1, letterSpacing: "-2px" }}>
                  {aggregateSecurityScore == null ? "--" : score.toFixed(1)}
                </div>
              )}
            </div>
          </div>

          {loadingRepos ? (
            <div style={{ display: "flex", gap: "24px" }}>
              {[1, 2].map(i => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
                  <div className="sk" style={{ width: "80px", height: "80px", borderRadius: "50%" }} />
                  <div className="sk" style={{ width: "90px", height: "14px" }} />
                </div>
              ))}
            </div>
          ) : breakdown ? (
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
              {[
                {
                  label: "Code Security",
                  value: breakdown.code_security,
                  sub: `${breakdown.finding_counts.code_security} findings`,
                },
                {
                  label: "Dependency Security",
                  value: breakdown.dependency_security,
                  sub: `${breakdown.finding_counts.dependency_security} findings`,
                },
              ].map(item => (
                <div key={item.label} style={{ flex: 1, minWidth: "180px", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                  <ScoreRing value={item.value} size={80} />
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.75)", marginBottom: "4px" }}>
                      {item.label}
                    </div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>{item.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.3)" }}>
              Security breakdown will appear after an analysis is available.
            </div>
          )}
        </div>

        <div style={{
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "16px", padding: "20px 28px",
          marginBottom: "24px",
          display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.5)", fontWeight: 500, whiteSpace: "nowrap" }}>
            View your security analysis for:
          </span>
          {loadingRepos ? (
            <div className="sk" style={{ width: "220px", height: "36px", borderRadius: "10px" }} />
          ) : (
            <select
              className="sp-select"
              value={selectedId ?? ""}
              onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Select a repository...</option>
              {repos.map(repo => (
                <option key={repo.analysis_id} value={repo.analysis_id}>
                  {repo.repo_name} ({repo.branch}) - {repo.completed_at ? new Date(repo.completed_at).toLocaleDateString() : "latest"}
                </option>
              ))}
            </select>
          )}
          {!selectedId && !loadingRepos && repos.length > 0 && (
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.25)", width: "100%" }}>
              Select a repository to view scanner findings, affected files, and AI security guidance.
            </span>
          )}
        </div>

        {!selectedId && !loadingRepos && repos.length > 0 && (
          <EmptyCard
            title="Select a repository"
            body="Security findings, vulnerable files, and AI summary appear after choosing a completed analysis."
            accent={accent}
          />
        )}

        {!loadingRepos && repos.length === 0 && (
          <EmptyCard
            title="No completed analyses yet"
            body="Run a repository analysis first, then return here to inspect security findings."
            accent={accent}
          />
        )}

        {selectedId && (
          <>
            {loadingDetail ? (
              <>
                {[1, 2, 3].map(i => <SkeletonCard key={i} />)}
              </>
            ) : (
              <>
                <div className="dim-card">
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: "14px", flex: 1 }}>
                      <div style={{
                        width: "38px", height: "38px", borderRadius: "10px", flexShrink: 0,
                        background: `${accent}18`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: accent,
                      }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontSize: "16px", fontWeight: 700, color: "white", marginBottom: "3px" }}>
                          Repository Security Breakdown
                        </div>
                        <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>
                          Scanner findings for {selectedRepo?.repo_name} on {selectedRepo?.branch}
                        </div>
                      </div>
                    </div>
                    <ScoreRing value={safeNumber(detail?.scores?.security_score)} size={72} />
                  </div>

                  {failedTools.length > 0 && (
                    <div style={{
                      marginTop: "16px",
                      border: "1px solid rgba(248,113,113,0.25)",
                      background: "rgba(248,113,113,0.08)",
                      color: "rgba(255,255,255,0.7)",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      fontSize: "12.5px",
                    }}>
                      Some scanners failed during this analysis: <strong style={{ color: "#f87171" }}>{failedTools.join(", ")}</strong>.
                    </div>
                  )}

                  {selectedBreakdown && (
                    <div className="metrics-grid">
                      {[
                        {
                          label: "Code Security",
                          value: selectedBreakdown.code_security,
                          sub: `${selectedBreakdown.finding_counts.code_security} findings · ${Math.round(selectedBreakdown.weights.code_security * 100)}% weight`,
                        },
                        {
                          label: "Dependency Security",
                          value: selectedBreakdown.dependency_security,
                          sub: `${selectedBreakdown.finding_counts.dependency_security} findings · ${Math.round(selectedBreakdown.weights.dependency_security * 100)}% weight`,
                        },
                      ].map(item => (
                        <div key={item.label}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <span style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.55)", fontWeight: 500 }}>{item.label}</span>
                            <span style={{ fontSize: "14px", fontWeight: 700, color: "white" }}>{Math.round(item.value)}</span>
                          </div>
                          <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "6px" }}>{item.sub}</div>
                          <div style={{ height: "5px", background: "rgba(255,255,255,0.07)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              borderRadius: "3px",
                              background: scoreColor(item.value),
                              width: `${Math.min(100, Math.max(0, item.value))}%`,
                            }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="dim-card">
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "white", marginBottom: "18px" }}>
                    Findings Breakdown
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "12px", marginBottom: "18px" }}>
                    {(["HIGH", "MEDIUM", "LOW"] as const).map(severity => {
                      const cfg = severityConfig[severity];
                      const count = countBySeverity(report, severity);
                      return (
                        <div key={severity} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: "12px", padding: "16px" }}>
                          <div style={{ fontSize: "24px", fontWeight: 900, color: "white", marginBottom: "3px" }}>{count}</div>
                          <div style={{ fontSize: "12px", color: cfg.color, fontWeight: 800 }}>{cfg.label} Severity</div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="metrics-grid">
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "10px" }}>
                        Top OWASP Categories
                      </div>
                      {topOwasp.length ? topOwasp.map(([name, count]) => (
                        <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px", color: "rgba(255,255,255,0.42)", padding: "6px 0" }}>
                          <span>{name}</span><strong style={{ color: "rgba(255,255,255,0.72)" }}>{count}</strong>
                        </div>
                      )) : <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>No OWASP categories detected.</span>}
                    </div>
                    <div>
                      <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.3)", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "10px" }}>
                        Top Affected Files
                      </div>
                      {topFiles.length ? topFiles.map(([name, count]) => (
                        <div key={name} style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px", color: "rgba(255,255,255,0.42)", padding: "6px 0" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                          <strong style={{ color: "rgba(255,255,255,0.72)" }}>{count}</strong>
                        </div>
                      )) : <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>No affected files detected.</span>}
                    </div>
                  </div>
                </div>

                <div className="dim-card">
                  <div style={{ fontSize: "16px", fontWeight: 700, color: "white", marginBottom: "18px" }}>
                    Detected Vulnerabilities
                  </div>
                  {findings.length ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {findings.map((finding, index) => <FindingCard key={`${finding.severity}-${finding.file_path}-${finding.rule}-${index}`} finding={finding} />)}
                    </div>
                  ) : (
                    <EmptyCard title="No security findings" body="The selected analysis did not produce security findings for this contribution scope." accent={accent} />
                  )}
                </div>

                {detail?.ai_insights?.security_insights && (
                  <div className="dim-card" style={{ borderColor: `${accent}35`, background: `${accent}0F` }}>
                    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                      <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: `${accent}18`, display: "grid", placeItems: "center", flexShrink: 0, color: accent }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 18h6" /><path d="M10 22h4" /><path d="M8.5 14a6 6 0 1 1 7 0c-.7.5-1.1 1.3-1.1 2.1V17H9.6v-.9c0-.8-.4-1.6-1.1-2.1z" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ margin: "0 0 8px", fontSize: "16px", fontWeight: 800, color: "white" }}>AI Security Summary</div>
                        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.65, color: "rgba(255,255,255,0.58)" }}>
                          {detail.ai_insights.security_insights}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

function averageBreakdowns(breakdowns: SecurityScoreBreakdown[]): SecurityScoreBreakdown | null {
  if (!breakdowns.length) return null;
  const count = breakdowns.length;
  return {
    overall: breakdowns.reduce((sum, item) => sum + safeNumber(item.overall), 0) / count,
    code_security: breakdowns.reduce((sum, item) => sum + safeNumber(item.code_security), 0) / count,
    dependency_security: breakdowns.reduce((sum, item) => sum + safeNumber(item.dependency_security), 0) / count,
    weights: {
      code_security: breakdowns[0]?.weights?.code_security ?? 0.6,
      dependency_security: breakdowns[0]?.weights?.dependency_security ?? 0.4,
    },
    finding_counts: {
      code_security: breakdowns.reduce((sum, item) => sum + safeNumber(item.finding_counts?.code_security), 0),
      dependency_security: breakdowns.reduce((sum, item) => sum + safeNumber(item.finding_counts?.dependency_security), 0),
    },
  };
}
