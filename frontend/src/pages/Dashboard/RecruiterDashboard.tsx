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

type PreviewRow = {
  candidate_name: string;
  repo_url: string;
  full_name: string;
  repo_name: string;
  branch: string;
};

type SkippedItem = {
  repo_name?: string;
  candidate_name?: string;
  row?: number;
  reason: string;
};

const progressSteps = [
  "Reading candidate list",
  "Confirming candidates",
  "Running analysis",
  "Ranking candidates",
];

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function RecruiterDashboard() {
  const location = useLocation();
  const isCandidateView = location.pathname.includes("/candidates");

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [previewSkipped, setPreviewSkipped] = useState<SkippedItem[]>([]);
  const [showPreview, setShowPreview] = useState(false);
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

  const stopPolling = () => {
    if (pollingRef.current) {
      window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  };

  useEffect(() => { repositoriesRef.current = repositories; }, [repositories]);
  useEffect(() => {
    if (repositories.length) localStorage.setItem("recruiter_candidate_repos", JSON.stringify(repositories));
  }, [repositories]);
  useEffect(() => {
    if (repositories.length) return;
    try {
      const raw = localStorage.getItem("recruiter_candidate_repos");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRepositories(parsed);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => () => stopPolling(), []);

  const updateRepo = (repoName: string, patch: Partial<RepoItem>) =>
    setRepositories((prev) => prev.map((r) => (r.repo_name === repoName ? { ...r, ...patch } : r)));

  const updatePreviewRow = (index: number, patch: Partial<PreviewRow>) =>
    setPreviewRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const removePreviewRow = (index: number) =>
    setPreviewRows((prev) => prev.filter((_, i) => i !== index));

  const pollAnalysisStatus = async () => {
    const current = repositoriesRef.current;
    const pending = current.filter(
      (r) => r.analysis_run_id && (r.analysis_status === "running" || r.analysis_status === "pending"),
    );
    if (pending.length === 0) {
      if (current.length > 0) setActiveStep(3);
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
    pollingRef.current = window.setInterval(pollAnalysisStatus, 4000);
  };

  const handleAuthError = (err: any) => {
    const detail = err?.response?.data?.detail;
    const needsAuth = typeof detail === "object" && detail?.requires_github_auth;
    if (needsAuth) {
      setGithubAuthUrl(detail?.auth_url || null);
      setError("Connect GitHub to analyze candidate repositories.");
    } else {
      setError(typeof detail === "string" ? detail : "Request failed. Please try again.");
    }
  };

  const handlePreview = async () => {
    if (!uploadFile) {
      setError("Upload a CSV or Excel file with candidate repositories.");
      return;
    }

    setError(null);
    setGithubAuthUrl(null);
    setLoading(true);
    setShowPreview(false);
    setActiveStep(0);

    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      const response = await api.post("/api/recruiter/bulk-analyze/preview", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      setPreviewRows(response.data.rows || []);
      setPreviewSkipped(response.data.skipped || []);
      setShowPreview(true);

      if ((response.data.rows || []).length === 0) {
        setError("No valid candidate rows were found. Check the skipped rows below and fix your file.");
      }
    } catch (err: any) {
      handleAuthError(err);
      setActiveStep(null);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmAnalysis = async () => {
    if (previewRows.length === 0) {
      setError("Add at least one valid candidate row before starting analysis.");
      return;
    }

    setError(null);
    setGithubAuthUrl(null);
    setLoading(true);
    setRepositories([]);
    setSkipped([]);
    setActiveStep(1);
    stopPolling();

    try {
      const response = await api.post("/api/recruiter/bulk-analyze/confirm", {
        force_reanalyze: forceReanalyze,
        candidates: previewRows.map((row) => ({
          candidate_name: row.candidate_name,
          repo_url: row.repo_url,
          branch: row.branch || "main",
        })),
      });

      const fetchedRepos: RepoItem[] = (response.data.repositories || []).map((repo: RepoItem) => ({
        ...repo,
        analysis_run_id: repo.analysis_run_id ?? null,
        analysis_status: repo.analysis_status || "running",
        overall_score: repo.overall_score ?? null,
        analysis_error: null,
      }));

      setRepositories(fetchedRepos);
      setSkipped(response.data.skipped || []);
      setShowPreview(false);
      setActiveStep(2);
      startPolling();
    } catch (err: any) {
      handleAuthError(err);
      setActiveStep(null);
    } finally {
      setLoading(false);
    }
  };

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
  };

  const card = (content: React.ReactNode, extra?: React.CSSProperties) => (
    <div style={{
      background: "rgba(255,255,255,0.025)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 16,
      padding: "24px 28px",
      ...extra,
    }}>
      {content}
    </div>
  );

  const sectionTitle = (text: string) => (
    <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color: "white", margin: "0 0 16px" }}>
      {text}
    </h2>
  );

  return (
    <DashboardLayout>
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
        background: "radial-gradient(circle at 10% 0%, rgba(99,102,241,0.18), transparent 45%), radial-gradient(circle at 90% 20%, rgba(236,72,153,0.12), transparent 40%), #0a0a0f",
      }}>
        <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <div style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              padding: "5px 14px", borderRadius: 999,
              border: "1px solid rgba(99,102,241,0.4)",
              background: "rgba(99,102,241,0.12)",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.8px",
              color: "rgba(167,139,250,0.95)", textTransform: "uppercase",
              width: "fit-content", marginBottom: 10,
            }}>
              Recruiter Bulk Analysis
            </div>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: "white", letterSpacing: "-0.5px", margin: "0 0 4px" }}>
              Analyze candidate submissions at scale
            </h1>
            <p style={{ fontSize: 13.5, color: "rgba(255,255,255,0.35)", margin: 0, lineHeight: 1.6 }}>
              Upload a CSV or Excel file, preview the parsed candidates, edit anything that looks wrong, then start analysis.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,0.9fr)", gap: 22 }}>
            {card(
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <label style={{ fontSize: 12, letterSpacing: "0.6px", textTransform: "uppercase", color: "rgba(167,139,250,0.8)", fontWeight: 700 }}>
                    Candidate file (.csv, .xlsx, .xls)
                  </label>
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={(e) => {
                      setUploadFile(e.target.files?.[0] ?? null);
                      setShowPreview(false);
                      setPreviewRows([]);
                      setPreviewSkipped([]);
                    }}
                    style={{
                      marginTop: 8, width: "100%",
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(99,102,241,0.25)",
                      color: "white", borderRadius: 12, padding: "12px 14px", fontSize: 13,
                    }}
                  />
                  <div style={{ marginTop: 10, fontSize: 12, color: "rgba(148,163,184,0.7)", lineHeight: 1.6 }}>
                    Required columns: <code>candidate_name</code>, <code>repo_url</code>. Optional: <code>branch</code>.
                  </div>
                  <a href="/recruiter-candidate-template.csv" download style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "#a78bfa", textDecoration: "none" }}>
                    Download CSV template
                  </a>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "rgba(226,232,240,0.8)", fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={forceReanalyze} onChange={(e) => setForceReanalyze(e.target.checked)} style={{ width: 16, height: 16, accentColor: "#6366f1" }} />
                  Force reanalyze
                </label>

                {error && (
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "rgba(248,113,113,0.9)", fontSize: 12 }}>
                    {error}
                    {githubAuthUrl && (
                      <button onClick={() => { window.location.href = githubAuthUrl!; }} style={{ marginTop: 10, height: 38, borderRadius: 9, width: "100%", border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.15)", color: "rgba(224,231,255,0.95)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                        Connect GitHub
                      </button>
                    )}
                  </div>
                )}

                <button
                  onClick={handlePreview}
                  disabled={!uploadFile || loading}
                  style={{
                    height: 46, borderRadius: 12, border: "none",
                    background: "linear-gradient(135deg,#6366f1,#ec4899)",
                    color: "white", fontWeight: 700, fontSize: 14,
                    cursor: loading ? "not-allowed" : "pointer",
                    opacity: loading ? 0.7 : 1,
                  }}
                >
                  {loading && !showPreview ? "Reading file…" : "Preview candidates"}
                </button>
              </div>,
            )}

            {card(
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "rgba(226,232,240,0.9)", marginBottom: 14 }}>Progress</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {progressSteps.map((step, idx) => {
                    const isDone = activeStep !== null && idx < activeStep;
                    const isActive = activeStep === idx;
                    return (
                      <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, opacity: activeStep === null ? 0.4 : 1 }}>
                        <div style={{ width: 10, height: 10, borderRadius: "50%", flexShrink: 0, background: isDone ? "#a78bfa" : isActive ? "#ec4899" : "rgba(148,163,184,0.35)" }} />
                        <span style={{ fontSize: 12, color: isDone || isActive ? "rgba(226,232,240,0.9)" : "rgba(148,163,184,0.6)" }}>{step}</span>
                        {isDone && <span style={{ marginLeft: "auto", color: "#a78bfa" }}><CheckIcon /></span>}
                      </div>
                    );
                  })}
                </div>
              </>,
            )}
          </div>

          {showPreview && card(
            <>
              {sectionTitle("Preview before analysis")}
              <div style={{ fontSize: 12, color: "rgba(148,163,184,0.7)", marginBottom: 14 }}>
                Review and edit the parsed rows below. Invalid rows from the file are listed separately and will not be analyzed.
              </div>

              {previewRows.length === 0 ? (
                <div style={{ padding: 18, borderRadius: 12, border: "1px dashed rgba(255,255,255,0.1)", color: "rgba(248,113,113,0.85)", fontSize: 12, marginBottom: 16 }}>
                  No valid rows to analyze. Fix the file structure or edit rows manually.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                  {previewRows.map((row, index) => (
                    <div key={`${row.candidate_name}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.5fr auto", gap: 10, alignItems: "center" }}>
                      <input value={row.candidate_name} onChange={(e) => updatePreviewRow(index, { candidate_name: e.target.value })} placeholder="Candidate name" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "white", borderRadius: 10, padding: "10px 12px", fontSize: 13 }} />
                      <input value={row.repo_url} onChange={(e) => updatePreviewRow(index, { repo_url: e.target.value })} placeholder="https://github.com/org/repo" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "white", borderRadius: 10, padding: "10px 12px", fontSize: 13 }} />
                      <input value={row.branch} onChange={(e) => updatePreviewRow(index, { branch: e.target.value })} placeholder="main" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "white", borderRadius: 10, padding: "10px 12px", fontSize: 13 }} />
                      <button onClick={() => removePreviewRow(index)} style={{ height: 38, borderRadius: 10, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "rgba(248,113,113,0.9)", cursor: "pointer", fontSize: 12 }}>Remove</button>
                    </div>
                  ))}
                </div>
              )}

              {previewSkipped.length > 0 && (
                <div style={{ marginBottom: 16, fontSize: 12, color: "rgba(248,113,113,0.85)", lineHeight: 1.6 }}>
                  Skipped while reading file: {previewSkipped.map((item) => {
                    const label = item.candidate_name || item.repo_name || `row ${item.row}`;
                    return `${label} (${item.reason})`;
                  }).join("; ")}
                </div>
              )}

              <button
                onClick={handleConfirmAnalysis}
                disabled={previewRows.length === 0 || loading}
                style={{
                  height: 44, borderRadius: 12, border: "none",
                  background: "linear-gradient(135deg,#22c55e,#16a34a)",
                  color: "white", fontWeight: 700, fontSize: 14,
                  cursor: previewRows.length === 0 || loading ? "not-allowed" : "pointer",
                  opacity: previewRows.length === 0 || loading ? 0.6 : 1,
                }}
              >
                {loading ? "Starting analysis…" : `Start analysis (${previewRows.length})`}
              </button>
            </>,
          )}

          {isCandidateView ? (
            card(
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  {sectionTitle("Candidate View")}
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{candidateRows.length} candidates</div>
                </div>
                {candidateRows.length === 0 && <div style={{ fontSize: 12, color: "rgba(148,163,184,0.6)" }}>No candidate scores available yet.</div>}
                {candidateRows.map((row) => (
                  <div key={row.repo_name} style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", marginBottom: 10, display: "grid", gridTemplateColumns: "1.1fr 1fr 0.9fr 0.7fr", gap: 12 }}>
                    <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Candidate</div><div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>{row.candidate}</div></div>
                    <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Repository</div><div style={{ fontSize: 13 }}>{row.repo_name}</div></div>
                    <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Status</div><div style={{ fontSize: 13 }}>{row.analysis_status}</div><div style={{ fontSize: 11, color: "rgba(148,163,184,0.5)", marginTop: 4 }}>{formatTimestamp(row.analyzed_at)}</div></div>
                    <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Score</div><div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>{row.overall_score ?? "-"}</div></div>
                  </div>
                ))}
              </>,
            )
          ) : (
            card(
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  {sectionTitle("Repositories")}
                  <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>{repositories.length} scheduled</div>
                </div>
                {repositories.length === 0 && !loading && <div style={{ fontSize: 12, color: "rgba(148,163,184,0.6)" }}>Preview and confirm a candidate file to start bulk analysis.</div>}
                {repositories.map((repo) => (
                  <div key={`${repo.candidate}-${repo.repo_name}`} style={{ padding: "14px 16px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", marginBottom: 10, display: "grid", gridTemplateColumns: "1.2fr 0.7fr 1fr 0.7fr", gap: 12 }}>
                    <div><div style={{ fontSize: 13, fontWeight: 700, color: "white" }}>{repo.repo_name}</div><a href={repo.html_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#a78bfa" }}>View on GitHub</a></div>
                    <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Candidate</div><div style={{ fontWeight: 700 }}>{repo.candidate}</div></div>
                    <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Status</div><div>{repo.status || repo.analysis_status || "pending"}</div>{repo.analysis_error && <div style={{ fontSize: 11, color: "rgba(248,113,113,0.85)" }}>{repo.analysis_error}</div>}</div>
                    <div><div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>Score</div><div style={{ fontWeight: 700, color: "#a78bfa" }}>{repo.overall_score ?? "-"}</div></div>
                  </div>
                ))}
                {skipped.length > 0 && <div style={{ marginTop: 12, fontSize: 12, color: "rgba(148,163,184,0.5)" }}>Skipped: {skipped.map((item) => `${item.candidate_name || item.repo_name || `row ${item.row}`} (${item.reason})`).join(", ")}</div>}
              </>,
            )
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
