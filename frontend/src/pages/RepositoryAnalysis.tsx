import { useState, useEffect, useRef } from "react";
import api from "../api/auth";
import DashboardLayout from "./DashboardLayout";

// --- Types ---
interface Analysis {
  analysis_id: number;
  repo_id: number;
  repo_name: string;
  branch: string;
  status: string;
  triggered_at: string;
  score: number | null;
}

interface TechnicalTask {
  id: number;
  description: string;
  type: string;
  status: string;
  ac_ids: number[];
}

interface UserStory {
  id: number;
  story_code: string;
  title: string;
  description: string;
  role: string;
  feature: string;
  benefit: string;
  acceptance_criteria: { id: number; text: string }[];
  technical_tasks: TechnicalTask[];
}
interface EditState {
  isOpen: boolean;
  type: 'story' | 'story_desc' | 'ac' | 'task'; 
  storyId: number;
  itemId?: number;
  text: string;
  title: string;
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const role = localStorage.getItem("role") || "developer";

  const [pendingAutoRun, setPendingAutoRun] = useState<{ url: string; branch: string } | null>(null);

  // --- PRD Extraction States ---
  const [uploadingPrd, setUploadingPrd] = useState(false);
  const [prdDocId, setPrdDocId] = useState<number | null>(null);
  const [prdStories, setPrdStories] = useState<UserStory[]>([]);
  const [showPrdModal, setShowPrdModal] = useState(false);
  const [selectedRepoForPrd, setSelectedRepoForPrd] = useState<number | "">("");

  // --- Modal States ---
  const [editModal, setEditModal] = useState<EditState>({ isOpen: false, type: 'story', storyId: 0, text: "", title: "" });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const [toast, setToast] = useState<{show: boolean, msg: string, type: 'success' | 'error'}>({show: false, msg: '', type: 'success'});

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ show: true, msg, type });
    setTimeout(() => setToast({ show: false, msg: '', type: 'success' }), 4000);
  };

  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [mergeModal, setMergeModal] = useState({ isOpen: false, storyId: 0, text: "" });

  const [githubAuthUrl, setGithubAuthUrl] = useState<string | null>(null);
  const [failedMsg, setFailedMsg] = useState<string | null>(null);
  const [cachedMsg, setCachedMsg] = useState<{ runId: number; repoName: string; scope?: string; cachedForCurrentUser?: boolean; } | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github_connected") === "true") {
      const saved = localStorage.getItem("pending_repo");
      if (saved) {
        const { repoUrl: savedUrl, branch: savedBranch } = JSON.parse(saved);
        setRepoUrl(savedUrl);
        setBranch(savedBranch);
        localStorage.removeItem("pending_repo");
        window.history.replaceState({}, document.title, window.location.pathname);
        setPendingAutoRun({ url: savedUrl, branch: savedBranch });
      }
    }
    fetchHistory();
  }, []);

  useEffect(() => {
    if (pendingAutoRun) {
      startAnalysis(pendingAutoRun.url, pendingAutoRun.branch);
      setPendingAutoRun(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoRun]);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get("/analysis/history");
      setAnalyses(res.data.history);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = err as any;
      if (error.response?.status === 401) {
        localStorage.clear();
        window.location.href = "/login";
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  /* ── PRD Handlers ── */
  const handlePrdUpload = async (f: File) => {
    if (selectedRepoForPrd === "") {
      alert("Please select a repository from the dropdown before uploading the PRD.");
      return;
    }
    setFile(f);
    setUploadingPrd(true);
    try {
      const formData = new FormData();
      formData.append("file", f);
      formData.append("repository_id", selectedRepoForPrd.toString());
      
      const uploadRes = await api.post("/requirements/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      
      const docId = uploadRes.data.document_id;
      setPrdDocId(docId);

      const storiesRes = await api.get(`/requirements/${docId}/stories`);
      setPrdStories(storiesRes.data);
      setShowPrdModal(true);
    } catch (err) {
      console.error(err);
      alert("Failed to upload and extract PRD.");
      setFile(null);
    } finally {
      setUploadingPrd(false);
    }
  };

  // --- Custom Edit Logic ---
  const openEditModal = (type: 'story' | 'ac' |'story_desc'| 'task', storyId: number, text: string, title: string, itemId?: number) => {
    setEditModal({ isOpen: true, type, storyId, itemId, text, title });
  };
  const closeEditModal = () => setEditModal({ isOpen: false, type: 'story', storyId: 0, text: "", title: "" });

const handleSaveEdit = async () => {
    if (!editModal.text.trim()) return;
    setIsSavingEdit(true);

    try {
      if (editModal.type === 'story') {
        await api.patch(`/requirements/stories/${editModal.storyId}`, { title: editModal.text });
        setPrdStories(prev => prev.map(s => s.id === editModal.storyId ? { ...s, title: editModal.text } : s));
      
      } else if (editModal.type === 'story_desc') {
        await api.patch(`/requirements/stories/${editModal.storyId}`, { description: editModal.text });
        setPrdStories(prev => prev.map(s => s.id === editModal.storyId ? { ...s, description: editModal.text } : s));

      } else if (editModal.type === 'ac' && editModal.itemId !== undefined) {
        const story = prdStories.find(s => s.id === editModal.storyId);
        if (story) {
          const updatedACs = story.acceptance_criteria.map(ac => ac.id === editModal.itemId ? { ...ac, text: editModal.text } : ac);
          await api.patch(`/requirements/stories/${editModal.storyId}`, { acceptance_criteria: updatedACs });
          setPrdStories(prev => prev.map(s => s.id === editModal.storyId ? { ...s, acceptance_criteria: updatedACs } : s));
        }

      } else if (editModal.type === 'task' && editModal.itemId !== undefined) {
        await api.patch(`/requirements/tasks/${editModal.itemId}`, { description: editModal.text });
        setPrdStories(prev => prev.map(story => ({
          ...story,
          technical_tasks: story.technical_tasks.map(t => t.id === editModal.itemId ? { ...t, description: editModal.text } : t)
        })));
      }
      closeEditModal();
      showToast("Changes saved successfully!");
    } catch (err) {
      console.error(err);
      showToast("Failed to save changes.", "error");
    } finally {
      setIsSavingEdit(false);
    }
  };
  
  const confirmPRD = async () => {
    if (!prdDocId) return;
    try {
      await api.post(`/requirements/${prdDocId}/confirm`);
      setShowPrdModal(false);
      setFile(null);
      setSelectedRepoForPrd(""); 
      showToast("Requirements confirmed successfully! Ready for assignment.", "success");
    } catch (err: any) {
      showToast(`Failed to confirm: ${err.response?.data?.detail || err.message}`, "error");
    }
  };

  // --- Merge Tasks Logic ---
  const handleOpenMergeModal = (storyId: number) => {
    const story = prdStories.find(s => s.id === storyId);
    if (!story) return;
    const tasksToMerge = story.technical_tasks.filter(t => selectedTaskIds.includes(t.id));
    const combinedText = tasksToMerge.map(t => `- [${t.type.toUpperCase()}] ${t.description}`).join("\n\n");
    setMergeModal({ isOpen: true, storyId, text: combinedText });
  };

  const handleConfirmMerge = async () => {
    setIsSavingEdit(true);
    try {
      const story = prdStories.find(s => s.id === mergeModal.storyId);
      if (!story) return;
      
      const storyTaskIds = story.technical_tasks.map(t => t.id);
      const idsToMerge = selectedTaskIds.filter(id => storyTaskIds.includes(id));

      const res = await api.post(`/requirements/stories/${mergeModal.storyId}/tasks/merge`, {
        task_ids: idsToMerge,
        new_description: mergeModal.text
      });
      const newTask = res.data;

      setPrdStories(prev => prev.map(s => {
        if (s.id !== mergeModal.storyId) return s;
        const remainingTasks = s.technical_tasks.filter(t => !idsToMerge.includes(t.id));
        return { ...s, technical_tasks: [...remainingTasks, newTask] };
      }));

      setSelectedTaskIds(prev => prev.filter(id => !idsToMerge.includes(id)));
      setMergeModal({ isOpen: false, storyId: 0, text: "" });
    } catch (err) {
      console.error(err);
      alert("Failed to merge tasks.");
    } finally {
      setIsSavingEdit(false);
    }
  };

  /* ── start analysis ── */
  const startAnalysis = async (url: string, br: string) => {
    if (!url) { setUrlError("Please enter a GitHub repository URL"); return; }
    if (!/^https:\/\/github\.com\/.+/.test(url)) { setUrlError("URL must start with https://github.com/…"); return; }

    setUrlError("");
    setGithubAuthUrl(null);
    setFailedMsg(null);
    setCachedMsg(null);
    setLoading(true);
    try {
      const res = await api.post("/analysis/run", { repo_url: url, branch: br });
      if (res.data.cached) {
        setLoading(false);
        const repoName = url.replace("https://github.com/", "").split("/").pop() || url;
        setCachedMsg({
          runId: res.data.analysis_run_id,
          repoName,
          scope: res.data.cached_scope,
          cachedForCurrentUser: res.data.cached_for_current_user ?? true,
        });
        fetchHistory();
        return;
      }
      setRunId(res.data.analysis_run_id);
    } catch (err: unknown) {
      setLoading(false);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const error = err as any;
      const status = error.response?.status;
      const detail = error.response?.data?.detail;
      const needsAuth = (typeof detail === "object" && detail?.requires_github_auth) || error.response?.data?.requires_github_auth;

      if (status === 403 && (detail?.recruiter_private_repo || role === "recruiter")) { setUrlError("Private repositories are not supported for Recruiter accounts."); return; }
      if (needsAuth) {
        const authUrl = (typeof detail === "object" ? detail?.auth_url : null) ?? error.response?.data?.auth_url;
        localStorage.setItem("pending_repo", JSON.stringify({ repoUrl: url, branch: br }));
        setGithubAuthUrl(authUrl);
        return;
      }
      if (status === 403 && detail?.no_developer_contributions) { setUrlError(detail.message || "SkillPulse analyzes your own GitHub contributions. No commits found."); return; }
      if (status === 400 && detail?.no_python_contributions) { setUrlError(detail.message || "No Python files found to analyze."); return; }
      if (status === 404 && detail?.branch_not_found) { setUrlError("Repository found, but this branch does not exist."); return; }
      if (status === 404) { setUrlError("Repository or branch not found. Check the URL and branch name."); return; }
      if (status === 400) { setUrlError("Invalid GitHub repository URL."); return; }
      if (status === 429) { setUrlError("Too many requests. Please wait a moment before trying again."); return; }
      if (status === 503) { setUrlError("GitHub API rate limit reached. Please wait a moment and try again."); return; }
      setUrlError("Something went wrong. Please try again.");
    }
  };

  const disconnectAnalysis = async (analysisId: number) => {
    setOpenMenuId(null);
    try {
      await api.delete(`/repos/disconnect-analysis/${analysisId}`);
      await fetchHistory();
    } catch (err) {
      console.error(err);
      setFailedMsg("Could not disconnect this analysis. Please try again.");
    }
  };

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
          if (reason === "rate_limit") setFailedMsg("__rate_limit__");
          else if (reason === "not_found") setFailedMsg("Repository or branch not found.");
          else setFailedMsg("Analysis failed. Check the URL and branch, then try again.");
          fetchHistory();
        }
      } catch { clearInterval(iv); setLoading(false); }
    }, 3000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  /* ── drag-drop ── */
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) handlePrdUpload(f);
  };

  return (
    <DashboardLayout>
        {/* ── Toast Notification ── */}
        {toast.show && (
          <div style={{
            position: "fixed",
            bottom: "28px",
            right: "28px",
            zIndex: 999,
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "14px 20px",
            borderRadius: "12px",
            background: toast.type === "success" ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)",
            border: `1px solid ${toast.type === "success" ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
            backdropFilter: "blur(12px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
            animation: "slideUp 0.3s ease-out",
            maxWidth: "360px",
          }}>
            {toast.type === "success" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            )}
            <span style={{
              fontSize: "13.5px",
              fontWeight: 500,
              color: toast.type === "success" ? "#34d399" : "#f87171",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              {toast.msg}
            </span>
          </div>
        )}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        
        .sp-input { width: 100%; padding: 11px 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: white; font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; transition: border-color 0.2s, background 0.2s; box-sizing: border-box; }
        .sp-input::placeholder { color: rgba(255,255,255,0.25); }
        .sp-input:focus { border-color: ${accent}60; background: rgba(255,255,255,0.06); }
        .sp-input.error { border-color: rgba(248,113,113,0.5); }
        .sp-select { padding: 11px 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; color: white; font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; cursor: pointer; transition: border-color 0.2s; }
        .sp-select:focus { border-color: ${accent}60; }
        .sp-select option { background: #1a1a2e; }
        .sp-btn-primary { display: inline-flex; align-items: center; gap: 8px; padding: 11px 24px; background: linear-gradient(135deg, ${accent}, #ec4899); border: none; border-radius: 10px; color: white; font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 16px ${accent}30; }
        .sp-btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 8px 24px ${accent}40; }
        .sp-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .sp-btn-ghost { display: inline-flex; align-items: center; gap: 7px; padding: 9px 16px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 9px; color: rgba(255,255,255,0.6); font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .sp-btn-ghost:hover { background: rgba(255,255,255,0.08); color: white; border-color: rgba(255,255,255,0.2); }
        .sp-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }
        .sp-card { background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.07); border-radius: 16px; padding: 28px; }
        .analysis-row { display: flex; align-items: center; gap: 16px; padding: 16px 0; border-bottom: 1px solid rgba(255,255,255,0.04); transition: background 0.15s; border-radius: 8px; }
        .analysis-row:last-child { border-bottom: none; }
        .analysis-row:hover { background: rgba(255,255,255,0.02); }
        .skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%); background-size: 400% 100%; animation: shimmer 1.5s ease-in-out infinite; border-radius: 8px; }
        @keyframes shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #fbbf24; animation: pulse 1.4s ease-in-out infinite; }
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        .drop-zone { border: 1.5px dashed rgba(255,255,255,0.15); border-radius: 12px; padding: 32px 20px; text-align: center; cursor: pointer; transition: all 0.2s; }
        .drop-zone:hover, .drop-zone.active { border-color: ${accent}60; background: ${accent}08; }
        .sp-label { font-size: 12px; font-weight: 600; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 0.8px; margin-bottom: 7px; display: block; }
        
        /* PRD Modal Styles */
        .prd-modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.75); backdrop-filter: blur(8px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; animation: fadeIn 0.2s ease-out; }
        .prd-modal { background: #13131e; border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; width: 100%; max-width: 900px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 24px 48px rgba(0,0,0,0.5); overflow: hidden; animation: slideUp 0.3s ease-out; }
        .prd-modal-header { padding: 24px 30px; border-bottom: 1px solid rgba(255,255,255,0.06); display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); }
        .prd-modal-body { padding: 30px; overflow-y: auto; flex: 1; }
        .prd-modal-footer { padding: 20px 30px; border-top: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.02); display: flex; justify-content: flex-end; gap: 12px; }
        .story-card { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
        .task-badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .task-badge.backend { background: rgba(139,92,246,0.15); color: #a78bfa; }
        .task-badge.frontend { background: rgba(59,130,246,0.15); color: #60a5fa; }
        .task-badge.qa { background: rgba(245,158,11,0.15); color: #fbbf24; }
        
        /* Custom Edit Modal */
        .edit-modal { background: #1a1a2e; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; width: 100%; max-width: 500px; padding: 24px; box-shadow: 0 24px 48px rgba(0,0,0,0.6); animation: zoomIn 0.2s ease-out; }
        .edit-textarea { width: 100%; min-height: 100px; padding: 12px 14px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; color: white; font-family: 'DM Sans', sans-serif; font-size: 14px; outline: none; transition: border-color 0.2s; resize: vertical; }
        .edit-textarea:focus { border-color: ${accent}80; background: rgba(0,0,0,0.3); }

        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes zoomIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
      `}</style>

      {/* --- Custom Edit Modal --- */}
      {editModal.isOpen && (
        <div className="prd-modal-overlay" style={{ zIndex: 200 }}>
          <div className="edit-modal">
            <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", color: "white", fontFamily: "'Syne', sans-serif" }}>
              {editModal.title}
            </h3>
            <textarea 
              className="edit-textarea"
              value={editModal.text}
              onChange={(e) => setEditModal({ ...editModal, text: e.target.value })}
              placeholder="Type your changes here..."
              autoFocus
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "20px" }}>
              <button className="sp-btn-ghost" onClick={closeEditModal} disabled={isSavingEdit}>Cancel</button>
              <button className="sp-btn-primary" onClick={handleSaveEdit} disabled={isSavingEdit}>
                {isSavingEdit ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- Merge Tasks Modal --- */}
      {mergeModal.isOpen && (
        <div className="prd-modal-overlay" style={{ zIndex: 200 }}>
          <div className="edit-modal">
            <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", color: "white", fontFamily: "'Syne', sans-serif" }}>
              Merge Technical Tasks
            </h3>
            <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.5)", marginBottom: "12px" }}>
              Edit the combined description. The tasks will be merged into a single task covering all their Acceptance Criteria.
            </div>
            <textarea 
              className="edit-textarea"
              value={mergeModal.text}
              onChange={(e) => setMergeModal({ ...mergeModal, text: e.target.value })}
              style={{ minHeight: "150px" }}
              autoFocus
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "20px" }}>
              <button className="sp-btn-ghost" onClick={() => setMergeModal({ isOpen: false, storyId: 0, text: "" })} disabled={isSavingEdit}>Cancel</button>
              <button className="sp-btn-primary" onClick={handleConfirmMerge} disabled={isSavingEdit}>
                {isSavingEdit ? "Merging..." : "Confirm Merge"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- PRD Review Modal --- */}
      {showPrdModal && (
        <div className="prd-modal-overlay">
          <div className="prd-modal">
            <div className="prd-modal-header">
              <div>
                <h2 style={{ margin: 0, fontSize: "20px", color: "white", fontFamily: "'Syne', sans-serif" }}>Review Extracted Requirements</h2>
                <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
                  AI has extracted {prdStories.length} user stories. Review, edit if needed, and confirm to proceed to assignment.
                </div>
              </div>
              <button onClick={() => setShowPrdModal(false)} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: "20px" }}>✕</button>
            </div>
            
            <div className="prd-modal-body">
              {prdStories.map((story) => {
                const storyTasks = story.technical_tasks;
                const selectedInStory = storyTasks.filter(t => selectedTaskIds.includes(t.id));

                return (
                <div key={story.id} className="story-card">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ color: accent, fontWeight: 700, fontSize: "14px" }}>{story.story_code}</span>
                      <span style={{ color: "white", fontSize: "16px", fontWeight: 600 }}>{story.title}</span>
                      <button 
                        onClick={() => openEditModal('story', story.id, story.title, "Edit Story Title")}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)" }}
                        title="Edit Story Title"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                      </button>
                    </div>
                  </div>
                  
                  <div style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.7)", marginBottom: "16px", background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px" }}>
                  {/* Story Description with Edit Button */}
                  <div style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.7)", marginBottom: "16px", background: "rgba(0,0,0,0.2)", padding: "12px", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ flex: 1, lineHeight: 1.6 }}>
                      {story.description}
                    </div>
                    <button 
                      onClick={() => openEditModal('story_desc', story.id, story.description, "Edit Story Description")}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", marginLeft: "12px", flexShrink: 0, marginTop: "2px" }}
                      title="Edit Description"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    </button>
                  </div>                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>
                    {/* Acceptance Criteria */}
                    <div>
                      <div className="sp-label" style={{ color: "white" }}>Acceptance Criteria</div>
                      <ul style={{ paddingLeft: "0", margin: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
                        {story.acceptance_criteria.map(ac => (
                          <li key={ac.id} style={{ display: "flex", alignItems: "flex-start", gap: "8px", color: "rgba(255,255,255,0.6)", fontSize: "13px", lineHeight: 1.6, background: "rgba(255,255,255,0.015)", padding: "6px 8px", borderRadius: "6px" }}>
                            <span style={{ color: accent, marginTop: "2px" }}>•</span>
                            <span style={{ flex: 1 }}>{ac.text}</span>
                            <button 
                              onClick={() => openEditModal('ac', story.id, ac.text, "Edit Acceptance Criteria", ac.id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)", marginTop: "2px", flexShrink: 0 }}
                              title="Edit AC"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                    
                    {/* Technical Tasks */}
                    <div>
                      <div className="sp-label" style={{ color: "white", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>Extracted Technical Tasks</span>
                        {selectedInStory.length >= 2 && (
                          <button 
                            onClick={() => handleOpenMergeModal(story.id)} 
                            className="sp-btn-primary" 
                            style={{ padding: "4px 10px", fontSize: "11px", height: "auto" }}
                          >
                            Merge {selectedInStory.length} Tasks
                          </button>
                        )}
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {story.technical_tasks.map(task => (
                          <div key={task.id} style={{ background: "rgba(255,255,255,0.03)", padding: "10px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                <input 
                                  type="checkbox" 
                                  checked={selectedTaskIds.includes(task.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) setSelectedTaskIds([...selectedTaskIds, task.id]);
                                    else setSelectedTaskIds(selectedTaskIds.filter(id => id !== task.id));
                                  }}
                                  style={{ width: "14px", height: "14px", cursor: "pointer", accentColor: accent }}
                                  title="Select to merge"
                                />
                                <span className={`task-badge ${task.type}`}>{task.type}</span>
                              </div>
                              <button 
                                onClick={() => openEditModal('task', story.id, task.description, "Edit Technical Task", task.id)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.3)" }}
                                title="Edit Task"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                              </button>
                            </div>
                            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.8)", lineHeight: 1.4 }}>
                              {task.description}
                            </div>
                            {task.ac_ids.length > 0 && (
                              <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)", marginTop: "6px" }}>
                                Covers AC: {task.ac_ids.map(id => `#${id}`).join(", ")}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )})}
            </div>
            
            <div className="prd-modal-footer">
              <button className="sp-btn-ghost" onClick={() => setShowPrdModal(false)}>Cancel</button>
              <button className="sp-btn-primary" onClick={confirmPRD}>Confirm & Publish</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: "32px 36px", maxWidth: "920px", fontFamily: "'DM Sans', sans-serif" }}>
        {/* Page header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "26px", fontWeight: 800, color: "white", letterSpacing: "-0.5px", margin: "0 0 6px" }}>
            Repository Analysis
          </h1>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
            Analyze GitHub repositories and convert source code into measurable skill scores
          </p>
        </div>

        {/* ── Start New Analysis card ── */}
        <div className="sp-card" style={{ marginBottom: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "24px" }}>
            <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: `${accent}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
            </div>
            <div>
              <div style={{ fontSize: "15px", fontWeight: 700, color: "white" }}>1. Analyze Repository Code</div>
              <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.3)" }}>Enter a public or private GitHub repository to analyze developers skills.</div>
            </div>
          </div>

          {/* GitHub URL */}
          <div style={{ marginBottom: "16px" }}>
            <label className="sp-label">GitHub Repository URL</label>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: "13px", top: "50%", transform: "translateY(-50%)", color: "rgba(255,255,255,0.25)" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </div>
              <input type="text" className={`sp-input${urlError ? " error" : ""}`} style={{ paddingLeft: "38px" }} placeholder="https://github.com/owner/repository" value={repoUrl} onChange={e => { setRepoUrl(e.target.value); setUrlError(""); }} />
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
            <div style={{ marginBottom: "16px", padding: "16px 18px", background: "rgba(251,191,36,0.07)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: "12px", display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{ width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0, background: "rgba(251,191,36,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: "#fbbf24" }}>
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "13.5px", fontWeight: 600, color: "#fbbf24", marginBottom: "3px" }}>GitHub Connection Required</div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
                  Developer analysis is based on your own GitHub contributions. Connect GitHub so SkillPulse can verify access.
                </div>
              </div>
              <button
                onClick={() => { window.location.href = githubAuthUrl; }}
                style={{ flexShrink: 0, padding: "9px 18px", background: "linear-gradient(135deg, #f59e0b, #fbbf24)", border: "none", borderRadius: "9px", color: "#0a0a0f", fontSize: "13px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap", boxShadow: "0 4px 14px rgba(251,191,36,0.3)", transition: "all 0.2s" }}
              >Connect GitHub →</button>
            </div>
          )}

          {/* Submit Repo Analysis */}
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <button className="sp-btn-primary" disabled={loading} onClick={() => startAnalysis(repoUrl, branch)}>
              {loading ? (
                <><div className="pulse-dot" />Analyzing Code…</>
              ) : (
                <><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                Analyze Repository Only</>
              )}
            </button>
          </div>
        </div>

        {/* Manager only: Business Requirements Card */}
        {role === "manager" && (
          <div className="sp-card" style={{ marginBottom: "24px", background: "rgba(139,92,246,0.04)", border: `1px solid ${accent}30` }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "20px" }}>
              <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: `${accent}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                </svg>
              </div>
              <div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "white" }}>2. Upload Business Requirements (PRD)</div>
                <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>Map user stories and tasks to a previously analyzed repository.</div>
              </div>
            </div>

            
            <div style={{ marginBottom: "20px" }}>
              <label className="sp-label">Select Target Repository</label>
              <select 
                className="sp-select" 
                value={selectedRepoForPrd} 
                onChange={(e) => setSelectedRepoForPrd(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">-- Choose an analyzed repository --</option>
                {analyses.map(a => (
                  <option key={a.repo_id} value={a.repo_id}>
                    {a.repo_name} ({a.branch})
                  </option>
                ))}
              </select>
            </div>
            
            <div
              className={`drop-zone${dragOver ? " active" : ""}`}
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => {
                if (selectedRepoForPrd === "") {
                  alert("Please select a repository from the dropdown above first.");
                } else {
                  fileInputRef.current?.click();
                }
              }}
            >
              {uploadingPrd ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
                  <div className="pulse-dot" style={{ width: "12px", height: "12px", background: accent }}></div>
                  <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)" }}>Extracting AI Requirements...</div>
                </div>
              ) : file ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
                  <div style={{ width: "34px", height: "34px", borderRadius: "8px", background: `${accent}20`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </div>
                  <div style={{ textAlign: "left" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "white" }}>{file.name}</div>
                    <div style={{ fontSize: "11px", color: "rgba(255,255,255,0.3)" }}>{(file.size / 1024 / 1024).toFixed(2)} MB</div>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px" }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                  </div>
                  <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.45)", marginBottom: "4px" }}>
                    Drop your PRD file here or <span style={{ color: accent }}>browse</span>
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.xlsx,.xls,.md,.txt"
              style={{ display: "none" }}
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) handlePrdUpload(f);
              }}
            />
          </div>
        )}

        {/* ── Recent Analyses ── */}
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
              <div key={a.analysis_id} className="analysis-row" style={{ padding: "14px 8px", position: "relative" }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "12px", flexShrink: 0, background: "rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/>
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, color: "white", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.repo_name}
                    </span>
                    <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 7px", borderRadius: "20px", background: "rgba(99,102,241,0.15)", color: "#818cf8", flexShrink: 0 }}>Python</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.3)" }}>{a.branch} · {timeAgo(a.triggered_at)}</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", fontSize: "11px", fontWeight: 500, padding: "2px 8px", borderRadius: "20px", background: st.bg, color: st.color }}>
                      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: st.dot, animation: a.status === "running" ? "pulse 1.4s ease-in-out infinite" : "none" }} />
                      {st.label}
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  {sc !== null ? (
                    <>
                      <div style={{ fontSize: "22px", fontWeight: 800, color: sColor, lineHeight: 1 }}>{sc}</div>
                      <div style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.25)", marginTop: "2px" }}>{scoreLabel(sc)}</div>
                    </>
                  ) : <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.2)" }}>—</div>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardLayout>
  );
}