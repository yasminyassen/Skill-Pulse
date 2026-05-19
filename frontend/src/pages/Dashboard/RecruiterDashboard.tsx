import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

type RepoItem = {
  candidate: string;
  repo_name: string;
  clone_path: string;
  html_url: string;
  default_branch: string;
  analysis_run_id?: number | null;
  analysis_status?: string | null;
  overall_score?: number | null;
  analysis_error?: string | null;
  status?: string | null;
  latest_commit_sha?: string | null;
  analyzed_at?: string | null;
  analysis_version?: string | null;
};

type SkippedItem = {
  repo_name: string;
  reason: string;
};

const progressSteps = [
  "Fetching repositories",
  "Scheduling analysis",
  "Running analysis",
  "Ranking candidates",
];

export default function RecruiterDashboard() {
  const location = useLocation();
  const isCandidateView = location.pathname.includes("/candidates");
  const [organization, setOrganization] = useState("");
  const [assignmentPrefix, setAssignmentPrefix] = useState("");
  const [forceReanalyze, setForceReanalyze] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<number | null>(null);
  const [repositories, setRepositories] = useState<RepoItem[]>([]);
  const [skipped, setSkipped] = useState<SkippedItem[]>([]);
  const [githubAuthUrl, setGithubAuthUrl] = useState<string | null>(null);
  const pollingRef = useRef<number | null>(null);
  const repositoriesRef = useRef<RepoItem[]>([]);

  const candidateRows = useMemo(() => {
    return [...repositories]
      .map((repo) => ({
        candidate: repo.candidate,
        repo_name: repo.repo_name,
        overall_score: repo.overall_score ?? null,
        analysis_status: repo.status || repo.analysis_status || "pending",
        analyzed_at: repo.analyzed_at ?? null,
        latest_commit_sha: repo.latest_commit_sha ?? null,
      }))
      .sort((a, b) => {
        if (a.overall_score === null && b.overall_score === null) return 0;
        if (a.overall_score === null) return 1;
        if (b.overall_score === null) return -1;
        return b.overall_score - a.overall_score;
      });
  }, [repositories]);

  const canSubmit = useMemo(() => {
    return Boolean(organization.trim() && assignmentPrefix.trim());
  }, [organization, assignmentPrefix]);

  const stopPolling = () => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  useEffect(() => {
    repositoriesRef.current = repositories;
  }, [repositories]);

  useEffect(() => {
    if (repositories.length) {
      localStorage.setItem("recruiter_candidate_repos", JSON.stringify(repositories));
    }
  }, [repositories]);

  useEffect(() => {
    if (repositories.length) return;
    try {
      const raw = localStorage.getItem("recruiter_candidate_repos");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRepositories(parsed);
        }
      }
    } catch {
      // ignore cache errors
    }
  }, []);

  useEffect(() => () => stopPolling(), []);

  const updateRepo = (repoName: string, patch: Partial<RepoItem>) => {
    setRepositories((prev) => prev.map((repo) => (
      repo.repo_name === repoName ? { ...repo, ...patch } : repo
    )));
  };

  const pollAnalysisStatus = async () => {
    const current = repositoriesRef.current;
    const pending = current.filter((repo) => (
      repo.analysis_run_id && (repo.analysis_status === "running" || repo.analysis_status === "pending")
    ));

    if (pending.length === 0) {
      if (current.length > 0) {
        setActiveStep(3);
      }
      stopPolling();
      return;
    }

    await Promise.all(pending.map(async (repo) => {
      try {
        const res = await api.get(`/analysis/${repo.analysis_run_id}`);
        const status = res.data.status || "running";
        if (status === "completed") {
          updateRepo(repo.repo_name, {
            analysis_status: "completed",
            overall_score: res.data?.scores?.overall ?? null,
          });
        } else if (status === "failed") {
          updateRepo(repo.repo_name, {
            analysis_status: "failed",
            analysis_error: res.data?.message || "Analysis failed",
          });
        } else {
          updateRepo(repo.repo_name, { analysis_status: status });
        }
      } catch {
        updateRepo(repo.repo_name, {
          analysis_status: "failed",
          analysis_error: "Unable to fetch analysis status.",
        });
      }
    }));
  };

  const startPolling = () => {
    stopPolling();
    pollingRef.current = window.setInterval(() => {
      pollAnalysisStatus();
    }, 4000);
  };

  const runAnalysisForRepo = async (repo: RepoItem) => {
    try {
      const res = await api.post("/analysis/run", {
        repo_url: repo.html_url,
        branch: repo.default_branch || "main",
      });
      updateRepo(repo.repo_name, {
        analysis_run_id: res.data.analysis_run_id,
        analysis_status: res.data.status || "running",
        analysis_error: null,
      });
      if (res.data.cached) {
        await pollAnalysisStatus();
      }
    } catch (err: any) {
      const message = err?.response?.data?.detail || "Analysis request failed.";
      updateRepo(repo.repo_name, {
        analysis_status: "failed",
        analysis_error: message,
      });
    }
  };

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toLocaleString();
  };

  const handleAnalyze = async () => {
    if (!canSubmit) {
      setError("Please fill in all fields before analyzing.");
      return;
    }

    setError(null);
    setGithubAuthUrl(null);
    setLoading(true);
    setRepositories([]);
    setSkipped([]);
    setActiveStep(0);
    stopPolling();

    try {
      const response = await api.post("/api/github-classroom/analyze", {
        organization: organization.trim(),
        assignment_prefix: assignmentPrefix.trim(),
        force_reanalyze: forceReanalyze,
      });
      const fetchedRepos: RepoItem[] = (response.data.repositories || []).map((repo: RepoItem) => ({
        ...repo,
        analysis_run_id: repo.analysis_run_id ?? null,
        analysis_status: repo.analysis_status || "pending",
        overall_score: repo.overall_score ?? null,
        analysis_error: null,
      }));
      setRepositories(fetchedRepos);
      setSkipped(response.data.skipped || []);
      setActiveStep(1);
      const reposNeedingAnalysis = fetchedRepos.filter((repo) => repo.analysis_status === "pending");
      for (const repo of reposNeedingAnalysis) {
        await runAnalysisForRepo(repo);
      }
      setActiveStep(2);
      startPolling();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const needsAuth = typeof detail === "object" && detail?.requires_github_auth;
      if (needsAuth) {
        setGithubAuthUrl(detail?.auth_url || null);
        setError("Connect GitHub to analyze organization repositories.");
      } else {
        const message = detail || "Analysis failed. Please try again.";
        setError(message);
      }
      setActiveStep(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div style={{
        minHeight: "100vh",
        padding: "40px 48px 80px",
        color: "rgba(226,232,240,0.9)",
        fontFamily: "'DM Sans', sans-serif",
        background: "radial-gradient(circle at 10% 0%, rgba(14,116,144,0.22), transparent 45%), radial-gradient(circle at 90% 20%, rgba(251,146,60,0.18), transparent 40%), #0a0a0f",
      }}>
        <div style={{ maxWidth: "980px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "10px",
              padding: "6px 14px",
              borderRadius: "999px",
              border: "1px solid rgba(14,116,144,0.4)",
              background: "rgba(14,116,144,0.14)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.8px",
              color: "rgba(94,234,212,0.9)",
              textTransform: "uppercase",
              width: "fit-content",
            }}>
              GitHub Classroom
            </div>
            <h1 style={{
              fontFamily: "'Syne', sans-serif",
              fontSize: "28px",
              fontWeight: 800,
              color: "white",
              letterSpacing: "-0.6px",
            }}>
              Analyze candidate assignments at scale
            </h1>
            <p style={{ color: "rgba(148,163,184,0.7)", maxWidth: "640px", lineHeight: 1.6, fontSize: "14px" }}>
              Connect your GitHub Classroom organization, pull the assignment repositories, and let SkillPulse rank candidate submissions automatically.
            </p>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.1fr) minmax(0, 0.9fr)",
            gap: "22px",
          }}>
            <div style={{
              background: "rgba(15,23,42,0.7)",
              border: "1px solid rgba(148,163,184,0.15)",
              borderRadius: "18px",
              padding: "26px",
              backdropFilter: "blur(12px)",
              boxShadow: "0 24px 60px rgba(15,23,42,0.4)",
            }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
                <div>
                  <label style={{ fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "rgba(94,234,212,0.65)", fontWeight: 700 }}>
                    Organization Name
                  </label>
                  <input
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="skillpulse-hiring"
                    style={{
                      marginTop: "8px",
                      width: "100%",
                      background: "rgba(15,23,42,0.6)",
                      border: "1px solid rgba(94,234,212,0.2)",
                      color: "white",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      fontSize: "14px",
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: "12px", letterSpacing: "0.6px", textTransform: "uppercase", color: "rgba(251,146,60,0.7)", fontWeight: 700 }}>
                    Assignment Prefix
                  </label>
                  <input
                    value={assignmentPrefix}
                    onChange={(e) => setAssignmentPrefix(e.target.value)}
                    placeholder="backend-api"
                    style={{
                      marginTop: "8px",
                      width: "100%",
                      background: "rgba(15,23,42,0.6)",
                      border: "1px solid rgba(251,146,60,0.25)",
                      color: "white",
                      borderRadius: "12px",
                      padding: "12px 14px",
                      fontSize: "14px",
                    }}
                  />
                </div>

                <label style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  fontSize: "12px",
                  color: "rgba(226,232,240,0.8)",
                  fontWeight: 600,
                }}>
                  <input
                    type="checkbox"
                    checked={forceReanalyze}
                    onChange={(e) => setForceReanalyze(e.target.checked)}
                    style={{ width: "16px", height: "16px" }}
                  />
                  Force Reanalyze
                </label>

                {error && (
                  <div style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    background: "rgba(248,113,113,0.08)",
                    border: "1px solid rgba(248,113,113,0.25)",
                    color: "rgba(248,113,113,0.9)",
                    fontSize: "12px",
                  }}>
                    {error}
                    {githubAuthUrl && (
                      <button
                        onClick={() => { window.location.href = githubAuthUrl; }}
                        style={{
                          marginTop: "10px",
                          height: "38px",
                          borderRadius: "9px",
                          border: "1px solid rgba(56,189,248,0.4)",
                          background: "rgba(56,189,248,0.15)",
                          color: "rgba(224,231,255,0.95)",
                          fontWeight: 700,
                          fontSize: "12px",
                          cursor: "pointer",
                          width: "100%",
                        }}
                      >
                        Connect GitHub
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={handleAnalyze}
                  disabled={!canSubmit || loading}
                  style={{
                    height: "46px",
                    borderRadius: "12px",
                    border: "none",
                    background: "linear-gradient(135deg, rgba(94,234,212,0.9), rgba(56,189,248,0.9), rgba(251,146,60,0.9))",
                    color: "#0f172a",
                    fontWeight: 700,
                    fontSize: "14px",
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.7 : 1,
                    transition: "transform 0.2s",
                  }}
                >
                  {loading ? "Analyzing..." : "Analyze"}
                </button>
              </div>
            </div>

            <div style={{
              background: "rgba(15,23,42,0.5)",
              border: "1px solid rgba(148,163,184,0.12)",
              borderRadius: "18px",
              padding: "22px",
              display: "flex",
              flexDirection: "column",
              gap: "14px",
            }}>
              <div style={{ fontSize: "13px", fontWeight: 700, color: "rgba(226,232,240,0.9)", letterSpacing: "0.4px" }}>
                Progress
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {progressSteps.map((step, idx) => {
                  const isDone = activeStep !== null && idx < activeStep;
                  const isActive = activeStep === idx;
                  return (
                    <div key={step} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "10px",
                      opacity: activeStep === null ? 0.4 : 1,
                    }}>
                      <div style={{
                        width: "10px",
                        height: "10px",
                        borderRadius: "50%",
                        background: isDone ? "rgba(94,234,212,0.9)" : isActive ? "rgba(251,146,60,0.9)" : "rgba(148,163,184,0.35)",
                        boxShadow: isActive ? "0 0 12px rgba(251,146,60,0.6)" : "none",
                      }} />
                      <span style={{ fontSize: "12px", color: isDone || isActive ? "rgba(226,232,240,0.9)" : "rgba(148,163,184,0.6)" }}>
                        {step}
                      </span>
                    </div>
                  );
                })}
              </div>

              <div style={{
                borderTop: "1px solid rgba(148,163,184,0.12)",
                paddingTop: "12px",
                fontSize: "12px",
                color: "rgba(148,163,184,0.7)",
                lineHeight: 1.6,
              }}>
                We use your connected GitHub account to access organization repositories securely.
              </div>
            </div>
          </div>

          {isCandidateView ? (
            <div style={{
              background: "rgba(15,23,42,0.6)",
              border: "1px solid rgba(148,163,184,0.12)",
              borderRadius: "18px",
              padding: "24px",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(226,232,240,0.9)" }}>Candidate View</div>
                <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.6)" }}>
                  {candidateRows.length} candidates
                </div>
              </div>

              {candidateRows.length === 0 && (
                <div style={{
                  padding: "18px",
                  borderRadius: "12px",
                  border: "1px dashed rgba(148,163,184,0.2)",
                  color: "rgba(148,163,184,0.6)",
                  fontSize: "12px",
                }}>
                  No candidate scores available yet.
                </div>
              )}

              {candidateRows.length > 0 && (
                <div style={{ display: "grid", gap: "10px" }}>
                  {candidateRows.map((row) => (
                    <div
                      key={row.repo_name}
                      style={{
                        padding: "14px 16px",
                        borderRadius: "12px",
                        border: "1px solid rgba(148,163,184,0.15)",
                        background: "rgba(2,6,23,0.5)",
                        display: "grid",
                        gridTemplateColumns: "1.1fr 1fr 0.9fr 0.7fr",
                        gap: "12px",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.8)" }}>Candidate</div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "white" }}>{row.candidate}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.8)" }}>Repository</div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(226,232,240,0.9)" }}>{row.repo_name}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.8)" }}>Status</div>
                        <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(226,232,240,0.9)" }}>{row.analysis_status}</div>
                        <div style={{ fontSize: "11px", color: "rgba(148,163,184,0.7)", marginTop: "4px" }}>
                          Last analyzed: {formatTimestamp(row.analyzed_at)}
                        </div>
                        <div style={{ fontSize: "11px", color: "rgba(148,163,184,0.7)", marginTop: "2px" }}>
                          SHA: {row.latest_commit_sha ? row.latest_commit_sha.slice(0, 8) : "-"}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.8)" }}>Score</div>
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "rgba(226,232,240,0.95)" }}>
                          {row.overall_score !== null ? row.overall_score : "-"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div style={{
              background: "rgba(15,23,42,0.6)",
              border: "1px solid rgba(148,163,184,0.12)",
              borderRadius: "18px",
              padding: "24px",
            }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "16px" }}>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(226,232,240,0.9)" }}>Repositories</div>
                <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.6)" }}>
                  {repositories.length} fetched
                </div>
              </div>

              {repositories.length === 0 && !loading && (
                <div style={{
                  padding: "18px",
                  borderRadius: "12px",
                  border: "1px dashed rgba(148,163,184,0.2)",
                  color: "rgba(148,163,184,0.6)",
                  fontSize: "12px",
                }}>
                  No repositories analyzed yet.
                </div>
              )}

              {repositories.length > 0 && (
                <div style={{ display: "grid", gap: "10px" }}>
                  {repositories.map((repo) => (
                    <div
                      key={repo.repo_name}
                      style={{
                        padding: "14px 16px",
                        borderRadius: "12px",
                        border: "1px solid rgba(148,163,184,0.15)",
                        background: "rgba(2,6,23,0.5)",
                        display: "grid",
                        gridTemplateColumns: "1.2fr 0.7fr 1fr 0.7fr",
                        gap: "12px",
                      }}
                    >
                      <div>
                        <div style={{ fontSize: "13px", fontWeight: 700, color: "white" }}>{repo.repo_name}</div>
                        <a
                          href={repo.html_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ fontSize: "12px", color: "rgba(94,234,212,0.8)", textDecoration: "none" }}
                        >
                          View on GitHub
                        </a>
                        <div style={{ fontSize: "11px", color: "rgba(148,163,184,0.7)", marginTop: "6px" }}>
                          Latest SHA: {repo.latest_commit_sha ? repo.latest_commit_sha.slice(0, 10) : "-"}
                        </div>
                      </div>
                      <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.8)" }}>
                        Candidate
                        <div style={{ fontWeight: 700, color: "rgba(226,232,240,0.9)" }}>{repo.candidate}</div>
                      </div>
                      <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.8)" }}>
                        Status
                        <div style={{ fontWeight: 700, color: "rgba(226,232,240,0.9)" }}>
                          {repo.status || repo.analysis_status || "pending"}
                        </div>
                        <div style={{ fontSize: "11px", color: "rgba(148,163,184,0.7)", marginTop: "4px" }}>
                          Last analyzed: {formatTimestamp(repo.analyzed_at)}
                        </div>
                        {repo.analysis_error && (
                          <div style={{ fontSize: "11px", color: "rgba(248,113,113,0.85)", marginTop: "4px" }}>
                            {repo.analysis_error}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: "12px", color: "rgba(148,163,184,0.8)" }}>
                        Score
                        <div style={{ fontWeight: 700, color: "rgba(226,232,240,0.9)" }}>
                          {repo.overall_score !== null && repo.overall_score !== undefined ? repo.overall_score : "-"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {skipped.length > 0 && (
                <div style={{ marginTop: "16px", fontSize: "12px", color: "rgba(148,163,184,0.7)" }}>
                  Skipped: {skipped.map((item) => `${item.repo_name} (${item.reason})`).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
