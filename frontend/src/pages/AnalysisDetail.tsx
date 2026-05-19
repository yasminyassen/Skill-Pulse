

import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api from "../api/auth";
import DashboardLayout from "./DashboardLayout";

// ─── Types 

interface AnalysisResult {
  analysis_run_id: number;
  repo: string;
  branch: string;
  status: string;
  scores: {
    code_quality: number;
    maintainability: number;
    architecture: number;
    security_score: number;
    problem_solving: number;
    overall: number;
  };
  security_findings_count: number;
  ai_insights: Record<string, any>;
  completed_at: string | null;
}

// ─── Helpers 

const scoreColor = (s: number) => {
  if (s >= 80) return "#34d399";
  if (s >= 60) return "#fbbf24";
  if (s >= 40) return "#fb923c";
  return "#f87171";
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = scoreColor(value);
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
        <span style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)" }}>{label}</span>
        <span style={{ fontSize: "13px", fontWeight: 700, color }}>{Math.round(value)}</span>
      </div>
      <div style={{ height: "6px", borderRadius: "4px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: "4px",
          background: color,
          width: `${Math.min(100, value)}%`,
          transition: "width 0.8s cubic-bezier(.4,0,.2,1)",
        }} />
      </div>
    </div>
  );
}

// ─── Main 

export default function AnalysisDetail() {
  const { analysisId } = useParams<{ analysisId: string }>();
  const navigate = useNavigate();
  const role = localStorage.getItem("role") || "developer";

  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [polling, setPolling] = useState(false);

  const dashboardPath = `/dashboard/${role}/analysis`;

  // ── Fetch / poll 
  useEffect(() => {
    if (!analysisId) { setNotFound(true); setLoading(false); return; }

    const fetchResult = async () => {
      try {
        const res = await api.get(`/analysis/${analysisId}`);
        const data = res.data;

        if (data.status === "pending" && !data.analysis_run_id) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        setResult(data);
        setLoading(false);

        if (data.status === "running" || data.status === "pending") {
          setPolling(true);
        } else {
          setPolling(false);
        }
      } catch (err: any) {
        if (err.response?.status === 401) {
          localStorage.clear();
          window.location.href = "/login";
          return;
        }
        setNotFound(true);
        setLoading(false);
      }
    };

    fetchResult();
  }, [analysisId]);

  // ── Polling for running analyses
  useEffect(() => {
    if (!polling || !analysisId) return;

    const iv = setInterval(async () => {
      try {
        const res = await api.get(`/analysis/${analysisId}`);
        const data = res.data;
        setResult(data);
        if (data.status === "completed" || data.status === "failed") {
          setPolling(false);
          clearInterval(iv);
        }
      } catch {
        clearInterval(iv);
      }
    }, 3000);

    return () => clearInterval(iv);
  }, [polling, analysisId]);

  // ── Render helpers

  const repoName = result?.repo?.split("/").pop() ?? result?.repo ?? "Repository";

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }
        .sk {
          background: linear-gradient(90deg,rgba(255,255,255,0.04) 25%,rgba(255,255,255,0.08) 50%,rgba(255,255,255,0.04) 75%);
          background-size:400% 100%; animation: shimmer 1.5s ease-in-out infinite;
        }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.4;transform:scale(.8)} }
        .pulse { animation: pulse 1.4s ease-in-out infinite; }
      `}</style>

      <div style={{ padding: "32px 36px", maxWidth: "760px", fontFamily: "'DM Sans', sans-serif" }}>

        {/* Back button + breadcrumb */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "28px" }}>
          <button
            onClick={() => navigate(dashboardPath)}
            style={{ width: 36, height: 36, borderRadius: "10px", border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.4)", cursor: "pointer", flexShrink: 0 }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "22px", fontWeight: 800, color: "white", margin: 0, letterSpacing: "-0.4px" }}>
              {loading ? "Loading Analysis…" : notFound ? "Analysis Not Found" : repoName}
            </h1>
            {result && (
              <p style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)", margin: "2px 0 0" }}>
                {result.repo} · {result.branch}
              </p>
            )}
          </div>
        </div>

        {/* ── Loading skeletons ── */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div className="sk" style={{ height: "120px", borderRadius: "16px" }} />
            <div className="sk" style={{ height: "220px", borderRadius: "16px" }} />
            <div className="sk" style={{ height: "160px", borderRadius: "16px" }} />
          </div>
        )}

        {/* ── Not found / error state ── */}
        {!loading && notFound && (
          <div style={{
            textAlign: "center", padding: "64px 32px",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "20px",
          }}>
            <div style={{
              width: "64px", height: "64px", borderRadius: "18px",
              background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 800, color: "white", margin: "0 0 8px" }}>
              Analysis Not Found
            </h2>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: "0 0 28px", maxWidth: "360px", marginLeft: "auto", marginRight: "auto" }}>
              This analysis doesn't exist or you don't have permission to view it. It may have been disconnected or the link is incorrect.
            </p>
            <button
              onClick={() => navigate(dashboardPath)}
              style={{
                padding: "10px 24px", borderRadius: "10px", border: "none",
                background: "#6366f1", color: "white",
                fontSize: "13.5px", fontWeight: 700,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Back to Analyses
            </button>
          </div>
        )}

        {/* ── Running / pending state ── */}
        {!loading && !notFound && result && (result.status === "running" || result.status === "pending") && (
          <div style={{
            textAlign: "center", padding: "64px 32px",
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: "20px",
          }}>
            <div style={{
              width: "64px", height: "64px", borderRadius: "18px",
              background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="1.8" style={{ animation: "spin 2s linear infinite" }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 800, color: "white", margin: "0 0 8px" }}>
              Analysis in Progress
            </h2>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: "0 0 6px" }}>
              <strong style={{ color: "rgba(255,255,255,0.6)" }}>{repoName}</strong> is being analyzed right now.
            </p>
            <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)", margin: "0 0 28px" }}>
              This page will update automatically when it's done.
            </p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", color: "rgba(255,255,255,0.3)", fontSize: "12px" }}>
              <span className="pulse" style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#fbbf24", display: "inline-block" }} />
              Polling for updates…
            </div>
          </div>
        )}

        {/* ── Failed state ── */}
        {!loading && !notFound && result?.status === "failed" && (
          <div style={{
            textAlign: "center", padding: "64px 32px",
            background: "rgba(248,113,113,0.04)",
            border: "1px solid rgba(248,113,113,0.15)",
            borderRadius: "20px",
          }}>
            <div style={{
              width: "64px", height: "64px", borderRadius: "18px",
              background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              margin: "0 auto 20px",
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="1.8">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
            </div>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "20px", fontWeight: 800, color: "white", margin: "0 0 8px" }}>
              Analysis Failed
            </h2>
            <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: "0 0 28px" }}>
              Something went wrong during the analysis of <strong style={{ color: "rgba(255,255,255,0.6)" }}>{repoName}</strong>. Please try re-running it.
            </p>
            <button
              onClick={() => navigate(dashboardPath)}
              style={{
                padding: "10px 24px", borderRadius: "10px", border: "none",
                background: "#6366f1", color: "white",
                fontSize: "13.5px", fontWeight: 700,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}
            >
              Try Again
            </button>
          </div>
        )}

        {/* ── Completed result ── */}
        {!loading && !notFound && result?.status === "completed" && (
          <>
            {/* Overall score hero */}
            <div style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "20px", padding: "28px 32px",
              marginBottom: "16px",
              display: "flex", alignItems: "center", gap: "28px",
            }}>
              {/* Big ring */}
              <div style={{ flexShrink: 0, textAlign: "center" }}>
                <div style={{
                  width: "88px", height: "88px", borderRadius: "50%",
                  border: `4px solid ${scoreColor(result.scores.overall)}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexDirection: "column",
                }}>
                  <span style={{ fontSize: "28px", fontWeight: 800, color: scoreColor(result.scores.overall), lineHeight: 1 }}>
                    {Math.round(result.scores.overall)}
                  </span>
                  <span style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", marginTop: "2px" }}>Overall</span>
                </div>
              </div>

              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "17px", fontWeight: 800, color: "white", marginBottom: "4px" }}>
                  {result.repo}
                </div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", marginBottom: "12px" }}>
                  Branch: {result.branch} · {result.security_findings_count} security finding{result.security_findings_count !== 1 ? "s" : ""}
                  {result.completed_at && (
                    <> · Completed {new Date(result.completed_at).toLocaleDateString()}</>
                  )}
                </div>
                <button
                  onClick={() => navigate(`/dashboard/developer/analysis?highlight=${result.analysis_run_id}`)}
                  style={{
                    padding: "7px 16px", borderRadius: "8px",
                    border: "1px solid rgba(99,102,241,0.3)",
                    background: "rgba(99,102,241,0.08)",
                    color: "#818cf8", fontSize: "12px", fontWeight: 600,
                    cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                  }}
                >
                  View in Analysis Dashboard →
                </button>
              </div>
            </div>

            {/* Score breakdown */}
            <div style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: "20px", padding: "24px 28px",
              marginBottom: "16px",
            }}>
              <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "rgba(255,255,255,0.9)", margin: "0 0 20px", paddingBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                Score Breakdown
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <ScoreBar label="Code Quality"    value={result.scores.code_quality} />
                <ScoreBar label="Maintainability" value={result.scores.maintainability} />
                <ScoreBar label="Architecture"    value={result.scores.architecture} />
                <ScoreBar label="Problem Solving" value={result.scores.problem_solving} />
                <ScoreBar label="Security"        value={result.scores.security_score} />
              </div>
            </div>

            {/* AI insights summary */}
            {result.ai_insights && Object.keys(result.ai_insights).length > 0 && (
              <div style={{
                background: "rgba(99,102,241,0.05)",
                border: "1px solid rgba(99,102,241,0.15)",
                borderRadius: "20px", padding: "24px 28px",
              }}>
                <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "15px", fontWeight: 800, color: "rgba(255,255,255,0.9)", margin: "0 0 14px" }}>
                  AI Insights
                </h2>
                {result.ai_insights.summary && (
                  <p style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.5)", lineHeight: 1.7, margin: 0 }}>
                    {result.ai_insights.summary}
                  </p>
                )}
                {!result.ai_insights.summary && (
                  <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)", margin: 0 }}>
                    Detailed insights are available in the full analysis view.
                  </p>
                )}
              </div>
            )}
          </>
        )}

      </div>
    </DashboardLayout>
  );
}