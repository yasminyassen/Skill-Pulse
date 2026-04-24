import DashboardLayout from "../DashboardLayout";

export default function ManagerDashboard() {
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
          background: "rgba(139,92,246,0.1)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: "4px",
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
        </div>
        <div style={{ fontSize: "18px", fontWeight: 700, color: "rgba(255,255,255,0.6)" }}>Manager Dashboard</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.25)" }}>This page is coming soon</div>
      </div>
    </DashboardLayout>
  );
}
