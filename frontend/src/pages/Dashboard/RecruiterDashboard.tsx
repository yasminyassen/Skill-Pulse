import DashboardLayout from "../DashboardLayout";

export default function RecruiterDashboard() {
  return (
    <DashboardLayout>
      <div style={{
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        minHeight: "100vh", fontFamily: "'DM Sans', sans-serif",
        color: "rgba(255,255,255,0.4)", gap: "12px",
      }}>
        <div style={{
          width: "64px", height: "64px", borderRadius: "18px",
          background: "rgba(168,85,247,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: "4px",
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a855f7" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Recruiter Dashboard</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)" }}>This page is coming soon</div>
      </div>
    </DashboardLayout>
  );
}
