import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronDown, ChevronRight, Trash2, User, Calendar, AlertTriangle } from "lucide-react";
import DashboardLayout from "../DashboardLayout";
import apiAxios from "../../api/auth";

const API = "http://localhost:8000";
const tok = () => localStorage.getItem("access_token") || "";
const hdrs = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${tok()}` });

// ── Role-based accent ──────────────────
const role = localStorage.getItem("role") || "developer";
const accent = role === "manager" ? "#8b5cf6" : role === "recruiter" ? "#a855f7" : "#6366f1";

const TYPE_CFG = {
  backend:  { label: "Backend",  color: "#a78bfa", bg: "rgba(139,92,246,0.15)" },
  frontend: { label: "Frontend", color: "#60a5fa", bg: "rgba(59,130,246,0.15)"  },
  qa:       { label: "QA",       color: "#fbbf24", bg: "rgba(245,158,11,0.15)"  },
};

const PRIORITY_CFG = {
  critical: { label: "Critical", color: "#f87171", bg: "rgba(248,113,113,0.12)", bar: "#f87171" },
  high:     { label: "High",     color: "#fb923c", bg: "rgba(251,146,60,0.12)",  bar: "#fb923c" },
  medium:   { label: "Medium",   color: "#fbbf24", bg: "rgba(251,191,36,0.12)", bar: "#fbbf24" },
  low:      { label: "Low",      color: "#4ade80", bg: "rgba(74,222,128,0.12)", bar: "#4ade80" },
};

const STATUS_CFG = {
  todo:        { label: "To Do",       color: "rgba(255,255,255,0.35)" },
  in_progress: { label: "In Progress", color: "#fbbf24" },
  done:        { label: "Done",        color: "#4ade80" },
};

const api = async (path: string, opts = {}) => {
  const r = await fetch(`${API}${path}`, { headers: hdrs(), ...opts });
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
};

// ─── Avatar ───────────────────────────────────────
const Avatar = ({ name = "?", size = 24 }: { name?: string, size?: number }) => {
  const initials = name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
  const hue = (name.charCodeAt(0) * 37 + name.charCodeAt(1) * 17) % 360;
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `hsl(${hue},50%,40%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.38, fontWeight: 700, color: "#fff", flexShrink: 0,
    }}>{initials}</div>
  );
};

// ─── AssigneeDropdown ─────────────────────────────
const AssigneeDropdown = ({ task, contributors, onAssign }: any) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  
  const assignee = contributors.find((c: any) => c.id === task.assigned_to);

  useEffect(() => {
    const fn = (e: any) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button className="rq-btn-ghost" onClick={() => setOpen(o => !o)} style={{
        padding: "5px 10px", fontSize: 12,
        color: assignee ? "#c4b5fd" : undefined,
        borderColor: assignee ? `${accent}50` : undefined,
        background: assignee ? `${accent}10` : undefined,
        gap: 6,
      }}>
        {assignee ? <Avatar name={assignee.full_name || assignee.username} size={16} /> : <User size={12} />}
        <span>{assignee ? (assignee.full_name || assignee.username) : "Assign"}</span>
        <ChevronDown size={10} style={{ opacity: 0.5 }} />
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0, zIndex: 9999, /* High z-index to stay on top */
          background: "#181826", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10, padding: 6, minWidth: 190,
          boxShadow: "0 12px 32px rgba(0,0,0,0.8)", /* Stronger shadow */
        }}>
          {assignee && (
            <button onClick={() => { onAssign(task.id, null); setOpen(false); }}
              className="rq-btn-ghost" style={{
                width: "100%", justifyContent: "flex-start",
                color: "rgba(248,113,113,0.8)", border: "none",
                background: "transparent", fontSize: 12, marginBottom: 2,
              }}>Unassign</button>
          )}
          {contributors.filter((c: any) => c.id !== task.assigned_to).map((c: any) => (
            <button key={c.id} onClick={() => { onAssign(task.id, c.id); setOpen(false); }}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 8,
                padding: "7px 10px", borderRadius: 7, background: "transparent",
                border: "none", color: "rgba(255,255,255,0.8)", cursor: "pointer",
                fontSize: 12, textAlign: "left", fontFamily: "'DM Sans', sans-serif",
                transition: "background 0.12s",
              }}
              onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.06)"}
              onMouseLeave={e => e.currentTarget.style.background = "transparent"}
            >
              <Avatar name={c.full_name || c.username} size={20} />
              <div>
                <div>{c.full_name || c.username}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>@{c.username}</div>
              </div>
            </button>
          ))}
          {contributors.length === 0 && (
            <div style={{ padding: "8px 12px", fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
              No developers found.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── TaskRow ──────────────────────────────────────
const TaskRow = ({ task, contributors, onUpdate, onDelete }: any) => {
  const [localDate, setLocalDate] = useState(task.due_date ? task.due_date.split("T")[0] : "");
  const typeCfg = TYPE_CFG[task.type as keyof typeof TYPE_CFG] || TYPE_CFG.backend;
  const statusCfg = STATUS_CFG[task.status as keyof typeof STATUS_CFG] || STATUS_CFG.todo;

  return (
    <div className="rq-analysis-row" style={{ padding: "10px 14px", gap: 10, alignItems: "flex-start" }}>
      <span className="rq-task-badge" style={{ background: typeCfg.bg, color: typeCfg.color, marginTop: 2, flexShrink: 0 }}>
        {typeCfg.label}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.5 }}>
          {task.description}
        </div>
        {task.ac_ids?.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {task.ac_ids.map((id: number) => (
              <span key={id} style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 4,
                background: `${accent}18`, color: "#a78bfa",
              }}>AC #{id}</span>
            ))}
          </div>
        )}
      </div>

      <AssigneeDropdown task={task} contributors={contributors} onAssign={(id: number, uid: number | null) => onUpdate(id, { assigned_to: uid })} />

      <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
        <Calendar size={11} style={{ color: "rgba(255,255,255,0.2)" }} />
        <input type="date" value={localDate}
          onChange={e => setLocalDate(e.target.value)}
          onBlur={() => onUpdate(task.id, { due_date: localDate || null })}
          className="rq-input"
          style={{ width: 120, padding: "4px 8px", fontSize: 11, colorScheme: "dark" }}
        />
      </div>

      <select value={task.status || "todo"}
        onChange={e => onUpdate(task.id, { status: e.target.value })}
        className="rq-select"
        style={{ fontSize: 11, padding: "4px 8px", color: statusCfg.color, width: "auto" }}>
        {Object.entries(STATUS_CFG).map(([k, v]) => (
          <option key={k} value={k}>{v.label}</option>
        ))}
      </select>

      <button onClick={() => onDelete(task)} style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: "transparent", border: "1px solid rgba(255,255,255,0.06)",
        color: "rgba(248,113,113,0.45)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "all 0.15s",
      }}
        onMouseEnter={e => { e.currentTarget.style.background = "rgba(248,113,113,0.1)"; e.currentTarget.style.color = "#f87171"; }}
        onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "rgba(248,113,113,0.45)"; }}
      ><Trash2 size={12} /></button>
    </div>
  );
};

// ─── StoryCard ────────────────────────────────────
const StoryCard = ({ story, contributors, onTaskUpdate, onTaskDelete }: any) => {
  const [expanded, setExpanded] = useState(false);
  const [showAC, setShowAC] = useState(false);
  const p = PRIORITY_CFG[story.priority as keyof typeof PRIORITY_CFG] || PRIORITY_CFG.medium;

  const tasksByType = (story.technical_tasks || []).reduce((acc: any, t: any) => {
    acc[t.type] = (acc[t.type] || 0) + 1; return acc;
  }, {});

  return (
    <div className="rq-dim-card" style={{
      padding: 0, 
      borderLeft: `3px solid ${p.bar}`,
      overflow: expanded ? "visible" : "hidden", 
      marginBottom: 10,
    }}>
      <div onClick={() => setExpanded(e => !e)} style={{
        padding: "14px 20px", cursor: "pointer",
        display: "flex", alignItems: "center", gap: 12,
        transition: "background 0.15s",
        borderTopRightRadius: "16px",
        borderBottomRightRadius: expanded ? "0px" : "16px",
      }}
        onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0 }}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: accent, letterSpacing: "0.5px", flexShrink: 0 }}>
          {story.story_code}
        </span>
        <span style={{
          fontSize: 10, padding: "2px 8px", borderRadius: 5,
          background: p.bg, color: p.color, fontWeight: 700,
          textTransform: "uppercase", letterSpacing: "0.5px", flexShrink: 0,
        }}>{p.label}</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.88)", flex: 1 }}>
          {story.title}
        </span>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {Object.entries(tasksByType).map(([type, count]) => {
            const cfg = TYPE_CFG[type as keyof typeof TYPE_CFG] || TYPE_CFG.backend;
            return (
              <span key={type} className="rq-task-badge" style={{ background: cfg.bg, color: cfg.color }}>
                {count as number} {cfg.label}
              </span>
            );
          })}
        </div>
      </div>

      {expanded && (
        <div style={{ padding: "0 20px 20px", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.65, margin: "14px 0" }}>
            {story.description}
          </p>

          {story.acceptance_criteria?.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <button onClick={() => setShowAC(s => !s)} className="rq-btn-ghost"
                style={{ fontSize: 11, padding: "4px 10px", gap: 5 }}>
                {showAC ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Acceptance Criteria ({story.acceptance_criteria.length})
              </button>
              {showAC && (
                <div style={{ marginTop: 10, paddingLeft: 14, borderLeft: "2px solid rgba(255,255,255,0.06)" }}>
                  {story.acceptance_criteria.map((ac: any) => (
                    <div key={ac.id} style={{
                      display: "flex", gap: 8, padding: "4px 0",
                      fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5,
                    }}>
                      <span style={{ color: accent, fontWeight: 700, flexShrink: 0 }}>#{ac.id}</span>
                      <span>{ac.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{
            fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.2)",
            textTransform: "uppercase", letterSpacing: "0.8px", marginBottom: 8,
          }}>Technical Tasks</div>

          {(story.technical_tasks || []).length > 0 ? (
            <div style={{
              background: "rgba(0,0,0,0.15)", borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.04)",
            }}>
              {story.technical_tasks.map((task: any) => (
                <TaskRow key={task.id} task={task} contributors={contributors}
                  onUpdate={onTaskUpdate} onDelete={onTaskDelete} />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.2)", padding: "10px 0" }}>No tasks yet</div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Delete Confirm ────────────────────────────────
const DeleteModal = ({ task, onConfirm, onCancel }: any) => (
  <div style={{
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)",
    backdropFilter: "blur(8px)", zIndex: 200,
    display: "flex", alignItems: "center", justifyContent: "center",
  }}>
    <div style={{
      background: "#181826", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 14, padding: 28, maxWidth: 420, width: "90%",
      boxShadow: "0 20px 48px rgba(0,0,0,0.6)",
    }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 22 }}>
        <AlertTriangle size={20} style={{ color: "#f87171", flexShrink: 0, marginTop: 2 }} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "white", fontFamily: "'DM Sans', sans-serif", marginBottom: 6 }}>
            Delete Task
          </div>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.55 }}>
            "{task.description.slice(0, 90)}{task.description.length > 90 ? "…" : ""}"
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="rq-btn-ghost" onClick={onCancel}>Cancel</button>
        <button onClick={() => onConfirm(task.id)} style={{
          padding: "9px 20px", borderRadius: 10,
          background: "rgba(248,113,113,0.12)", border: "1px solid rgba(248,113,113,0.3)",
          color: "#f87171", cursor: "pointer", fontSize: 13, fontWeight: 600,
          fontFamily: "'DM Sans', sans-serif",
        }}>Delete</button>
      </div>
    </div>
  </div>
);

// ─── Main Page ────────────────────────────────────
export default function RequirementsPage() {
  const [repos, setRepos] = useState<any[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [stories, setStories] = useState<any[]>([]);
  const [contributors, setContributors] = useState<any[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [loading, setLoading] = useState(false);
  const [deletingTask, setDeletingTask] = useState<any>(null);
  const [toast, setToast] = useState<any>(null);
  const [filterType, setFilterType] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  useEffect(() => {
    setLoadingRepos(true);
    apiAxios.get("/analysis/history")
      .then(res => {
        const list = res.data.history || [];
        const seen = new Set();
        const unique = list.filter((a: any) => {
          if (seen.has(a.repo_id)) return false;
          seen.add(a.repo_id);
          return true;
        });
        setRepos(unique);
      })
      .catch(() => setRepos([]))
      .finally(() => setLoadingRepos(false));
  }, []);

  // ── Auto Sync & Fetch Logic ──
  useEffect(() => {
    if (!selectedRepo) {
      setStories([]);
      setContributors([]);
      return;
    }
    
    setLoading(true);

    const loadData = async () => {
      try {
        try {
          await apiAxios.post(`/requirements/repositories/${selectedRepo}/sync-contributors`);
        } catch (syncErr) {
          console.warn("Auto-sync skipped or failed:", syncErr);
        }

        const [s, c] = await Promise.all([
          apiAxios.get(`/requirements/repositories/${selectedRepo}/stories`),
          apiAxios.get(`/requirements/repositories/${selectedRepo}/contributors`),
        ]);

        setStories(s.data || []);
        setContributors(c.data || []);
      } catch (err) {
        showToast("Failed to load repository data", false);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [selectedRepo]);

  const handleTaskUpdate = useCallback(async (taskId: number, patch: any) => {
    try {
      const res = await apiAxios.patch(`/requirements/tasks/${taskId}`, patch);
      const updated = res.data;
      setStories((prev: any) => prev.map((s: any) => ({
        ...s,
        technical_tasks: s.technical_tasks.map((t: any) => t.id === taskId ? { ...t, ...updated } : t),
      })));
      showToast("Saved");
    } catch { showToast("Update failed", false); }
  }, []);

  const handleTaskDelete = useCallback(async (taskId: number) => {
    try {
      await apiAxios.delete(`/requirements/tasks/${taskId}`);
      setStories((prev: any) => prev.map((s: any) => ({
        ...s,
        technical_tasks: s.technical_tasks.filter((t: any) => t.id !== taskId),
      })));
      setDeletingTask(null);
      showToast("Task deleted");
    } catch { showToast("Delete failed", false); }
  }, []);

  const filtered = stories.filter(s => {
    if (filterPriority !== "all" && s.priority !== filterPriority) return false;
    if (filterType !== "all" && !s.technical_tasks?.some((t: any) => t.type === filterType)) return false;
    return true;
  });

  const total = stories.reduce((n, s) => n + (s.technical_tasks?.length || 0), 0);
  const assigned = stories.reduce((n, s) => n + (s.technical_tasks?.filter((t: any) => t.assigned_to).length || 0), 0);

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');

        .rq-input {
          width: 100%; padding: 11px 14px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 10px; color: white;
          font-family: 'DM Sans', sans-serif; font-size: 14px;
          outline: none; transition: border-color 0.2s, background 0.2s;
        }
        .rq-input::placeholder { color: rgba(255,255,255,0.25); }
        .rq-input:focus { border-color: ${accent}60; background: rgba(255,255,255,0.06); }

        .rq-select {
          padding: 11px 14px;
          background: rgba(255,255,255,0.05);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 10px; color: white;
          font-family: 'DM Sans', sans-serif; font-size: 13.5px;
          outline: none; cursor: pointer; transition: border-color 0.2s;
        }
        .rq-select:focus { border-color: ${accent}80; }
        .rq-select option { background: #1a1a2e; color: white; }

        .rq-btn-ghost {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 9px 16px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 9px; color: rgba(255,255,255,0.6);
          font-family: 'DM Sans', sans-serif; font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all 0.2s;
        }
        .rq-btn-ghost:hover { background: rgba(255,255,255,0.08); color: white; border-color: rgba(255,255,255,0.2); }
        .rq-btn-ghost:disabled { opacity: 0.4; cursor: not-allowed; }

        .rq-dim-card {
          background: rgba(255,255,255,0.025);
          border: 1px solid rgba(255,255,255,0.07);
          border-radius: 16px;
          transition: border-color 0.2s;
        }
        .rq-dim-card:hover { border-color: rgba(255,255,255,0.12); }

        .rq-analysis-row {
          display: flex; align-items: center; gap: 12px;
          padding: 12px 14px;
          border-bottom: 1px solid rgba(255,255,255,0.04);
          transition: background 0.15s;
        }
        .rq-analysis-row:last-child { border-bottom: none; }
        .rq-analysis-row:hover { background: rgba(255,255,255,0.02); }

        .rq-task-badge {
          display: inline-flex; align-items: center;
          padding: 3px 8px; border-radius: 6px;
          font-size: 10px; font-weight: 700;
          text-transform: uppercase; letter-spacing: 0.5px;
          font-family: 'DM Sans', sans-serif; white-space: nowrap;
        }

        .sk {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%);
          background-size: 400% 100%;
          animation: shimmer 1.5s ease-in-out infinite;
          border-radius: 8px;
        }

        @keyframes shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

        input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.4); cursor: pointer; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; }
      `}</style>

      {/* Toast */}
      {toast && (
        <div style={{
          position: "fixed", bottom: 28, right: 28, zIndex: 500,
          padding: "12px 20px", borderRadius: 10,
          background: "#1e1e2e",
          border: `1px solid ${toast.ok ? "rgba(74,222,128,0.3)" : "rgba(248,113,113,0.3)"}`,
          color: toast.ok ? "#4ade80" : "#f87171",
          fontSize: 13, fontWeight: 600,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          animation: "slideUp 0.2s ease-out",
        }}>{toast.msg}</div>
      )}

      {deletingTask && (
        <DeleteModal task={deletingTask} onConfirm={handleTaskDelete} onCancel={() => setDeletingTask(null)} />
      )}

      {/* ── Inner content ── */}
      <div style={{ padding: "32px 36px", maxWidth: "1120px", fontFamily: "'DM Sans', sans-serif" }}>

        <div style={{ marginBottom: "32px" }}>
          <h1 style={{
            fontFamily: "'Syne', sans-serif",
            fontSize: "26px", fontWeight: 800,
            color: "white", letterSpacing: "-0.5px",
            margin: "0 0 6px",
          }}>Feature Completion & Readiness</h1>
          <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.35)", margin: 0 }}>
            Track business value delivered and deployment readiness across the project
          </p>
        </div>

        {/* Controls bar */}
        <div style={{
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: "16px", padding: "20px 28px",
          marginBottom: "24px",
          display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap",
        }}>
          <span style={{ fontSize: "13.5px", color: "rgba(255,255,255,0.5)", fontWeight: 500, whiteSpace: "nowrap" }}>
            Repository:
          </span>

          {loadingRepos ? (
            <div className="sk" style={{ width: "220px", height: "36px", borderRadius: "10px" }} />
          ) : (
            <select value={selectedRepo} onChange={e => setSelectedRepo(e.target.value)}
              className="rq-select" style={{ minWidth: 230 }}>
              <option value="">— Select Repository —</option>
              {repos.map(r => (
                <option key={r.repo_id} value={r.repo_id}>
                  {r.repo_name} ({r.branch})
                </option>
              ))}
            </select>
          )}

          {!selectedRepo && !loadingRepos && repos.length > 0 && (
            <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.25)", width: "100%" }}>
              Select a repository to view its stories, acceptance criteria, and technical tasks.
            </span>
          )}

          {stories.length > 0 && (
            <>
              <select value={filterType} onChange={e => setFilterType(e.target.value)}
                className="rq-select" style={{ fontSize: 12, padding: "8px 12px" }}>
                <option value="all">All Types</option>
                <option value="backend">Backend</option>
                <option value="frontend">Frontend</option>
                <option value="qa">QA</option>
              </select>
              <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
                className="rq-select" style={{ fontSize: 12, padding: "8px 12px" }}>
                <option value="all">All Priorities</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </>
          )}

          {/* Stats - Coverage text removed */}
          {total > 0 && (
            <div style={{ marginLeft: "auto", display: "flex", gap: 24, alignItems: "center" }}>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "22px", fontWeight: 800, fontFamily: "'Syne', sans-serif", letterSpacing: "-1px", lineHeight: 1, color: accent }}>
                  {assigned}<span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", fontWeight: 400 }}>/{total}</span>
                </div>
                <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: "0.6px", marginTop: 2 }}>Assigned Tasks</div>
              </div>
            </div>
          )}
        </div>

        {/* Loading skeletons */}
        {(loading || loadingRepos) && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[72, 56, 64].map((h, i) => <div key={i} className="sk" style={{ height: h }} />)}
          </div>
        )}

        {/* Empty states */}
        {!loading && !loadingRepos && !selectedRepo && (
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
              margin: "0 auto 16px", color: accent,
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
              </svg>
            </div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: "6px" }}>
              Select a Repository
            </div>
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)" }}>
              Choose a repository above to view its requirements and tasks
            </div>
          </div>
        )}

        {!loading && !loadingRepos && selectedRepo && !stories.length && (
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
              margin: "0 auto 16px", color: accent,
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
            </div>
            <div style={{ fontSize: "15px", fontWeight: 700, color: "rgba(255,255,255,0.5)", marginBottom: "6px" }}>
              No Requirements Found
            </div>
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)" }}>
              No requirements have been confirmed for this repository yet. Please upload and confirm a PRD first.
            </div>
          </div>
        )}

        {/* Stories */}
        {!loading && !loadingRepos && filtered.map((story: any) => (
          <StoryCard
            key={story.id}
            story={story}
            contributors={contributors}
            onTaskUpdate={handleTaskUpdate}
            onTaskDelete={setDeletingTask}
          />
        ))}

        {!loading && !loadingRepos && stories.length > 0 && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 20px", color: "rgba(255,255,255,0.2)", fontSize: 13 }}>
            No stories match the current filters
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}