import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  Code2,
  GitBranch,
  Network,
  RefreshCcw,
  Star,
  TrendingUp,
  Trophy,
  Users,
  Wrench,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import api from "../../api/auth";
import DashboardLayout from "../DashboardLayout";

interface DashboardRepo {
  id: number;
  name: string | null;
  full_name: string | null;
  is_private: boolean;
  last_analyzed_at: string | null;
  analysis_count: number;
  member_count: number;
}

interface TopPerformer {
  id: number;
  full_name: string;
  username: string;
  average_score: number;
}

interface Kpis {
  team_average_score: number;
  team_size: number;
  top_performer: TopPerformer | null;
  growth_rate: number;
}

interface TrendPoint {
  month: string;
  average_score: number;
}

interface SkillDistribution {
  code_quality: number;
  problem_solving: number;
  architecture: number;
  maintainability: number;
}

interface TeamMember {
  id: number;
  full_name: string;
  username: string;
  email: string;
  avatar_url: string | null;
  specialization: string | null;
  average_overall_score: number;
  code_quality: number;
  problem_solving: number;
  architecture: number;
  maintainability: number;
  repository_count: number;
  analysis_count: number;
}

interface TeamInsights {
  team_strengths: string[];
  areas_needing_attention: string[];
}

const accent = "#8b5cf6";

const emptyKpis: Kpis = {
  team_average_score: 0,
  team_size: 0,
  top_performer: null,
  growth_rate: 0,
};

const emptySkills: SkillDistribution = {
  code_quality: 0,
  problem_solving: 0,
  architecture: 0,
  maintainability: 0,
};

const skillMeta = [
  { key: "code_quality", label: "Code Quality", icon: Code2, color: "#6366f1" },
  { key: "problem_solving", label: "Problem Solving", icon: Brain, color: "#06b6d4" },
  { key: "architecture", label: "Architecture", icon: Network, color: "#22c55e" },
  { key: "maintainability", label: "Maintainability", icon: Wrench, color: "#f59e0b" },
] as const;

const fmtScore = (value: number | null | undefined, digits = 0) => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(digits) : "0";
};

const clampScore = (value: number) => Math.max(0, Math.min(100, Number(value) || 0));

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0])
    .join("")
    .toUpperCase() || "SP";

const formatMonth = (month: string) => {
  const date = new Date(`${month}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
};

const scoreBadge = (score: number) => {
  if (score >= 90) return { label: "Excellent", color: "#16a34a", bg: "rgba(34,197,94,0.13)" };
  if (score >= 80) return { label: "Strong", color: "#0284c7", bg: "rgba(14,165,233,0.14)" };
  if (score >= 70) return { label: "Steady", color: "#7c3aed", bg: "rgba(139,92,246,0.14)" };
  return { label: "Needs Focus", color: "#ea580c", bg: "rgba(249,115,22,0.14)" };
};

const specializationLabel = (value: string | null) => {
  if (!value) return "Developer";
  const labels: Record<string, string> = {
    backend: "Backend Developer",
    frontend: "Frontend Developer",
    qa: "QA Developer",
  };
  return labels[value] || `${value.charAt(0).toUpperCase()}${value.slice(1)} Developer`;
};

function ManagerDashboardSkeleton() {
  return (
    <>
      <div className="mgr-kpi-grid">
        {[1, 2, 3, 4].map(item => <div key={item} className="mgr-card mgr-skeleton" style={{ height: 132 }} />)}
      </div>
      <div className="mgr-panel mgr-skeleton" style={{ height: 300 }} />
      <div className="mgr-panel mgr-skeleton" style={{ height: 260 }} />
    </>
  );
}

function ProgressBar({ value, color = accent }: { value: number; color?: string }) {
  return (
    <div className="mgr-progress" aria-hidden="true">
      <span style={{ width: `${clampScore(value)}%`, background: color }} />
    </div>
  );
}

function KpiCard({
  label,
  value,
  detail,
  icon: Icon,
  highlight = false,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Users;
  highlight?: boolean;
}) {
  return (
    <section className={`mgr-card ${highlight ? "mgr-card-primary" : ""}`}>
      <div className="mgr-card-top">
        <span>{label}</span>
        <Icon size={18} strokeWidth={2} />
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </section>
  );
}

function MemberRow({ member }: { member: TeamMember }) {
  const badge = scoreBadge(member.average_overall_score);
  return (
    <article className="mgr-member">
      <div className="mgr-member-main">
        <div className="mgr-avatar">
          {member.avatar_url ? <img src={member.avatar_url} alt="" /> : initials(member.full_name)}
        </div>
        <div className="mgr-member-title">
          <strong>{member.full_name}</strong>
          <span>{specializationLabel(member.specialization)}</span>
        </div>
        <div className="mgr-member-score">
          <span style={{ color: badge.color, background: badge.bg }}>{badge.label}</span>
          <strong>{fmtScore(member.average_overall_score)}</strong>
        </div>
      </div>

      <div className="mgr-member-skills">
        {skillMeta.map(skill => {
          const value = member[skill.key];
          return (
            <div key={skill.key} className="mgr-mini-skill">
              <div>
                <span>{skill.label}</span>
                <strong>{fmtScore(value)}</strong>
              </div>
              <ProgressBar value={value} color={skill.color} />
            </div>
          );
        })}
      </div>

      <div className="mgr-member-foot">
        <span>{member.repository_count} repositories</span>
        <span>{member.analysis_count} score snapshots</span>
      </div>
    </article>
  );
}

export default function ManagerDashboard() {
  const [repos, setRepos] = useState<DashboardRepo[]>([]);
  const [selectedRepoId, setSelectedRepoId] = useState<string>("all");
  const [kpis, setKpis] = useState<Kpis>(emptyKpis);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [skills, setSkills] = useState<SkillDistribution>(emptySkills);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [insights, setInsights] = useState<TeamInsights>({ team_strengths: [], areas_needing_attention: [] });
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedRepo = repos.find(repo => String(repo.id) === selectedRepoId);

  const fetchRepos = async () => {
    setLoadingRepos(true);
    try {
      const response = await api.get<DashboardRepo[]>("/manager/dashboard/repos");
      setRepos(response.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.clear();
        window.location.href = "/login";
        return;
      }
      setError("Unable to load repositories.");
    } finally {
      setLoadingRepos(false);
    }
  };

  const fetchDashboard = async () => {
    setLoadingDashboard(true);
    setError(null);
    const params = selectedRepoId === "all" ? {} : { repo_id: Number(selectedRepoId) };

    try {
      const [kpiRes, trendRes, skillRes, memberRes, insightRes] = await Promise.all([
        api.get<Kpis>("/manager/dashboard/kpis", { params }),
        api.get<TrendPoint[]>("/manager/dashboard/trends", { params }),
        api.get<SkillDistribution>("/manager/dashboard/skills", { params }),
        api.get<TeamMember[]>("/manager/dashboard/members", { params }),
        api.get<TeamInsights>("/manager/dashboard/insights", { params }),
      ]);

      setKpis(kpiRes.data);
      setTrends(trendRes.data);
      setSkills(skillRes.data);
      setMembers(memberRes.data);
      setInsights(insightRes.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.clear();
        window.location.href = "/login";
        return;
      }
      setError("Unable to load team dashboard metrics.");
    } finally {
      setLoadingDashboard(false);
    }
  };

  useEffect(() => {
    fetchRepos();
  }, []);

  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepoId]);

  const trendData = useMemo(
    () => trends.map(point => ({ ...point, label: formatMonth(point.month) })),
    [trends],
  );

  const skillData = useMemo(
    () => skillMeta.map(skill => ({
      key: skill.key,
      name: skill.label,
      score: Number(skills[skill.key] || 0),
      color: skill.color,
    })),
    [skills],
  );

  const refreshAll = () => {
    fetchRepos();
    fetchDashboard();
  };

  return (
    <DashboardLayout>
      <style>{`
        .mgr-page {
          min-height: 100vh;
          background: var(--bg-gradient);
          color: var(--text-primary);
          font-family: 'DM Sans', system-ui, sans-serif;
          padding: 36px 40px 80px;
        }
        .mgr-shell {
          max-width: 960px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .mgr-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 18px;
          flex-wrap: wrap;
        }
        .mgr-title h1 {
          margin: 0 0 4px;
          font-family: 'Syne', sans-serif;
          font-size: 28px;
          line-height: 1.15;
          letter-spacing: 0;
        }
        .mgr-title p {
          margin: 0;
          color: var(--text-secondary);
          font-size: 14px;
        }
        .mgr-toolbar {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: min(100%, 420px);
        }
        .mgr-filter {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 9px;
          min-height: 42px;
          padding: 0 12px;
          border: 1px solid rgba(139, 92, 246, 0.25);
          background: var(--bg-card);
          border-radius: 8px;
        }
        .mgr-filter svg {
          color: ${accent};
          flex: 0 0 auto;
        }
        .mgr-filter select {
          width: 100%;
          min-width: 0;
          border: 0;
          outline: 0;
          background: transparent;
          color: var(--text-primary);
          font: inherit;
          font-size: 13px;
          cursor: pointer;
        }
        .mgr-filter select option {
          background: var(--bg-base);
          color: var(--text-primary);
        }
        .mgr-icon-button {
          width: 42px;
          height: 42px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-card);
          color: var(--text-secondary);
          cursor: pointer;
        }
        .mgr-icon-button:hover {
          border-color: rgba(139, 92, 246, 0.45);
          color: ${accent};
        }
        .mgr-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
        }
        .mgr-card,
        .mgr-panel,
        .mgr-member {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-card);
          box-shadow: var(--shadow-card);
        }
        .mgr-card {
          padding: 20px;
          min-height: 132px;
        }
        .mgr-card-primary {
          background: linear-gradient(135deg, ${accent}, #7c3aed 52%, #db2777);
          color: white;
          border-color: transparent;
        }
        .mgr-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: inherit;
          opacity: 0.78;
          font-size: 12px;
          margin-bottom: 20px;
        }
        .mgr-card strong {
          display: block;
          font-size: 28px;
          line-height: 1;
          font-weight: 800;
          letter-spacing: 0;
          color: inherit;
          word-break: break-word;
        }
        .mgr-card small {
          display: block;
          margin-top: 16px;
          color: inherit;
          opacity: 0.72;
          font-size: 12px;
        }
        .mgr-card:not(.mgr-card-primary) strong {
          color: var(--text-primary);
        }
        .mgr-card:not(.mgr-card-primary) small,
        .mgr-card:not(.mgr-card-primary) .mgr-card-top {
          color: var(--text-secondary);
        }
        .mgr-panel {
          padding: 20px;
        }
        .mgr-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 18px;
        }
        .mgr-panel-title {
          display: flex;
          align-items: center;
          gap: 9px;
          font-size: 15px;
          font-weight: 800;
          color: var(--text-primary);
        }
        .mgr-panel-title svg {
          color: ${accent};
        }
        .mgr-panel-sub {
          color: var(--text-muted);
          font-size: 12px;
        }
        .mgr-chart {
          width: 100%;
          height: 280px;
        }
        .mgr-split,
        .mgr-bottom-insights {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
        }
        .mgr-text-card {
          min-height: 230px;
        }
        .mgr-text-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin: 0;
          padding: 0;
          list-style: none;
        }
        .mgr-text-item {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr);
          gap: 12px;
          align-items: flex-start;
          padding: 13px 14px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-input);
        }
        .mgr-text-item-icon {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
        }
        .mgr-text-item span:last-child {
          color: var(--text-secondary);
          font-size: 13px;
          line-height: 1.45;
        }
        .mgr-members {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .mgr-section-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          margin: 4px 0 2px;
        }
        .mgr-section-head h2 {
          margin: 0;
          font-size: 17px;
          letter-spacing: 0;
        }
        .mgr-section-head span {
          color: var(--text-muted);
          font-size: 12px;
        }
        .mgr-member {
          padding: 16px;
        }
        .mgr-member-main {
          display: grid;
          grid-template-columns: 44px minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
        }
        .mgr-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: linear-gradient(135deg, ${accent}, #ec4899);
          color: white;
          font-size: 13px;
          font-weight: 800;
        }
        .mgr-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .mgr-member-title {
          min-width: 0;
        }
        .mgr-member-title strong {
          display: block;
          color: var(--text-primary);
          font-size: 14px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .mgr-member-title span {
          color: var(--text-muted);
          font-size: 12px;
        }
        .mgr-member-score {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-self: end;
        }
        .mgr-member-score span {
          border-radius: 999px;
          padding: 4px 8px;
          font-size: 11px;
          font-weight: 800;
          white-space: nowrap;
        }
        .mgr-member-score strong {
          font-size: 25px;
          line-height: 1;
          color: var(--text-primary);
          min-width: 38px;
          text-align: right;
        }
        .mgr-member-skills {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 12px;
          margin-top: 16px;
        }
        .mgr-mini-skill {
          min-width: 0;
        }
        .mgr-mini-skill div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          color: var(--text-muted);
          font-size: 11px;
          margin-bottom: 6px;
        }
        .mgr-mini-skill strong {
          color: var(--text-secondary);
          font-size: 11px;
        }
        .mgr-progress {
          height: 5px;
          width: 100%;
          border-radius: 999px;
          overflow: hidden;
          background: var(--border);
        }
        .mgr-progress span {
          display: block;
          height: 100%;
          border-radius: inherit;
        }
        .mgr-member-foot {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          color: var(--text-muted);
          font-size: 12px;
          margin-top: 14px;
        }
        .mgr-insight-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .mgr-insight-row {
          display: grid;
          grid-template-columns: 34px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: center;
          padding: 11px 0;
          border-bottom: 1px solid var(--border);
        }
        .mgr-insight-row:last-child {
          border-bottom: 0;
        }
        .mgr-insight-icon {
          width: 34px;
          height: 34px;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }
        .mgr-insight-row strong {
          display: block;
          font-size: 13px;
          color: var(--text-primary);
        }
        .mgr-insight-row span {
          color: var(--text-muted);
          font-size: 12px;
        }
        .mgr-insight-score {
          font-size: 12px;
          font-weight: 800;
          color: var(--text-secondary);
        }
        .mgr-empty {
          border: 1px dashed var(--border-hover);
          border-radius: 8px;
          padding: 34px 18px;
          text-align: center;
          color: var(--text-muted);
          background: var(--bg-card);
        }
        .mgr-empty strong {
          display: block;
          color: var(--text-secondary);
          margin-bottom: 5px;
        }
        .mgr-error {
          border: 1px solid rgba(248, 113, 113, 0.35);
          color: #f87171;
          background: rgba(248, 113, 113, 0.09);
          border-radius: 8px;
          padding: 12px 14px;
          font-size: 13px;
        }
        .mgr-skeleton {
          background: linear-gradient(90deg, var(--bg-card) 25%, var(--bg-card-hover) 50%, var(--bg-card) 75%);
          background-size: 400% 100%;
          animation: mgr-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes mgr-shimmer {
          0% { background-position: 100% 50%; }
          100% { background-position: 0 50%; }
        }
        @media (max-width: 1060px) {
          .mgr-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .mgr-split {
            grid-template-columns: 1fr;
          }
        }
        @media (max-width: 760px) {
          .mgr-page {
            padding: 24px 16px 56px;
          }
          .mgr-header {
            align-items: stretch;
          }
          .mgr-toolbar {
            width: 100%;
          }
          .mgr-kpi-grid,
          .mgr-member-skills,
          .mgr-bottom-insights {
            grid-template-columns: 1fr;
          }
          .mgr-member-main {
            grid-template-columns: 44px minmax(0, 1fr);
          }
          .mgr-member-score {
            grid-column: 1 / -1;
            justify-self: stretch;
            justify-content: space-between;
          }
          .mgr-member-foot {
            align-items: flex-start;
            flex-direction: column;
          }
        }
      `}</style>

      <main className="mgr-page">
        <div className="mgr-shell">
          <div className="mgr-header">
            <div className="mgr-title">
              <h1>Team Dashboard</h1>
              <p>Team-level insights and performance evaluation</p>
            </div>

            <div className="mgr-toolbar">
              <label className="mgr-filter" title="Repository filter">
                <GitBranch size={17} strokeWidth={2} />
                <select
                  value={selectedRepoId}
                  onChange={event => setSelectedRepoId(event.target.value)}
                  disabled={loadingRepos}
                >
                  <option value="all">All Repositories</option>
                  {repos.map(repo => (
                    <option key={repo.id} value={repo.id}>
                      {repo.full_name || repo.name || `Repository ${repo.id}`}
                    </option>
                  ))}
                </select>
              </label>
              <button className="mgr-icon-button" type="button" onClick={refreshAll} title="Refresh dashboard">
                <RefreshCcw size={17} strokeWidth={2} />
              </button>
            </div>
          </div>

          {error && <div className="mgr-error">{error}</div>}

          {loadingDashboard ? (
            <ManagerDashboardSkeleton />
          ) : (
            <>
              <div className="mgr-kpi-grid">
                <KpiCard
                  label="Team Average"
                  value={fmtScore(kpis.team_average_score)}
                  detail="Overall score"
                  icon={Activity}
                  highlight
                />
                <KpiCard
                  label="Team Size"
                  value={String(kpis.team_size)}
                  detail="Active contributors"
                  icon={Users}
                />
                <KpiCard
                  label="Top Performer"
                  value={kpis.top_performer?.full_name || "—"}
                  detail={kpis.top_performer ? `Score: ${fmtScore(kpis.top_performer.average_score)}` : "No scores yet"}
                  icon={Trophy}
                />
                <KpiCard
                  label="Growth Rate"
                  value={`${kpis.growth_rate >= 0 ? "+" : ""}${fmtScore(kpis.growth_rate, 1)}`}
                  detail="Avg monthly"
                  icon={TrendingUp}
                />
              </div>

              <section className="mgr-panel">
                <div className="mgr-panel-head">
                  <div>
                    <div className="mgr-panel-title">
                      <BarChart3 size={17} strokeWidth={2} />
                      Team Score Trends
                    </div>
                    <div className="mgr-panel-sub">{selectedRepo ? selectedRepo.full_name : "All repositories"}</div>
                  </div>
                </div>
                {trendData.length ? (
                  <div className="mgr-chart">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trendData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="4 4" />
                        <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-hover)" }} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-hover)" }} tickLine={false} width={34} />
                        <Tooltip
                          cursor={{ stroke: "rgba(139,92,246,0.35)" }}
                          contentStyle={{
                            background: "var(--tooltip-bg)",
                            border: "1px solid var(--tooltip-border)",
                            borderRadius: 8,
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: unknown) => [fmtScore(Number(value), 1), "Team Average"]}
                        />
                        <Line
                          type="monotone"
                          dataKey="average_score"
                          stroke={accent}
                          strokeWidth={3}
                          dot={{ r: 4, strokeWidth: 2, fill: "var(--bg-base)", stroke: accent }}
                          activeDot={{ r: 6, strokeWidth: 0, fill: "#06b6d4" }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="mgr-empty">
                    <strong>No trend data yet</strong>
                    Analyze a repository to populate team history.
                  </div>
                )}
              </section>

              <section className="mgr-panel">
                <div className="mgr-panel-head">
                  <div className="mgr-panel-title">
                    <Star size={17} strokeWidth={2} />
                    Team Skill Distribution
                  </div>
                </div>
                {members.length ? (
                  <div className="mgr-chart" style={{ height: 250 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={skillData} layout="vertical" margin={{ top: 8, right: 18, left: 20, bottom: 8 }}>
                        <CartesianGrid stroke="var(--border)" strokeDasharray="4 4" horizontal={false} />
                        <XAxis type="number" domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-hover)" }} tickLine={false} />
                        <YAxis type="category" dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={false} tickLine={false} width={118} />
                        <Tooltip
                          cursor={{ fill: "rgba(139,92,246,0.08)" }}
                          contentStyle={{
                            background: "var(--tooltip-bg)",
                            border: "1px solid var(--tooltip-border)",
                            borderRadius: 8,
                            color: "var(--text-primary)",
                          }}
                          formatter={(value: unknown) => [fmtScore(Number(value), 1), "Team Average"]}
                        />
                        <Bar dataKey="score" radius={[0, 6, 6, 0]} fill={accent} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="mgr-empty">
                    <strong>No skill distribution yet</strong>
                    Team skill averages appear after manager-run analysis completes.
                  </div>
                )}
              </section>

              <div className="mgr-section-head">
                <h2>Team Members</h2>
                <span>{members.length} dynamic contributors</span>
              </div>

              {members.length ? (
                <div className="mgr-members">
                  {members.map(member => <MemberRow key={member.id} member={member} />)}
                </div>
              ) : (
                <div className="mgr-empty">
                  <strong>No team members yet</strong>
                  Analyze a repository with registered developer contributors to form the team automatically.
                </div>
              )}

              <div className="mgr-bottom-insights">
                <section className="mgr-panel mgr-text-card">
                  <div className="mgr-panel-head">
                    <div className="mgr-panel-title">
                      <AlertTriangle size={17} strokeWidth={2} />
                      Areas Needing Attention
                    </div>
                  </div>
                  {insights.areas_needing_attention.length ? (
                    <ul className="mgr-text-list">
                      {insights.areas_needing_attention.map((item, index) => (
                        <li key={`${item}-${index}`} className="mgr-text-item">
                          <span className="mgr-text-item-icon" style={{ color: "#f59e0b", background: "rgba(245,158,11,0.14)" }}>
                            <AlertTriangle size={16} strokeWidth={2} />
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mgr-empty">
                      <strong>No attention areas yet</strong>
                      Insights appear after a manager team analysis completes.
                    </div>
                  )}
                </section>

                <section className="mgr-panel mgr-text-card">
                  <div className="mgr-panel-head">
                    <div className="mgr-panel-title">
                      <CheckCircle2 size={17} strokeWidth={2} />
                      Team Strengths
                    </div>
                  </div>
                  {insights.team_strengths.length ? (
                    <ul className="mgr-text-list">
                      {insights.team_strengths.map((item, index) => (
                        <li key={`${item}-${index}`} className="mgr-text-item">
                          <span className="mgr-text-item-icon" style={{ color: "#22c55e", background: "rgba(34,197,94,0.14)" }}>
                            <CheckCircle2 size={16} strokeWidth={2} />
                          </span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mgr-empty">
                      <strong>No strengths yet</strong>
                      Insights appear after a manager team analysis completes.
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </main>
    </DashboardLayout>
  );
}
