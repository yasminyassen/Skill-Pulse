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


const CheckIcon = () => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>;


export default function RecruiterDashboard() {
  const location  = useLocation();
  const isCandidateView = location.pathname.includes("/candidates");

  const [organization,     setOrganization]     = useState("");
  const [assignmentPrefix, setAssignmentPrefix] = useState("");
  const [forceReanalyze,   setForceReanalyze]   = useState(false);
  const [loading,          setLoading]           = useState(false);
  const [error,            setError]             = useState<string | null>(null);
  const [activeStep,       setActiveStep]        = useState<number | null>(null);
  const [repositories,     setRepositories]      = useState<RepoItem[]>([]);
  const [skipped,          setSkipped]           = useState<SkippedItem[]>([]);
  const [githubAuthUrl,    setGithubAuthUrl]     = useState<string | null>(null);


  const pollingRef      = useRef<number | null>(null);
  const repositoriesRef = useRef<RepoItem[]>([]);

  const candidateRows = useMemo(() => {
    return [...repositories]
      .map((repo) => ({
        candidate:       repo.candidate,
        repo_name:       repo.repo_name,
        overall_score:   repo.overall_score ?? null,
        analysis_status: repo.status || repo.analysis_status || "pending",
        analyzed_at:     repo.analyzed_at ?? null,
        latest_commit_sha: repo.latest_commit_sha ?? null,
      }))
      .sort((a, b) => {
        if (a.overall_score === null && b.overall_score === null) return 0;
        if (a.overall_score === null) return 1;
        if (b.overall_score === null) return -1;
        return b.overall_score - a.overall_score;
      });
  }, [repositories]);

  const canSubmit = useMemo(
    () => Boolean(organization.trim() && assignmentPrefix.trim()),
    [organization, assignmentPrefix],
  );

  const stopPolling = () => {
    if (pollingRef.current) { window.clearInterval(pollingRef.current); pollingRef.current = null; }
  };

  useEffect(() => { repositoriesRef.current = repositories; }, [repositories]);
  useEffect(() => { if (repositories.length) localStorage.setItem("recruiter_candidate_repos", JSON.stringify(repositories)); }, [repositories]);
  useEffect(() => {
    if (repositories.length) return;
    try {
      const raw = localStorage.getItem("recruiter_candidate_repos");
      if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) setRepositories(parsed); }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => () => stopPolling(), []);

  const updateRepo = (repoName: string, patch: Partial<RepoItem>) =>
    setRepositories((prev) => prev.map((r) => r.repo_name === repoName ? { ...r, ...patch } : r));

  const pollAnalysisStatus = async () => {
    const current = repositoriesRef.current;
    const pending = current.filter((r) => r.analysis_run_id && (r.analysis_status === "running" || r.analysis_status === "pending"));
    if (pending.length === 0) { if (current.length > 0) setActiveStep(3); stopPolling(); return; }
    await Promise.all(pending.map(async (repo) => {
      try {
        const res = await api.get(`/analysis/${repo.analysis_run_id}`);
        const status = res.data.status || "running";
        if (status === "completed") updateRepo(repo.repo_name, { analysis_status: "completed", overall_score: res.data?.scores?.overall ?? null });
        else if (status === "failed") updateRepo(repo.repo_name, { analysis_status: "failed", analysis_error: res.data?.message || "Analysis failed" });
        else updateRepo(repo.repo_name, { analysis_status: status });
      } catch { updateRepo(repo.repo_name, { analysis_status: "failed", analysis_error: "Unable to fetch analysis status." }); }
    }));
  };

  const startPolling = () => { stopPolling(); pollingRef.current = window.setInterval(pollAnalysisStatus, 4000); };

  const runAnalysisForRepo = async (repo: RepoItem) => {
    try {
      const res = await api.post("/analysis/run", { repo_url: repo.html_url, branch: repo.default_branch || "main" });
      updateRepo(repo.repo_name, { analysis_run_id: res.data.analysis_run_id, analysis_status: res.data.status || "running", analysis_error: null });
      if (res.data.cached) await pollAnalysisStatus();
    } catch (err: any) {
      updateRepo(repo.repo_name, { analysis_status: "failed", analysis_error: err?.response?.data?.detail || "Analysis request failed." });
    }
  };

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
  };

  const handleAnalyze = async () => {
    if (!canSubmit) { setError("Please fill in all fields before analyzing."); return; }
    setError(null); setGithubAuthUrl(null); setLoading(true);
    setRepositories([]); setSkipped([]); setActiveStep(0); stopPolling();
    try {
      const response = await api.post("/api/github-classroom/analyze", {
        organization: organization.trim(), assignment_prefix: assignmentPrefix.trim(), force_reanalyze: forceReanalyze,
      });
      const fetchedRepos: RepoItem[] = (response.data.repositories || []).map((repo: RepoItem) => ({
        ...repo, analysis_run_id: repo.analysis_run_id ?? null, analysis_status: repo.analysis_status || "pending", overall_score: repo.overall_score ?? null, analysis_error: null,
      }));
      setRepositories(fetchedRepos); setSkipped(response.data.skipped || []); setActiveStep(1);
      for (const repo of fetchedRepos.filter((r) => r.analysis_status === "pending")) await runAnalysisForRepo(repo);
      setActiveStep(2); startPolling();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      const needsAuth = typeof detail === "object" && detail?.requires_github_auth;
      if (needsAuth) { setGithubAuthUrl(detail?.auth_url || null); setError("Connect GitHub to analyze organization repositories."); }
      else setError(detail || "Analysis failed. Please try again.");
      setActiveStep(null);
    } finally { setLoading(false); }
  };

  // ── Shared card/section helpers (identical approach to ProfilePage) ──────
  const card = (content: React.ReactNode, extra?: React.CSSProperties) => (
    <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "24px 28px", ...extra }}>{content}</div>
  );

  const sectionTitle = (text: string) => (
    <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color: "white", margin: "0 0 16px" }}>{text}</h2>
  );

  return (
    <DashboardLayout>
      {/* ── Global styles (same font + animation set as ProfilePage) ── */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        input { outline: none; font-family: 'DM Sans', sans-serif; }
        input::placeholder { color: rgba(148,163,184,0.4); }
      `}</style>

      <div style={{
        minHeight: "100vh",
        padding: "36px 40px 80px",
        color: "rgba(226,232,240,0.9)",
        fontFamily: "'DM Sans', sans-serif",
        /* ── Same radial gradient as ProfilePage ── */
        background: "radial-gradient(circle at 10% 0%, rgba(99,102,241,0.18), transparent 45%), radial-gradient(circle at 90% 20%, rgba(236,72,153,0.12), transparent 40%), #0a0a0f",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* ── Page header ── */}
          <div>
            {/* Badge — now indigo/purple to match the profile page palette */}
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "5px 14px", borderRadius: 999,
              border: "1px solid rgba(99,102,241,0.4)",
              background: "rgba(99,102,241,0.12)",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.8px",
              color: "rgba(167,139,250,0.95)", textTransform: "uppercase",
              width: "fit-content", marginBottom: 10,
            }}>
              GitHub Classroom
            </div>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: "white", letterSpacing: "-0.5px", margin: "0 0 4px" }}>
              Analyze candidate assignments at scale
            </h1>
            <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.35)", margin: 0, lineHeight: 1.6 }}>
              Connect your GitHub Classroom organization, pull the assignment repositories, and let SkillPulse rank candidate submissions automatically.
            </p>
          </div>

          {/* ── Input + Progress row ── */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,0.9fr)", gap: 22 }}>

            {/* Input card */}
            {card(
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {/* Organization */}
                <div>
                  <label style={{ fontSize: 12, letterSpacing: "0.6px", textTransform: "uppercase", color: "rgba(167,139,250,0.8)", fontWeight: 700 }}>
                    Organization Name
                  </label>
                  <input
                    value={organization}
                    onChange={(e) => setOrganization(e.target.value)}
                    placeholder="skillpulse-hiring"
                    style={{
                      marginTop: 8, width: "100%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(99,102,241,0.25)",
                      color: "white", borderRadius: 12, padding: "12px 14px", fontSize: 14,
                    }}
                  />
                </div>

                {/* Assignment prefix */}
                <div>
                  <label style={{ fontSize: 12, letterSpacing: "0.6px", textTransform: "uppercase", color: "rgba(236,72,153,0.75)", fontWeight: 700 }}>
                    Assignment Prefix
                  </label>
                  <input
                    value={assignmentPrefix}
                    onChange={(e) => setAssignmentPrefix(e.target.value)}
                    placeholder="backend-api"
                    style={{
                      marginTop: 8, width: "100%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(236,72,153,0.2)",
                      color: "white", borderRadius: 12, padding: "12px 14px", fontSize: 14,
                    }}
                  />
                </div>

                {/* Force reanalyze */}
                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "rgba(226,232,240,0.8)", fontWeight: 600, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={forceReanalyze}
                    onChange={(e) => setForceReanalyze(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: "#6366f1" }}
                  />
                  Force Reanalyze
                </label>

                {/* Error */}
                {error && (
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "rgba(248,113,113,0.9)", fontSize: 12 }}>
                    {error}
                    {githubAuthUrl && (
                      <button
                        onClick={() => { window.location.href = githubAuthUrl!; }}
                        style={{ marginTop: 10, height: 38, borderRadius: 9, border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.15)", color: "rgba(224,231,255,0.95)", fontWeight: 700, fontSize: 12, cursor: "pointer", width: "100%", fontFamily: "'DM Sans',sans-serif" }}
                      >
                        Connect GitHub
                      </button>
                    )}
                  </div>
                )}

                {/* Analyze button — indigo→pink gradient */}
                <button
                  onClick={handleAnalyze}
                  disabled={!canSubmit || loading}
                  style={{
                    height: 46, borderRadius: 12, border: "none",
                    background: "linear-gradient(135deg,#6366f1,#ec4899)",
                    color: "white", fontWeight: 700, fontSize: 14,
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.7 : 1,
                    fontFamily: "'DM Sans',sans-serif",
                    transition: "opacity 0.2s",
                  }}
                >
                  {loading ? "Analyzing…" : "Analyze"}
                </button>
              </div>
            )}

            {/* Progress card */}
            {card(
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(226,232,240,0.9)", letterSpacing: "0.4px", marginBottom: 14 }}>Progress</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {progressSteps.map((step, idx) => {
                    const isDone   = activeStep !== null && idx < activeStep;
                    const isActive = activeStep === idx;
                    return (
                      <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, opacity: activeStep === null ? 0.4 : 1 }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                          background: isDone ? "#a78bfa" : isActive ? "#ec4899" : "rgba(148,163,184,0.35)",
                          boxShadow: isActive ? "0 0 12px rgba(236,72,153,0.6)" : isDone ? "0 0 8px rgba(167,139,250,0.4)" : "none",
                          transition: "background 0.3s",
                        }} />
                        <span style={{ fontSize: 12, color: isDone || isActive ? "rgba(226,232,240,0.9)" : "rgba(148,163,184,0.6)" }}>
                          {step}
                        </span>
                        {isDone && (
                          <span style={{ marginLeft: "auto", width: 16, height: 16, borderRadius: "50%", background: "rgba(167,139,250,0.15)", display: "flex", alignItems: "center", justifyContent: "center", color: "#a78bfa" }}>
                            <CheckIcon />
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, fontSize: 12, color: "rgba(148,163,184,0.7)", lineHeight: 1.6, marginTop: 14 }}>
                  We use your connected GitHub account to access organization repositories securely.
                </div>
              </>
            )}
          </div>

          {/* ── Repositories / Candidate view ── */}
          {isCandidateView ? (
            card(
              <>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
                  {sectionTitle("Candidate View")}
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{candidateRows.length} candidates</div>
                </div>

                {candidateRows.length === 0 && (
                  <div style={{ padding: 18, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.1)", color: "rgba(148,163,184,0.6)", fontSize: 12 }}>
                    No candidate scores available yet.
                  </div>
                )}

                {candidateRows.length > 0 && (
                  <div style={{ display: "grid", gap: 10 }}>
                    {candidateRows.map((row) => (
                      <div key={row.repo_name} style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", display: "grid", gridTemplateColumns: "1.1fr 1fr 0.9fr 0.7fr", gap: 12 }}>
                        <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Candidate</div><div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>{row.candidate}</div></div>
                        <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Repository</div><div style={{ fontSize: 13, fontWeight: 600, color: "rgba(226,232,240,0.9)" }}>{row.repo_name}</div></div>
                        <div>
                          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Status</div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: "rgba(226,232,240,0.9)" }}>{row.analysis_status}</div>
                          <div style={{ fontSize: 11, color: "rgba(148,163,184,0.5)", marginTop: 4 }}>Last analyzed: {formatTimestamp(row.analyzed_at)}</div>
                          <div style={{ fontSize: 11, color: "rgba(148,163,184,0.5)", marginTop: 2 }}>SHA: {row.latest_commit_sha ? row.latest_commit_sha.slice(0, 8) : "-"}</div>
                        </div>
                        <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Score</div><div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>{row.overall_score !== null ? row.overall_score : "-"}</div></div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          ) : (
            card(
              <>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
                  {sectionTitle("Repositories")}
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{repositories.length} fetched</div>
                </div>

                {repositories.length === 0 && !loading && (
                  <div style={{ padding: 18, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.1)", color: "rgba(148,163,184,0.6)", fontSize: 12 }}>
                    No repositories analyzed yet.
                  </div>
                )}

                {repositories.length > 0 && (
                  <div style={{ display: "grid", gap: 10 }}>
                    {repositories.map((repo) => (
                      <div key={repo.repo_name} style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.02)", display: "grid", gridTemplateColumns: "1.2fr 0.7fr 1fr 0.7fr", gap: 12 }}>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>{repo.repo_name}</div>
                          <a href={repo.html_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#a78bfa", textDecoration: "none" }}>View on GitHub</a>
                          <div style={{ fontSize: 11, color: "rgba(148,163,184,0.5)", marginTop: 6 }}>Latest SHA: {repo.latest_commit_sha ? repo.latest_commit_sha.slice(0, 10) : "-"}</div>
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                          Candidate
                          <div style={{ fontWeight: 700, color: "rgba(226,232,240,0.9)", marginTop: 2 }}>{repo.candidate}</div>
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                          Status
                          <div style={{ fontWeight: 700, color: "rgba(226,232,240,0.9)", marginTop: 2 }}>{repo.status || repo.analysis_status || "pending"}</div>
                          <div style={{ fontSize: 11, color: "rgba(148,163,184,0.5)", marginTop: 4 }}>Last analyzed: {formatTimestamp(repo.analyzed_at)}</div>
                          {repo.analysis_error && <div style={{ fontSize: 11, color: "rgba(248,113,113,0.85)", marginTop: 4 }}>{repo.analysis_error}</div>}
                        </div>
                        <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
                          Score
                          <div style={{ fontWeight: 700, color: "#a78bfa", fontSize: 14, marginTop: 2 }}>
                            {repo.overall_score !== null && repo.overall_score !== undefined ? repo.overall_score : "-"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {skipped.length > 0 && (
                  <div style={{ marginTop: 16, fontSize: 12, color: "rgba(148,163,184,0.5)" }}>
                    Skipped: {skipped.map((item) => `${item.repo_name} (${item.reason})`).join(", ")}
                  </div>
                )}
              </>
            )
          )}



        </div>
      </div>
    </DashboardLayout>
  );
}