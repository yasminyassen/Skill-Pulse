import { useEffect, useRef, useState } from "react";
import api, { API_BASE_URL } from "../api/auth";
import DashboardLayout from "./DashboardLayout";

interface Analysis {
  analysis_id: number;
  repo_name: string;
  branch: string;
  status: string;
  triggered_at: string;
  score: number | null;
}

/* ─── tiny helpers ──────────────────────────────────────────── */
const scoreColor = (s: number | null) => {
  if (s === null) return "#6b7280";
  if (s >= 80) return "#34d399";
  if (s >= 50) return "#fbbf24";
  return "#f87171";
};

const scoreLabel = (s: number | null) => {
  if (s === null) return "—";
  if (s >= 80) return "Excellent";
  if (s >= 60) return "Good";
  if (s >= 40) return "Fair";
  return "Needs work";
};

const statusConfig: Record<string, { color: string; bg: string; dot: string; label: string }> = {
  completed: { color: "#34d399", bg: "rgba(52,211,153,0.1)", dot: "#34d399", label: "Completed" },
  failed: { color: "#f87171", bg: "rgba(248,113,113,0.1)", dot: "#f87171", label: "Failed" },
  running: { color: "#fbbf24", bg: "rgba(251,191,36,0.1)", dot: "#fbbf24", label: "Running" },
  pending: { color: "#94a3b8", bg: "rgba(148,163,184,0.1)", dot: "#94a3b8", label: "Pending" },
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

/* ─── component ─────────────────────────────────────────────── */
export default function RepositoryAnalysis() {
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<number | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [githubAuthUrl, setGithubAuthUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const role = localStorage.getItem("role") || "developer";

  const [pendingAutoRun, setPendingAutoRun] = useState<{url: string, branch: string} | null>(null);

  /* ── resume after GitHub OAuth ── */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github_connected") === "true") {
      const saved = localStorage.getItem("pending_repo");
      if (saved) {
        const { repoUrl: savedUrl, branch: savedBranch } = JSON.parse(saved);
        setRepoUrl(savedUrl);
        setBranch(savedBranch);
        localStorage.removeItem("pending_repo");
        localStorage.removeItem("github_reauth_attempted");
        window.history.replaceState({}, document.title, window.location.pathname);
        setPendingAutoRun({ url: savedUrl, branch: savedBranch });
      }
    }
    fetchHistory();
  }, []);

  /* ── trigger auto-run after state is set ── */
  useEffect(() => {
    if (pendingAutoRun) {
      startAnalysis(pendingAutoRun.url, pendingAutoRun.branch);
      setPendingAutoRun(null);
    }
  }, [pendingAutoRun]);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get("/analysis/history");
      setAnalyses(res.data.history);
    } catch (_) {
      // Silent here — global interceptor handles session expiry and redirect.
    } finally {
      setHistoryLoading(false);
    }
  };

  /* ── start analysis ── */
  const startAnalysis = async (url: string, br: string) => {
    if (!url) { setUrlError("Please enter a GitHub repository URL"); return; }
    if (!/^https:\/\/github\.com\/.+/.test(url)) {
      setUrlError("URL must start with https://github.com/…");
      return;
    }

    setUrlError("");
    setGithubAuthUrl(null);
    setFailedMsg(null);
    setLoading(true);
    try {
      const res = await api.post("/analysis/run", { repo_url: url, branch: br });
      setRunId(res.data.analysis_run_id);
    } catch (err: any) {
      setLoading(false);
      const status = err.response?.status;
      const detail = err.response?.data?.detail;

      // Case 1: needs GitHub OAuth
      // Backend returns 403 + detail = { requires_github_auth: true, auth_url: "..." }
      const needsAuth =
        (typeof detail === "object" && detail?.requires_github_auth) ||
        err.response?.data?.requires_github_auth;

      // Case 2: recruiter tried to access a private repo
      if (status === 403 && (detail?.recruiter_private_repo || role === "recruiter")) {
        setUrlError("Private repositories are not supported for Recruiter accounts. Please use a public repository URL.");
        return;
      }

      if (needsAuth) {
        const authUrl =
          (typeof detail === "object" ? detail?.auth_url : null) ??
          err.response?.data?.auth_url;

        const isExpiredGithubToken =
          typeof detail === "object" && detail?.reason === "github_token_expired";

        localStorage.setItem("pending_repo", JSON.stringify({ repoUrl: url, branch: br }));

        if (isExpiredGithubToken && authUrl) {
          const reauthAttempted = localStorage.getItem("github_reauth_attempted") === "1";
          if (!reauthAttempted) {
            localStorage.setItem("github_reauth_attempted", "1");
            window.location.href = authUrl;
            return;
          }

          setUrlError("GitHub session expired. Please reconnect your GitHub account and try again.");
          return;
        }

        setGithubAuthUrl(authUrl);
        return;
      }

      // Case 3: repo not found or branch doesn't exist
      if (status === 404) {
        setUrlError("Repository not found. Check the URL is correct.");
        return;
      }

      // Case 4: invalid URL format
      if (status === 400) {
        setUrlError("Invalid GitHub repository URL. Use the format: https://github.com/owner/repo");
        return;
      }

      // Case 5: rate limit (429 from our limiter, 503 from GitHub rate limit)
      // Case 5: app rate limit (too many requests to our own API)
      if (status === 429) {
        setUrlError("Too many requests. Please wait a moment before trying again.");
        return;
      }

      // Case 6: GitHub API rate limit
      if (status === 503) {
        setUrlError("GitHub API rate limit reached. Please wait a moment and try again.");
        return;
      }
      // if (status === 429 || status === 503) {
      //   setUrlError("GitHub API rate limit reached. Connect your GitHub account to get 5,000 requests/hour and analyze any repository.");
      //   return;
      // }

      setUrlError("Something went wrong. Please try again.");
    }
  };

  const [failedMsg, setFailedMsg] = useState<string | null>(null);

  /* ── polling ── */
  useEffect(() => {
    if (!runId) return;
    const iv = setInterval(async () => {
      try {
        const res = await api.get(`/analysis/${runId}`);
        if (res.data.status === "completed") {
          clearInterval(iv);
          setLoading(false);
          setRunId(null);
          fetchHistory();
        } else if (res.data.status === "failed") {
          clearInterval(iv);
          setLoading(false);
          setRunId(null);
          const reason = res.data.error_reason;
          if (reason === "rate_limit") {
            setFailedMsg("__rate_limit__");
          } else if (reason === "not_found") {
            setFailedMsg("Repository or branch not found. Check the URL and branch name.");
          } else {
            setFailedMsg("Analysis failed. This is usually caused by: no Python files found, an unsupported branch name, or a network error. Check the URL and branch, then try again.");
          }
          fetchHistory();
        }
      } catch { clearInterval(iv); setLoading(false); }
    }, 3000);
    return () => clearInterval(iv);
  }, [runId]);

  /* ── drag-drop ── */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  };

  const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        
        .sp-input {
          width: 100%; padding: 11px 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; color: white;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px; outline: none;
          transition: border-color 0.2s, background 0.2s;
          box-sizing: border-box;
        }
        .sp-input::placeholder { color: rgba(255,255,255,0.25); }
        .sp-input:focus { border-color: ${accent}60; background: rgba(255,255,255,0.06); }
        .sp-input.error { border-color: rgba(248,113,113,0.5); }

        .sp-select {
          padding: 11px 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; color: white;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px; outline: none; cursor: pointer;
          transition: border-color 0.2s;
        }
        .sp-select:focus { border-color: ${accent}60; }
        .sp-select option { background: #1a1a2e; }

        .sp-btn-primary {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 11px 24px;
          background: linear-gradient(135deg, ${accent}, #ec4899);
          border: none; border-radius: 10px;
          color: white; font-family: 'DM Sans', sans-serif;
          font-size: 14px; font-weight: 600; cursor: pointer;
          transition: all 0.2s; box-shadow: 0 4px 16px ${accent}30;
        }
        .sp-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px ${accent}40; }
        .sp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }

        .sp-btn-ghost {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 16px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 9px; color: rgba(255,255,255,0.6);
          font-family: 'DM Sans', sans-serif;
          font-size: 13px; font-weight: 500; cursor: pointer;
          transition: all 0.2s;
        }
        .sp-btn-ghost:hover { background: rgba(255,255,255,0.08); color: white; border-color: rgba(255,255,255,0.2); }
        .sp-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

        .sp-card {
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px; padding: 28px;
        }

        .analysis-row {
          display: flex; align-items: center; gap: 16px;
          padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.15s; border-radius: 8px;
        }
        .analysis-row:last-child { border-bottom: none; }
        .analysis-row:hover { background: rgba(255,255,255,0.02); }

        .score-ring {
          width: 52px; height: 52px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0; position: relative;
          font-size: 15px; font-weight: 700;
        }

        .skeleton {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 400% 100%;
          animation: shimmer 1.5s ease-in-out infinite;
          border-radius: 8px;
        }
        @keyframes shimmer {
          0% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }

        .pulse-dot {
          width: 8px; height: 8px; border-radius: 50%; background: #fbbf24;
          animation: pulse 1.4s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }

        .drop-zone {
          border: 1.5px dashed rgba(255,255,255,0.15);
          border-radius: 12px; padding: 32px 20px;
          text-align: center; cursor: pointer; transition: all 0.2s;
        }
        .drop-zone:hover, .drop-zone.active {
          border-color: ${accent}60; background: ${accent}08;
        }

        .sp-label {
          font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.4);
          text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 7px;
          display: block;
        }

        .progress-bar {
          height: 3px; background: rgba(255,255,255,0.06); border-radius: 2px; overflow: hidden;
        }
        .progress-fill {
          height: 100%; border-radius: 2px;
          background: linear-gradient(90deg, ${accent}, #ec4899);
          background-size: 200%;
          animation: progressSlide 1.5s ease-in-out infinite;
          width: 65%;
        }
        @keyframes progressSlide {
          0% { transform: translateX(-150%); }
          100% { transform: translateX(250%); }
        }
      `}</style>

      <div style={{
        padding: "32px 36px",
        maxWidth: "920px",
        fontFamily: "'DM Sans', sans-serif",
      }}>

        {/* Page header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "26px", fontWeight: 800,
            color: "white", letterSpacing: "-0.5px",
            margin: "0 0 6px",
          }}>
            Repository Analysis
          </h1>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
            Analyze GitHub repositories and convert source code into measurable skill scores
          </p>
        </div>

        {/* ── Start New Analysis card ── */}
        <div className="sp-card" style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
            <div style={{
              width: "34px", height: "34px", borderRadius: "10px",
              background: `${accent}18`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "white" }}>Start New Analysis</div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>Enter a public or private GitHub repository</div>
            </div>
          </div>

          {/* GitHub URL */}
          <div style={{ marginBottom: "16px" }}>
            <label className="sp-label">GitHub Repository URL</label>
            <div style={{ position: "relative" }}>
              <div style={{
                position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)",
                color: "rgba(255,255,255,0.25)",
              }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </div>
              <input
                type="text"
                className={`sp-input${urlError ? " error" : ""}`}
                style={{ paddingLeft: "38px" }}
                placeholder="https://github.com/owner/repository"
                value={repoUrl}
                onChange={e => { setRepoUrl(e.target.value); setUrlError(""); }}
              />
            </div>
            {urlError && (
              <div style={{ marginTop: "6px", fontSize: "12.5px", color: "#f87171", display: "flex", alignItems: "center", gap: "5px" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                {urlError}
              </div>
            )}
          </div>

          {/* GitHub Auth Required Banner */}
          {githubAuthUrl && role !== "recruiter" && (
            <div style={{
              marginBottom: "16px",
              padding: "16px 18px",
              background: "rgba(251,191,36,0.07)",
              border: "1px solid rgba(251,191,36,0.25)",
              borderRadius: "12px",
              display: "flex", alignItems: "center", gap: "14px",
            }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                background: "rgba(251,191,36,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#fbbf24" }}>
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#fbbf24", marginBottom: "3px" }}>
                  GitHub Authorization Required
                </div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                  This is a private repository. Connect your GitHub account to allow SkillPulse to access it. You'll be redirected back automatically after authorization.
                </div>
              </div>
              <button
                onClick={() => { window.location.href = githubAuthUrl; }}
                style={{
                  flexShrink: 0,
                  padding: "9px 18px",
                  background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
                  border: "none", borderRadius: "9px",
                  color: "#0a0a0f", fontSize: "13px", fontWeight: 700,
                  cursor: "pointer", whiteSpace: "nowrap",
                  boxShadow: "0 4px 14px rgba(251,191,36,0.3)",
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(251,191,36,0.4)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 4px 14px rgba(251,191,36,0.3)"; }}
              >
                Connect GitHub →
              </button>
            </div>
          )}

          {/* Language + Branch */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginBottom: "20px" }}>
            <div>
              <label className="sp-label">Programming Language</label>
              <select className="sp-select" style={{ width: "100%" }}>
                <option>Python (MVP)</option>
              </select>
              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)", marginTop: "5px" }}>
                Multi-language support coming soon
              </div>
            </div>
            <div>
              <label className="sp-label">Branch (Optional)</label>
              <input
                type="text"
                className="sp-input"
                placeholder="main"
                value={branch}
                onChange={e => setBranch(e.target.value)}
              />
            </div>
          </div>

          {/* Manager only: Business Requirements */}
          {role === "manager" && (
            <div style={{
              marginBottom: "20px",
              padding: "20px",
              background: "rgba(139,92,246,0.05)",
              border: "1px solid rgba(139,92,246,0.15)",
              borderRadius: "12px",
            }}>
              <div style={{ marginBottom: "14px" }}>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "white", marginBottom: "3px" }}>
                  Business Requirements
                  <span style={{
                    marginLeft: "8px", fontSize: "10px", fontWeight: 500,
                    color: "rgba(255,255,255,0.3)", letterSpacing: "0.3px",
                  }}>OPTIONAL</span>
                </div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
                  Upload a PRD to extract and map requirements to code automatically
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
                <button className="sp-btn-ghost" onClick={() => fileInputRef.current?.click()}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Upload PRD File
                </button>
                <button className="sp-btn-ghost" disabled title="Coming soon" style={{ opacity: 0.4, cursor: "not-allowed" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                  </svg>
                  Connect Jira
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)" }}>Soon</span>
                </button>
              </div>
              <div
                className={`drop-zone${dragOver ? " active" : ""}`}
                onDrop={handleDrop}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
              >
                {file ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                    <div style={{
                      width: "34px", height: "34px", borderRadius: "8px",
                      background: `${accent}20`, display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                      </svg>
                    </div>
                    <div style={{ textAlign: "left" }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "white" }}>{file.name}</div>
                      <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); setFile(null); }}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", marginLeft: "8px" }}
                    >✕</button>
                  </div>
                ) : (
                  <>
                    <div style={{
                      width: "40px", height: "40px", borderRadius: "50%",
                      background: "rgba(255,255,255,0.05)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      margin: "0 auto 12px",
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                    </div>
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", marginBottom: "4px" }}>
                      Drop your PRD file here or <span style={{ color: accent }}>browse</span>
                    </div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.2)" }}>
                      PDF or Excel · Max 10MB
                    </div>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.xlsx,.xls"
                style={{ display: "none" }}
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </div>
          )}

          {/* Submit */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button
              className="sp-btn-primary"
              disabled={loading}
              onClick={() => startAnalysis(repoUrl, branch)}
            >
              {loading ? (
                <>
                  <div className="pulse-dot" />
                  Analyzing…
                </>
              ) : (
                <>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  {role === "manager" ? "Analyze Code & Requirements" : "Analyze Repository"}
                </>
              )}
            </button>

            {loading && runId && (
              <div style={{ flex: 1, maxWidth: "200px" }}>
                <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginBottom: "6px" }}>
                  Analysis in progress…
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" />
                </div>
              </div>
            )}
          </div>

          {/* Analysis failed banner */}
          {failedMsg && failedMsg === "__rate_limit__" ? (
            <div style={{
              marginTop: "16px", padding: "16px 18px",
              background: "rgba(251,191,36,0.07)",
              border: "1px solid rgba(251,191,36,0.25)",
              borderRadius: "12px",
              display: "flex", alignItems: "center", gap: "14px",
            }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0,
                background: "rgba(251,191,36,0.12)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#fbbf24" }}>
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#fbbf24", marginBottom: "3px" }}>
                  GitHub Rate Limit Reached
                </div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                  Unauthenticated GitHub API requests are limited to 60/hour. Connect your GitHub account to get 5,000 requests/hour and analyze any public or private repository.
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", flexShrink: 0 }}>
                <button
                  onClick={() => {
                    const token = localStorage.getItem("token");
                    if (token) window.location.href = `${API_BASE_URL}/auth/github?action=connect&token=${token}`;
                  }}
                  style={{
                    padding: "9px 18px",
                    background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
                    border: "none", borderRadius: "9px",
                    color: "#0a0a0f", fontSize: "13px", fontWeight: 700,
                    cursor: "pointer", whiteSpace: "nowrap",
                    boxShadow: "0 4px 14px rgba(251,191,36,0.3)",
                  }}
                >Connect GitHub →</button>
                <button onClick={() => setFailedMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: "12px" }}>Dismiss</button>
              </div>
            </div>
          ) : failedMsg && (
            <div style={{
              marginTop: "16px",
              padding: "14px 16px",
              background: "rgba(248,113,113,0.08)",
              border: "1px solid rgba(248,113,113,0.25)",
              borderRadius: "10px",
              display: "flex", gap: "10px", alignItems: "flex-start",
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "1px" }}>
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div>
                <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#f87171", marginBottom: "3px" }}>Analysis Failed</div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>{failedMsg}</div>
              </div>
              <button
                onClick={() => setFailedMsg(null)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.2)", marginLeft: "auto", flexShrink: 0, padding: "0" }}
              >✕</button>
            </div>
          )}
        </div>

        {/* ── Recent Analyses card ── */}
        <div className="sp-card" style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{
                width: "34px", height: "34px", borderRadius: "10px",
                background: "rgba(255,255,255,0.05)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "white" }}>Recent Analyses</div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>
                  {analyses.length} {analyses.length === 1 ? "repository" : "repositories"} analyzed
                </div>
              </div>
            </div>
            <button
              className="sp-btn-ghost"
              style={{ fontSize: "12px", padding: "7px 13px" }}
              onClick={fetchHistory}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Refresh
            </button>
          </div>

          {/* Skeleton */}
          {historyLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ display: "flex", gap: "14px", alignItems: "center" }}>
                  <div className="skeleton" style={{ width: "48px", height: "48px", borderRadius: "12px", flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div className="skeleton" style={{ height: "14px", width: "45%" }} />
                    <div className="skeleton" style={{ height: "11px", width: "30%" }} />
                  </div>
                  <div className="skeleton" style={{ width: "50px", height: "50px", borderRadius: "50%" }} />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!historyLoading && analyses.length === 0 && (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <div style={{
                width: "56px", height: "56px", borderRadius: "16px",
                background: "rgba(255,255,255,0.04)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 16px",
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
                </svg>
              </div>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.4)", marginBottom: "4px" }}>
                No analyses yet
              </div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.2)" }}>
                Enter a repository URL above to get started
              </div>
            </div>
          )}

          {/* List */}
          {!historyLoading && analyses.map(a => {
            const st = statusConfig[a.status] || statusConfig.pending;
            const sc = a.score;
            const sColor = scoreColor(sc);
            return (
              <div key={a.analysis_id} className="analysis-row" style={{ padding: "14px 8px" }}>
                {/* Repo icon */}
                <div style={{
                  width: "44px", height: "44px", borderRadius: "12px", flexShrink: 0,
                  background: "rgba(255,255,255,0.05)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
                  </svg>
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.repo_name}
                    </span>
                    <span style={{
                      fontSize: "10px", fontWeight: 600,
                      padding: "2px 7px", borderRadius: "20px",
                      background: "rgba(99,102,241,0.15)",
                      color: "#818cf8", flexShrink: 0,
                    }}>Python</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.3)" }}>
                      {a.branch} · {timeAgo(a.triggered_at)}
                    </span>
                    <span style={{
                      display: "inline-flex", alignItems: "center", gap: "5px",
                      fontSize: "11px", fontWeight: 500,
                      padding: "2px 8px", borderRadius: "20px",
                      background: st.bg, color: st.color,
                    }}>
                      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: st.dot, animation: a.status === "running" ? "pulse 1.4s ease-in-out infinite" : "none" }} />
                      {st.label}
                    </span>
                  </div>
                </div>

                {/* Score */}
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {sc !== null ? (
                    <>
                      <div style={{ fontSize: "22px", fontWeight: 800, color: sColor, lineHeight: 1 }}>{sc}</div>
                      <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.25)", marginTop: "2px" }}>{scoreLabel(sc)}</div>
                    </>
                  ) : (
                    <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.2)" }}>—</div>
                  )}
                </div>
            </div>
          );
        })}
        </div>

        {/* ── How it works ── */}
        <div style={{
          display: "flex", gap: "12px", alignItems: "flex-start",
          padding: "16px 20px",
          background: "rgba(99,102,241,0.06)",
          border: "1px solid rgba(99,102,241,0.15)",
          borderRadius: "12px",
        }}>
          <div style={{ flexShrink: 0, marginTop: "1px", color: accent }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.7)", marginBottom: "4px" }}>
              How Analysis Works
            </div>
            <div style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.3)", lineHeight: 1.6 }}>
              SkillPulse fetches your repository via the GitHub API, filters Python files, parses code using AST (Abstract Syntax Tree), and performs static analysis. We extract metrics like cyclomatic complexity, code smells, and architecture patterns to generate objective skill scores — no code is stored permanently.
            </div>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
