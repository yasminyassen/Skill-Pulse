import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

interface ProfileData {
  id: number; full_name: string; username: string; email: string; role: string | null;
  avatar_url: string | null; github_login: string | null; github_connected: boolean;
  organization: string | null; job_title: string | null; member_since: string | null;
}

const accent = "#6366f1";
const initials = (name: string) => name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);

function Skeleton({ w, h, radius = 8 }: { w: number | string; h: number; radius?: number }) {
  return <div className="sk" style={{ width: w, height: h, borderRadius: radius }} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: "16px", fontWeight: 800, color: "var(--text-primary)", letterSpacing: "-0.2px", margin: "0 0 16px", paddingBottom: "12px", borderBottom: "1px solid var(--border)" }}>
      {children}
    </h2>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: "16px", padding: "24px 28px", transition: "background 0.3s ease, border-color 0.3s ease", ...style }}>
      {children}
    </div>
  );
}

function Toast({ msg, type }: { msg: string; type: "success" | "error" }) {
  return (
    <div style={{ position: "fixed", bottom: "28px", right: "28px", zIndex: 9999, padding: "12px 20px", borderRadius: "12px", background: type === "success" ? "rgba(52,211,153,0.12)" : "rgba(248,113,113,0.12)", border: `1px solid ${type === "success" ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`, color: type === "success" ? "#34d399" : "#f87171", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px", boxShadow: "0 8px 32px rgba(0,0,0,0.2)", fontFamily: "'DM Sans', sans-serif" }}>
      {type === "success" ? (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>) : (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>)}
      {msg}
    </div>
  );
}

interface FieldProps { label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; readOnly?: boolean; hint?: string; }

function Field({ label, value, onChange, placeholder, type = "text", readOnly = false, hint }: FieldProps) {
  return (
    <div>
      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontWeight: 700, marginBottom: "7px", letterSpacing: "0.6px", textTransform: "uppercase" }}>{label}</div>
      <input
        type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} readOnly={readOnly}
        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", background: readOnly ? "var(--bg-input)" : "var(--bg-input-focus)", border: `1px solid ${readOnly ? "var(--border)" : "var(--border-input)"}`, color: readOnly ? "var(--text-muted)" : "var(--text-primary)", fontSize: "14px", outline: "none", fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box" as const, cursor: readOnly ? "default" : "text", transition: "border-color 0.2s, background 0.3s ease" }}
      />
      {hint && <div style={{ fontSize: "11px", color: "var(--text-faint)", marginTop: "5px" }}>{hint}</div>}
    </div>
  );
}

export default function AccountSettings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);
  const [fullName, setFullName] = useState("");
  const [org, setOrg] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  const showToast = (msg: string, type: "success" | "error") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/profile"); const d: ProfileData = res.data;
        setProfile(d); setFullName(d.full_name ?? ""); setOrg(d.organization ?? ""); setJobTitle(d.job_title ?? "");
      } catch (err: any) { if (err.response?.status === 401) { localStorage.clear(); window.location.href = "/login"; } }
      finally { setLoading(false); }
    })();
  }, []);

  const handleSave = useCallback(async () => {
    if (!fullName.trim()) { showToast("Full name cannot be empty", "error"); return; }
    setSaving(true);
    try {
      await api.patch("/profile", { full_name: fullName.trim(), organization: org.trim() || null, job_title: jobTitle.trim() || null });
      setProfile((p) => p ? { ...p, full_name: fullName.trim(), organization: org.trim() || null, job_title: jobTitle.trim() || null } : p);
      showToast("Profile updated successfully", "success");
    } catch { showToast("Failed to save changes. Try again.", "error"); }
    finally { setSaving(false); }
  }, [fullName, org, jobTitle]);

  const handleDelete = useCallback(async () => {
    if (deleteConfirm !== "DELETE") { showToast("Type DELETE to confirm", "error"); return; }
    setDeleting(true);
    try { await api.delete("/profile"); localStorage.clear(); window.location.href = "/login"; }
    catch { showToast("Failed to delete account. Try again.", "error"); setDeleting(false); }
  }, [deleteConfirm]);

  const user = profile;

  return (
    <DashboardLayout>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@300;400;500;600;700&display=swap');
        .sk { background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%); background-size: 400% 100%; animation: shimmer 1.5s ease-in-out infinite; }
        @keyframes shimmer { 0%{background-position:100% 50%} 100%{background-position:0% 50%} }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        input:focus { border-color: rgba(99,102,241,0.5) !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.08); }
      `}</style>

      {toast && <Toast msg={toast.msg} type={toast.type} />}

      <div style={{ padding: "32px 36px", maxWidth: "680px", fontFamily: "'DM Sans', sans-serif" }}>

        <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "28px" }}>
          <button onClick={() => navigate("/dashboard/developer/profile")} style={{ width: 36, height: 36, borderRadius: "10px", border: "1px solid var(--border)", background: "var(--bg-card)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: "24px", fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.4px" }}>Account Settings</h1>
            <p style={{ fontSize: "13px", color: "var(--text-muted)", margin: "2px 0 0" }}>Manage your account details</p>
          </div>
        </div>

        <Card style={{ marginBottom: "16px" }}>
          {loading ? (
            <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
              <Skeleton w={64} h={64} radius={50} />
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                <Skeleton w="45%" h={18} /><Skeleton w="30%" h={13} />
              </div>
            </div>
          ) : user ? (
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              {user.avatar_url ? (
                <img src={user.avatar_url} alt={user.full_name} style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: "2px solid rgba(99,102,241,0.3)" }} />
              ) : (
                <div style={{ width: 64, height: 64, borderRadius: "50%", background: `linear-gradient(135deg, ${accent}, #ec4899)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", fontWeight: 800, color: "white", flexShrink: 0 }}>
                  {initials(user.full_name)}
                </div>
              )}
              <div>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-primary)" }}>{user.full_name}</div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>@{user.username}</div>
                {user.role && (
                  <span style={{ marginTop: "6px", display: "inline-block", padding: "2px 10px", borderRadius: "20px", background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.25)", color: "#818cf8", fontSize: "11px", fontWeight: 700, textTransform: "capitalize" }}>
                    {user.role}
                  </span>
                )}
              </div>
            </div>
          ) : null}
        </Card>

        <Card style={{ marginBottom: "16px" }}>
          <SectionTitle>Personal Information</SectionTitle>
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {[1, 2, 3].map((i) => <Skeleton key={i} w="100%" h={44} radius={10} />)}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <Field label="Full Name" value={fullName} onChange={setFullName} placeholder="Your full name" />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                <Field label="Organization" value={org} onChange={setOrg} placeholder="Your company or org" />
                <Field label="Job Title" value={jobTitle} onChange={setJobTitle} placeholder="e.g. Senior Engineer" />
              </div>
              <Field label="Username" value={user?.username ?? ""} onChange={() => {}} readOnly hint="Username cannot be changed" />
              <Field label="Email" value={user?.email ?? ""} onChange={() => {}} readOnly hint="Contact support to change your email" />
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "20px", paddingTop: "16px", borderTop: "1px solid var(--border)" }}>
            <button onClick={handleSave} disabled={saving || loading} style={{ padding: "9px 22px", borderRadius: "10px", border: "none", background: saving ? "rgba(99,102,241,0.5)" : accent, color: "white", fontSize: "13px", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", fontFamily: "'DM Sans', sans-serif", transition: "background 0.15s", display: "flex", alignItems: "center", gap: "7px" }}>
              {saving ? (<><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: "spin 1s linear infinite" }}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>Saving…</>) : "Save Changes"}
            </button>
          </div>
        </Card>

        <Card style={{ marginBottom: "16px" }}>
          <SectionTitle>Connected Integrations</SectionTitle>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", borderRadius: "12px", background: "var(--bg-input)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--bg-card-hover)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
              </div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>GitHub</div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>{loading ? "—" : (user?.github_connected ? (user.github_login ? `Connected as @${user.github_login}` : "Connected") : "Not connected")}</div>
              </div>
            </div>
            <span style={{ padding: "3px 10px", borderRadius: "20px", fontSize: "11px", fontWeight: 700, background: user?.github_connected ? "rgba(52,211,153,0.1)" : "var(--bg-input)", color: user?.github_connected ? "#34d399" : "var(--text-muted)", border: `1px solid ${user?.github_connected ? "rgba(52,211,153,0.2)" : "var(--border)"}` }}>
              {user?.github_connected ? "Connected" : "Not connected"}
            </span>
          </div>
        </Card>

        <Card style={{ border: "1px solid rgba(248,113,113,0.15)", background: "rgba(248,113,113,0.03)" }}>
          <SectionTitle>Danger Zone</SectionTitle>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 16px" }}>Once you delete your account, all your data will be permanently removed. This action cannot be undone.</p>
          {!showDelete ? (
            <button onClick={() => setShowDelete(true)} style={{ padding: "9px 20px", borderRadius: "10px", border: "1px solid rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.08)", color: "#f87171", fontSize: "13px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>
              Delete My Account
            </button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <p style={{ fontSize: "13px", color: "#f87171", margin: 0, fontWeight: 600 }}>Type <strong>DELETE</strong> to confirm account deletion:</p>
              <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} placeholder="Type DELETE here" style={{ padding: "9px 13px", borderRadius: "9px", background: "rgba(248,113,113,0.06)", border: "1px solid rgba(248,113,113,0.2)", color: "var(--text-primary)", fontSize: "14px", outline: "none", fontFamily: "'DM Sans', sans-serif" }} />
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => { setShowDelete(false); setDeleteConfirm(""); }} style={{ padding: "8px 16px", borderRadius: "9px", border: "1px solid var(--border)", background: "transparent", color: "var(--text-muted)", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}>Cancel</button>
                <button onClick={handleDelete} disabled={deleting || deleteConfirm !== "DELETE"} style={{ padding: "8px 20px", borderRadius: "9px", border: "none", background: deleteConfirm === "DELETE" ? "#ef4444" : "rgba(248,113,113,0.2)", color: "white", fontSize: "13px", fontWeight: 700, cursor: deleteConfirm === "DELETE" ? "pointer" : "not-allowed", fontFamily: "'DM Sans', sans-serif" }}>
                  {deleting ? "Deleting…" : "Confirm Delete"}
                </button>
              </div>
            </div>
          )}
        </Card>

      </div>
    </DashboardLayout>
  );
}