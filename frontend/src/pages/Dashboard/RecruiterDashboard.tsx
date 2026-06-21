import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type ApiError = {
  response?: {
    data?: {
      detail?: unknown;
    };
  };
};

const progressSteps = [
  "Reading candidate list",
  "Confirming candidates",
  "Running analysis",
  "Ranking candidates",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const UploadIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const FileIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
  </svg>
);

const XIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

// ─── Custom File Upload Zone ──────────────────────────────────────────────

function FileUploadZone({
  file,
  onChange,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) onChange(dropped);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = () => setDragging(false);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div>
      <label style={{
        fontSize: 12, letterSpacing: "0.6px", textTransform: "uppercase" as const,
        color: "rgba(167,139,250,0.8)", fontWeight: 700, display: "block", marginBottom: 10,
      }}>
        Candidate file (.csv, .xlsx, .xls)
      </label>

      {/* Hidden real input */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: "none" }}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />

      {!file ? (
        /* Drop zone */
        <div
          onClick={() => inputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          style={{
            border: `2px dashed ${dragging ? "rgba(99,102,241,0.7)" : "rgba(99,102,241,0.25)"}`,
            borderRadius: 14,
            padding: "28px 20px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
            background: dragging ? "rgba(99,102,241,0.07)" : "rgba(99,102,241,0.03)",
            transition: "all 0.2s",
            userSelect: "none",
          }}
          onMouseEnter={e => {
            if (!dragging) {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(99,102,241,0.5)";
              (e.currentTarget as HTMLDivElement).style.background = "rgba(99,102,241,0.06)";
            }
          }}
          onMouseLeave={e => {
            if (!dragging) {
              (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(99,102,241,0.25)";
              (e.currentTarget as HTMLDivElement).style.background = "rgba(99,102,241,0.03)";
            }
          }}
        >
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            background: "rgba(99,102,241,0.12)",
            border: "1px solid rgba(99,102,241,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "rgba(167,139,250,0.8)",
          }}>
            <UploadIcon />
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
              Drop your file here, or{" "}
              <span style={{ color: "#a78bfa", textDecoration: "underline", textUnderlineOffset: 3 }}>browse</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Supports .csv, .xlsx, .xls
            </div>
          </div>
        </div>
      ) : (
        /* File selected state */
        <div style={{
          border: "1px solid rgba(99,102,241,0.35)",
          borderRadius: 14,
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "rgba(99,102,241,0.06)",
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10, flexShrink: 0,
            background: "rgba(99,102,241,0.15)",
            border: "1px solid rgba(99,102,241,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#a78bfa",
          }}>
            <FileIcon />
          </div>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {file.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              {formatSize(file.size)}
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            style={{
              width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(248,113,113,0.25)",
              background: "rgba(248,113,113,0.08)", color: "rgba(248,113,113,0.8)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer", flexShrink: 0, transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(248,113,113,0.18)";
              e.currentTarget.style.color = "#f87171";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(248,113,113,0.08)";
              e.currentTarget.style.color = "rgba(248,113,113,0.8)";
            }}
          >
            <XIcon />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────

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
  const restoredRef = useRef(false);

  const candidateRows = useMemo(() => {
    return [...repositories]
      .map((repo) => ({
        candidate: repo.candidate,
        repo_name: repo.repo_name,
        overall_score: repo.overall_score ?? null,
        analysis_status: repo.analysis_status || repo.status || "pending",
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

  const isPendingRepo = useCallback((repo: RepoItem) => {
    const status = repo.analysis_status || repo.status || "pending";
    return Boolean(repo.analysis_run_id) && (status === "running" || status === "pending");
  }, []);

  useEffect(() => { repositoriesRef.current = repositories; }, [repositories]);
  useEffect(() => {
    if (repositories.length) localStorage.setItem("recruiter_candidate_repos", JSON.stringify(repositories));
  }, [repositories]);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    try {
      const raw = localStorage.getItem("recruiter_candidate_repos");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRepositories(parsed);
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => () => stopPolling(), []);

  const updateRepo = useCallback((target: RepoItem, patch: Partial<RepoItem>) =>
    setRepositories((prev) => prev.map((repo) => {
      const sameRun = target.analysis_run_id && repo.analysis_run_id === target.analysis_run_id;
      const sameCandidateRepo = repo.candidate === target.candidate && repo.repo_name === target.repo_name;
      if (!sameRun && !sameCandidateRepo) return repo;
      const changed = Object.entries(patch).some(([key, value]) => repo[key as keyof RepoItem] !== value);
      return changed ? { ...repo, ...patch } : repo;
    })), []);

  const updatePreviewRow = (index: number, patch: Partial<PreviewRow>) =>
    setPreviewRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const removePreviewRow = (index: number) =>
    setPreviewRows((prev) => prev.filter((_, i) => i !== index));

  const pollAnalysisStatus = useCallback(async () => {
    const current = repositoriesRef.current;
    const pending = current.filter(
      isPendingRepo,
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
          updateRepo(repo, {
            analysis_status: "completed",
            status: "completed",
            overall_score: res.data?.scores?.overall ?? null,
          });
        } else if (status === "failed") {
          updateRepo(repo, {
            analysis_status: "failed",
            status: "failed",
            analysis_error: res.data?.message || "Analysis failed",
          });
        } else {
          updateRepo(repo, { analysis_status: status, status });
        }
      } catch {
        updateRepo(repo, {
          analysis_status: "failed",
          status: "failed",
          analysis_error: "Unable to fetch analysis status.",
        });
      }
    }));
  }, [isPendingRepo, updateRepo]);

  const startPolling = useCallback((force = false) => {
    if (pollingRef.current && !force) return;
    stopPolling();
    void pollAnalysisStatus();
    pollingRef.current = window.setInterval(pollAnalysisStatus, 4000);
  }, [pollAnalysisStatus]);

  useEffect(() => {
    if (!repositories.some(isPendingRepo)) return;
    setActiveStep(2);
    startPolling();
  }, [isPendingRepo, repositories, startPolling]);

  const handleAuthError = (err: unknown) => {
    const detail = (err as ApiError)?.response?.data?.detail;
    const needsAuth = isRecord(detail) && Boolean(detail.requires_github_auth);
    if (needsAuth) {
      setGithubAuthUrl(typeof detail.auth_url === "string" ? detail.auth_url : null);
      setError("Connect GitHub to analyze candidate repositories.");
    } else {
      setError(typeof detail === "string" ? detail : "Request failed. Please try again.");
    }
  };

  const handleFileChange = (f: File | null) => {
    setUploadFile(f);
    setShowPreview(false);
    setPreviewRows([]);
    setPreviewSkipped([]);
  };

  const handlePreview = async () => {
    if (!uploadFile) { setError("Upload a CSV or Excel file with candidate repositories."); return; }
    setError(null); setGithubAuthUrl(null); setLoading(true);
    setShowPreview(false); setActiveStep(0);
    try {
      const formData = new FormData();
      formData.append("file", uploadFile);
      const response = await api.post("/api/recruiter/bulk-analyze/preview", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreviewRows(response.data.rows || []);
      setPreviewSkipped(response.data.skipped || []);
      setShowPreview(true);
      if ((response.data.rows || []).length === 0)
        setError("No valid candidate rows were found. Check the skipped rows below and fix your file.");
    } catch (err: unknown) {
      handleAuthError(err); setActiveStep(null);
    } finally { setLoading(false); }
  };

  const handleConfirmAnalysis = async () => {
    if (previewRows.length === 0) { setError("Add at least one valid candidate row before starting analysis."); return; }
    setError(null); setGithubAuthUrl(null); setLoading(true);
    setRepositories([]); setSkipped([]); setActiveStep(1); stopPolling();
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
      setShowPreview(false); setActiveStep(2); startPolling(true);
    } catch (err: unknown) {
      handleAuthError(err); setActiveStep(null);
    } finally { setLoading(false); }
  };

  const formatTimestamp = (value?: string | null) => {
    if (!value) return "-";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString();
  };

  const card = (content: React.ReactNode, extra?: React.CSSProperties) => (
    <div style={{
      background: "var(--bg-card)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      padding: "24px 28px",
      ...extra,
    }}>
      {content}
    </div>
  );

  const sectionTitle = (text: string) => (
    <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 800, color: "var(--text-primary)", margin: "0 0 16px" }}>
      {text}
    </h2>
  );

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        input { outline: none; font-family: 'DM Sans', sans-serif; color: var(--text-primary); }
        input::placeholder { color: var(--text-faint); }

        .rec-input {
          background: var(--bg-input);
          border: 1px solid var(--border-input);
          color: var(--text-primary);
          border-radius: 10px;
          padding: 10px 12px;
          font-size: 13px;
          transition: border-color 0.2s;
          font-family: 'DM Sans', sans-serif;
        }
        .rec-input:focus { border-color: rgba(99,102,241,0.5); outline: none; }
        .rec-input::placeholder { color: var(--text-faint); }

        .rec-row-card {
          padding: 14px 16px;
          border-radius: 12px;
          border: 1px solid var(--border);
          background: var(--bg-card-hover);
          margin-bottom: 10px;
          transition: border-color 0.15s;
        }
        .rec-row-card:hover { border-color: var(--border-hover); }

        .rec-meta-label {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 3px;
        }
        .rec-meta-value {
          font-size: 13px;
          font-weight: 700;
          color: var(--text-primary);
        }
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
              border: "1px solid rgba(99,102,241,0.4)",
              background: "rgba(99,102,241,0.12)",
              fontSize: 11, fontWeight: 700, letterSpacing: "0.8px",
              color: "rgba(167,139,250,0.95)", textTransform: "uppercase" as const,
              width: "fit-content", marginBottom: 10,
            }}>
              Recruiter Bulk Analysis
            </div>
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 26, fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.5px", margin: "0 0 4px" }}>
              Analyze candidate submissions at scale
            </h1>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: 0, lineHeight: 1.6 }}>
              Upload a CSV or Excel file, preview the parsed candidates, edit anything that looks wrong, then start analysis.
            </p>
          </div>

          {/* ── Upload + Progress ── */}
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.1fr) minmax(0,0.9fr)", gap: 22 }}>
            {card(
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

                {/* Custom file upload zone */}
                <FileUploadZone file={uploadFile} onChange={handleFileChange} />

                {/* Helper text */}
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  Required columns:{" "}
                  <code style={{ background: "var(--bg-card-hover)", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>candidate_name</code>,{" "}
                  <code style={{ background: "var(--bg-card-hover)", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>repo_url</code>.
                  {" "}Optional:{" "}
                  <code style={{ background: "var(--bg-card-hover)", padding: "1px 5px", borderRadius: 4, fontSize: 11 }}>branch</code>.
                  <br />
                  <a href="/recruiter-candidate-template.csv" download style={{ color: "#a78bfa", textDecoration: "none", display: "inline-block", marginTop: 4 }}>
                    Download CSV template ↓
                  </a>
                </div>

                <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text-secondary)", fontWeight: 600, cursor: "pointer" }}>
                  <input type="checkbox" checked={forceReanalyze} onChange={(e) => setForceReanalyze(e.target.checked)} style={{ width: 16, height: 16, accentColor: "#6366f1" }} />
                  Force reanalyze
                </label>

                {error && (
                  <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)", color: "rgba(248,113,113,0.9)", fontSize: 12 }}>
                    {error}
                    {githubAuthUrl && (
                      <button
                        onClick={() => { window.location.href = githubAuthUrl!; }}
                        style={{ marginTop: 10, height: 38, borderRadius: 9, width: "100%", border: "1px solid rgba(99,102,241,0.4)", background: "rgba(99,102,241,0.15)", color: "var(--text-primary)", fontWeight: 700, fontSize: 12, cursor: "pointer" }}
                      >
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
                    cursor: loading || !uploadFile ? "not-allowed" : "pointer",
                    opacity: loading || !uploadFile ? 0.5 : 1,
                    transition: "opacity 0.2s",
                  }}
                >
                  {loading && !showPreview ? "Reading file…" : "Preview candidates"}
                </button>
              </div>,
            )}

            {card(
              <>
                <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", marginBottom: 14 }}>Progress</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {progressSteps.map((step, idx) => {
                    const isDone = activeStep !== null && idx < activeStep;
                    const isActive = activeStep === idx;
                    return (
                      <div key={step} style={{ display: "flex", alignItems: "center", gap: 10, opacity: activeStep === null ? 0.4 : 1 }}>
                        <div style={{
                          width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                          background: isDone ? "#a78bfa" : isActive ? "#ec4899" : "var(--border-hover)",
                        }} />
                        <span style={{ fontSize: 12, color: isDone || isActive ? "var(--text-primary)" : "var(--text-muted)" }}>{step}</span>
                        {isDone && <span style={{ marginLeft: "auto", color: "#a78bfa" }}><CheckIcon /></span>}
                      </div>
                    );
                  })}
                </div>
              </>,
            )}
          </div>

          {/* ── Preview ── */}
          {showPreview && card(
            <>
              {sectionTitle("Preview before analysis")}
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14 }}>
                Review and edit the parsed rows below. Invalid rows from the file are listed separately and will not be analyzed.
              </div>

              {previewRows.length === 0 ? (
                <div style={{ padding: 18, borderRadius: 12, border: "1px dashed var(--border-hover)", color: "rgba(248,113,113,0.85)", fontSize: 12, marginBottom: 16 }}>
                  No valid rows to analyze. Fix the file structure or edit rows manually.
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10, marginBottom: 16 }}>
                  {previewRows.map((row, index) => (
                    <div key={`${row.candidate_name}-${index}`} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 0.5fr auto", gap: 10, alignItems: "center" }}>
                      <input className="rec-input" value={row.candidate_name} onChange={(e) => updatePreviewRow(index, { candidate_name: e.target.value })} placeholder="Candidate name" />
                      <input className="rec-input" value={row.repo_url} onChange={(e) => updatePreviewRow(index, { repo_url: e.target.value })} placeholder="https://github.com/org/repo" />
                      <input className="rec-input" value={row.branch} onChange={(e) => updatePreviewRow(index, { branch: e.target.value })} placeholder="main" />
                      <button
                        onClick={() => removePreviewRow(index)}
                        style={{ height: 38, borderRadius: 10, border: "1px solid rgba(248,113,113,0.25)", background: "rgba(248,113,113,0.08)", color: "rgba(248,113,113,0.9)", cursor: "pointer", fontSize: 12 }}
                      >
                        Remove
                      </button>
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

          {/* ── Results ── */}
          {isCandidateView ? (
            card(
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  {sectionTitle("Candidate View")}
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{candidateRows.length} candidates</div>
                </div>
                {candidateRows.length === 0 && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No candidate scores available yet.</div>
                )}
                {candidateRows.map((row) => (
                  <div key={row.repo_name} className="rec-row-card" style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr 0.9fr 0.7fr", gap: 12 }}>
                    <div><div className="rec-meta-label">Candidate</div><div className="rec-meta-value">{row.candidate}</div></div>
                    <div><div className="rec-meta-label">Repository</div><div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{row.repo_name}</div></div>
                    <div>
                      <div className="rec-meta-label">Status</div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{row.analysis_status}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{formatTimestamp(row.analyzed_at)}</div>
                    </div>
                    <div>
                      <div className="rec-meta-label">Score</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>{row.overall_score ?? "-"}</div>
                    </div>
                  </div>
                ))}
              </>,
            )
          ) : (
            card(
              <>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
                  {sectionTitle("Repositories")}
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{repositories.length} scheduled</div>
                </div>
                {repositories.length === 0 && !loading && (
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Preview and confirm a candidate file to start bulk analysis.</div>
                )}
                {repositories.map((repo) => (
                  <div key={`${repo.candidate}-${repo.repo_name}`} className="rec-row-card" style={{ display: "grid", gridTemplateColumns: "1.2fr 0.7fr 1fr 0.7fr", gap: 12 }}>
                    <div>
                      <div className="rec-meta-value">{repo.repo_name}</div>
                      <a href={repo.html_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: "#a78bfa", textDecoration: "none" }}>View on GitHub</a>
                    </div>
                    <div>
                      <div className="rec-meta-label">Candidate</div>
                      <div className="rec-meta-value">{repo.candidate}</div>
                    </div>
                    <div>
                      <div className="rec-meta-label">Status</div>
                      <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>{repo.analysis_status || repo.status || "pending"}</div>
                      {repo.analysis_error && <div style={{ fontSize: 11, color: "rgba(248,113,113,0.85)", marginTop: 3 }}>{repo.analysis_error}</div>}
                    </div>
                    <div>
                      <div className="rec-meta-label">Score</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "#a78bfa" }}>{repo.overall_score ?? "-"}</div>
                    </div>
                  </div>
                ))}
                {skipped.length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
                    Skipped: {skipped.map((item) => `${item.candidate_name || item.repo_name || `row ${item.row}`} (${item.reason})`).join(", ")}
                  </div>
                )}
              </>,
            )
          )}

        </div>
      </div>
    </DashboardLayout>
  );
}
