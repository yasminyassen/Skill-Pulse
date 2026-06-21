import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Brain,
  CheckCircle2,
  Code2,
  Eye,
  GitBranch,
  Minus,
  Network,
  RefreshCcw,
  Star,
  TrendingUp,
  Trophy,
  Users,
  Wrench,
  X,
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
  period: string;
  label: string;
  average_score: number;
  code_quality: number;
  problem_solving: number;
  architecture: number;
  maintainability: number;
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
  overall_delta: number | null;
}

interface TeamInsights {
  actionable_recommendations?: ActionableRecommendations;
}

interface ActionableRecommendations {
  mandatory: string[];
  highly_required: string[];
  nice_to_have: string[];
  enhanced: string[];
}

interface MemberDetail {
  member: TeamMember;
  timeline: TrendPoint[];
  key_strengths: string[];
  areas_for_improvement: string[];
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

const emptyActionableRecommendations: ActionableRecommendations = {
  mandatory: [],
  highly_required: [],
  nice_to_have: [],
  enhanced: [],
};

const emptyInsights: TeamInsights = {
  actionable_recommendations: emptyActionableRecommendations,
};

const skillMeta = [
  { key: "code_quality", label: "Code Quality", icon: Code2, color: "#6366f1" },
  { key: "problem_solving", label: "Problem Solving", icon: Brain, color: "#06b6d4" },
  { key: "architecture", label: "Architecture", icon: Network, color: "#22c55e" },
  { key: "maintainability", label: "Maintainability", icon: Wrench, color: "#f59e0b" },
] as const;

const scoreLineMeta = [
  { key: "average_score", label: "Overall", color: accent },
  { key: "code_quality", label: "Code Quality", color: "#6366f1" },
  { key: "problem_solving", label: "Problem Solving", color: "#06b6d4" },
  { key: "architecture", label: "Architecture", color: "#22c55e" },
  { key: "maintainability", label: "Maintainability", color: "#f59e0b" },
] as const;

const trendRangeOptions = [
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "6m", label: "6M" },
  { value: "12m", label: "12M" },
  { value: "all", label: "All" },
] as const;

const recommendationSections = [
  {
    key: "mandatory",
    title: "Fix First",
    emptyTitle: "No immediate actions",
    emptyCopy: "Nothing critical is flagged for this view.",
    icon: AlertTriangle,
    color: "#ef4444",
    bg: "rgba(239,68,68,0.13)",
  },
  {
    key: "highly_required",
    title: "Prioritize Next",
    emptyTitle: "No high-priority actions",
    emptyCopy: "Near-term improvement items will appear here.",
    icon: TrendingUp,
    color: "#f59e0b",
    bg: "rgba(245,158,11,0.14)",
  },
  {
    key: "nice_to_have",
    title: "Plan When Possible",
    emptyTitle: "No scheduled improvements",
    emptyCopy: "Useful but non-urgent actions will appear here.",
    icon: CheckCircle2,
    color: "#06b6d4",
    bg: "rgba(6,182,212,0.13)",
  },
  {
    key: "enhanced",
    title: "Strengthen Further",
    emptyTitle: "No polish actions",
    emptyCopy: "Enhancement ideas will appear as the team baseline grows.",
    icon: Star,
    color: "#22c55e",
    bg: "rgba(34,197,94,0.14)",
  },
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

function ScoreDelta({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const rounded = Number(value.toFixed(1));
  const isUp = rounded > 0;
  const isDown = rounded < 0;
  const Icon = isUp ? ArrowUpRight : isDown ? ArrowDownRight : Minus;
  return (
    <span className={`mgr-delta ${isUp ? "mgr-delta-up" : isDown ? "mgr-delta-down" : "mgr-delta-flat"}`}>
      <Icon size={13} strokeWidth={2.4} />
      {isUp ? "+" : ""}{fmtScore(rounded, 1)}
    </span>
  );
}

function MemberRow({
  member,
  onViewDetails,
  showDetails,
}: {
  member: TeamMember;
  onViewDetails: (member: TeamMember) => void;
  showDetails: boolean;
}) {
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
          <div className="mgr-score-stack">
            <strong>{fmtScore(member.average_overall_score)}</strong>
            <ScoreDelta value={member.overall_delta} />
          </div>
          {showDetails && (
            <button className="mgr-detail-button" type="button" onClick={() => onViewDetails(member)}>
              <Eye size={14} strokeWidth={2} />
              View Details
            </button>
          )}
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
  const [selectedTrendRange, setSelectedTrendRange] = useState<string>("6m");
  const [kpis, setKpis] = useState<Kpis>(emptyKpis);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [skills, setSkills] = useState<SkillDistribution>(emptySkills);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [insights, setInsights] = useState<TeamInsights>(emptyInsights);
  const [selectedMemberId, setSelectedMemberId] = useState<number | null>(null);
  const [memberDetail, setMemberDetail] = useState<MemberDetail | null>(null);
  const [loadingMemberDetail, setLoadingMemberDetail] = useState(false);
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
    const trendParams = { ...params, range: selectedTrendRange };

    try {
      const [kpiRes, trendRes, skillRes, memberRes, insightRes] = await Promise.all([
        api.get<Kpis>("/manager/dashboard/kpis", { params }),
        api.get<TrendPoint[]>("/manager/dashboard/trends", { params: trendParams }),
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
  }, [selectedRepoId, selectedTrendRange]);

  useEffect(() => {
    if (selectedRepoId !== "all" && selectedMemberId) {
      closeMemberDetails();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepoId]);

  useEffect(() => {
    if (!selectedMemberId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMemberDetails();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMemberId]);

  const trendData = useMemo(
    () => trends.map(point => ({ ...point, label: point.label || point.period })),
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

  const recommendationGroups = useMemo(() => {
    const source = insights.actionable_recommendations ?? emptyActionableRecommendations;

    return recommendationSections
      .map(section => ({
        ...section,
        items: source[section.key],
      }))
      .filter(group => group.items.length > 0);
  }, [insights]);

  const selectedMember = useMemo(
    () => members.find(member => member.id === selectedMemberId) || memberDetail?.member || null,
    [memberDetail, members, selectedMemberId],
  );

  const memberTimelineData = useMemo(
    () => (memberDetail?.timeline || []).map(point => ({ ...point, label: point.label || point.period })),
    [memberDetail],
  );

  const refreshAll = () => {
    fetchRepos();
    fetchDashboard();
  };

  const openMemberDetails = async (member: TeamMember) => {
    setSelectedMemberId(member.id);
    setMemberDetail(null);
    setLoadingMemberDetail(true);
    const params = { range: selectedTrendRange };

    try {
      const response = await api.get<MemberDetail>(`/manager/dashboard/members/${member.id}/details`, { params });
      setMemberDetail(response.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (err: any) {
      if (err.response?.status === 401) {
        localStorage.clear();
        window.location.href = "/login";
        return;
      }
      setError("Unable to load developer details.");
    } finally {
      setLoadingMemberDetail(false);
    }
  };

  const closeMemberDetails = () => {
    setSelectedMemberId(null);
    setMemberDetail(null);
    setLoadingMemberDetail(false);
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
        .mgr-segmented {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-input);
        }
        .mgr-segmented button {
          min-width: 42px;
          height: 30px;
          border: 0;
          border-radius: 6px;
          background: transparent;
          color: var(--text-muted);
          font: inherit;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
        }
        .mgr-segmented button.active {
          background: rgba(139, 92, 246, 0.18);
          color: var(--text-primary);
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
        .mgr-chart-legend {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-wrap: wrap;
          gap: 10px 14px;
          margin-top: 10px;
          color: var(--text-muted);
          font-size: 12px;
        }
        .mgr-chart-legend span {
          display: inline-flex;
          align-items: center;
          gap: 7px;
        }
        .mgr-chart-legend i {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          display: inline-block;
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
        .mgr-score-stack {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 4px;
        }
        .mgr-delta {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          font-size: 11px;
          font-weight: 900;
          line-height: 1;
        }
        .mgr-delta-up {
          color: #22c55e;
        }
        .mgr-delta-down {
          color: #f87171;
        }
        .mgr-delta-flat {
          color: var(--text-muted);
        }
        .mgr-detail-button {
          height: 32px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          border: 1px solid rgba(139, 92, 246, 0.28);
          border-radius: 8px;
          padding: 0 10px;
          background: rgba(139, 92, 246, 0.1);
          color: var(--text-secondary);
          font: inherit;
          font-size: 12px;
          font-weight: 800;
          cursor: pointer;
          white-space: nowrap;
        }
        .mgr-detail-button:hover {
          border-color: rgba(139, 92, 246, 0.55);
          color: var(--text-primary);
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
        .mgr-detail-panel {
          border-color: rgba(139, 92, 246, 0.28);
        }
        .mgr-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px;
          background: rgba(2, 6, 23, 0.72);
        }
        .mgr-member-modal {
          width: min(1120px, 100%);
          max-height: min(88vh, 920px);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border-radius: 8px;
          border: 1px solid var(--border);
          background: var(--bg-base);
          color: var(--text-primary);
          box-shadow: 0 28px 80px rgba(2, 6, 23, 0.38);
        }
        .mgr-modal-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 28px 30px 24px;
          border-bottom: 1px solid var(--border);
        }
        .mgr-modal-profile {
          display: flex;
          align-items: center;
          gap: 18px;
          min-width: 0;
        }
        .mgr-modal-avatar {
          width: 80px;
          height: 80px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          background: linear-gradient(135deg, #7c3aed, #9333ea);
          color: white;
          font-size: 24px;
          font-weight: 900;
          flex: 0 0 auto;
        }
        .mgr-modal-avatar img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .mgr-modal-profile h2 {
          margin: 0 0 6px;
          color: var(--text-primary);
          font-size: 26px;
          line-height: 1.1;
          letter-spacing: 0;
        }
        .mgr-modal-profile p {
          margin: 0 0 12px;
          color: var(--text-secondary);
          font-size: 16px;
        }
        .mgr-modal-meta {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 9px 12px;
          color: var(--text-muted);
          font-size: 13px;
        }
        .mgr-modal-meta span:first-child {
          border-radius: 8px;
          padding: 4px 10px;
          font-weight: 800;
        }
        .mgr-modal-close {
          width: 36px;
          height: 36px;
          border: 0;
          border-radius: 8px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: transparent;
          color: var(--text-primary);
          cursor: pointer;
        }
        .mgr-modal-close:hover {
          background: var(--bg-card-hover);
        }
        .mgr-modal-body {
          overflow: auto;
          padding: 30px;
          background: var(--bg-base);
        }
        .mgr-overall-card {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 160px;
          gap: 24px;
          align-items: center;
          min-height: 172px;
          margin-bottom: 30px;
          padding: 28px 30px;
          border: 1px solid rgba(139, 92, 246, 0.28);
          border-radius: 8px;
          background: linear-gradient(135deg, rgba(139, 92, 246, 0.13), rgba(6, 182, 212, 0.08));
        }
        .mgr-overall-card span {
          color: var(--text-secondary);
          font-size: 15px;
        }
        .mgr-overall-card strong {
          display: block;
          margin: 12px 0;
          color: var(--text-primary);
          font-size: 56px;
          line-height: 0.95;
          letter-spacing: 0;
        }
        .mgr-overall-mark {
          width: 126px;
          height: 126px;
          border: 9px solid rgba(139, 92, 246, 0.24);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #4f46e5;
          background: var(--bg-card);
          justify-self: end;
        }
        .mgr-modal-section-title {
          margin: 0 0 16px;
          color: var(--text-primary);
          font-size: 21px;
          letter-spacing: 0;
        }
        .mgr-skill-card-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 30px;
        }
        .mgr-skill-card {
          min-height: 118px;
          padding: 22px 20px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-input);
        }
        .mgr-skill-card > div {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 22px;
        }
        .mgr-skill-card span {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
          color: var(--text-primary);
          font-size: 15px;
          font-weight: 800;
        }
        .mgr-skill-card svg {
          color: #4f46e5;
        }
        .mgr-skill-card strong {
          color: var(--text-primary);
          font-size: 24px;
          line-height: 1;
        }
        .mgr-skill-card .mgr-progress {
          background: var(--border);
        }
        .mgr-modal-chart-card {
          padding: 22px 22px 24px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg-input);
        }
        .mgr-member-modal .mgr-chart-legend {
          color: var(--text-muted);
        }
        .mgr-modal-chart-card .mgr-empty {
          border-color: var(--border-hover);
          background: var(--bg-card);
          color: var(--text-muted);
        }
        .mgr-modal-insights {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 18px;
          margin-top: 28px;
        }
        .mgr-modal-insight-card {
          min-height: 180px;
          padding: 24px 26px;
          border-radius: 8px;
        }
        .mgr-modal-insight-card h3 {
          margin: 0 0 18px;
          font-size: 20px;
          letter-spacing: 0;
        }
        .mgr-modal-insight-card ul {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin: 0;
          padding-left: 18px;
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.45;
        }
        .mgr-modal-strength {
          border: 1px solid rgba(34, 197, 94, 0.3);
          background: rgba(34, 197, 94, 0.1);
        }
        .mgr-modal-strength h3 {
          color: #22c55e;
        }
        .mgr-modal-improvement {
          border: 1px solid rgba(245, 158, 11, 0.32);
          background: rgba(245, 158, 11, 0.1);
        }
        .mgr-modal-improvement h3 {
          color: #f59e0b;
        }
        .mgr-detail-insights {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 16px;
          margin-top: 18px;
        }
        .mgr-detail-insights h3 {
          margin: 0 0 10px;
          color: var(--text-primary);
          font-size: 14px;
          letter-spacing: 0;
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
          .mgr-bottom-insights,
          .mgr-detail-insights,
          .mgr-skill-card-grid,
          .mgr-modal-insights {
            grid-template-columns: 1fr;
          }
          .mgr-panel-head {
            align-items: flex-start;
            flex-direction: column;
          }
          .mgr-segmented {
            width: 100%;
            justify-content: space-between;
          }
          .mgr-segmented button {
            flex: 1;
          }
          .mgr-member-main {
            grid-template-columns: 44px minmax(0, 1fr);
          }
          .mgr-member-score {
            grid-column: 1 / -1;
            justify-self: stretch;
            justify-content: space-between;
            flex-wrap: wrap;
          }
          .mgr-member-foot {
            align-items: flex-start;
            flex-direction: column;
          }
          .mgr-modal-backdrop {
            align-items: stretch;
            padding: 12px;
          }
          .mgr-member-modal {
            max-height: 100%;
          }
          .mgr-modal-header,
          .mgr-modal-body {
            padding: 20px;
          }
          .mgr-modal-profile {
            align-items: flex-start;
          }
          .mgr-modal-avatar {
            width: 62px;
            height: 62px;
            font-size: 19px;
          }
          .mgr-overall-card {
            grid-template-columns: 1fr;
            padding: 22px;
          }
          .mgr-overall-mark {
            justify-self: start;
            width: 96px;
            height: 96px;
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
                  <div className="mgr-segmented" aria-label="Trend range">
                    {trendRangeOptions.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        className={selectedTrendRange === option.value ? "active" : ""}
                        onClick={() => setSelectedTrendRange(option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
                {trendData.length ? (
                  <>
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
                            formatter={(value: unknown, name: unknown) => {
                              const meta = scoreLineMeta.find(item => item.key === name);
                              return [fmtScore(Number(value), 1), meta?.label || String(name)];
                            }}
                          />
                          {scoreLineMeta.map(line => (
                            <Line
                              key={line.key}
                              type="monotone"
                              dataKey={line.key}
                              stroke={line.color}
                              strokeWidth={line.key === "average_score" ? 3 : 2}
                              dot={{ r: 3, strokeWidth: 2, fill: "var(--bg-base)", stroke: line.color }}
                              activeDot={{ r: 5, strokeWidth: 0, fill: line.color }}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mgr-chart-legend">
                      {scoreLineMeta.map(line => (
                        <span key={line.key}>
                          <i style={{ background: line.color }} />
                          {line.label}
                        </span>
                      ))}
                    </div>
                  </>
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
                  {members.map(member => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      onViewDetails={openMemberDetails}
                      showDetails={selectedRepoId === "all"}
                    />
                  ))}
                </div>
              ) : (
                <div className="mgr-empty">
                  <strong>No team members yet</strong>
                  Analyze a repository with registered developer contributors to form the team automatically.
                </div>
              )}

              {recommendationGroups.length > 0 && (
                <>
                  <div className="mgr-section-head">
                    <h2>Actionable Recommendations</h2>
                    <span>Prioritized team next moves</span>
                  </div>

                  <div className="mgr-bottom-insights">
                    {recommendationGroups.map(group => {
                      const Icon = group.icon;
                      return (
                        <section key={group.key} className="mgr-panel mgr-text-card">
                          <div className="mgr-panel-head">
                            <div className="mgr-panel-title">
                              <Icon size={17} strokeWidth={2} />
                              {group.title}
                            </div>
                          </div>
                          <ul className="mgr-text-list">
                            {group.items.map((item, index) => (
                              <li key={`${item}-${index}`} className="mgr-text-item">
                                <span className="mgr-text-item-icon" style={{ color: group.color, background: group.bg }}>
                                  <Icon size={16} strokeWidth={2} />
                                </span>
                                <span>{item}</span>
                              </li>
                            ))}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {selectedMemberId && createPortal((
          <div className="mgr-modal-backdrop" role="presentation" onMouseDown={closeMemberDetails}>
            <section
              className="mgr-member-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Developer performance details"
              onMouseDown={event => event.stopPropagation()}
            >
              <div className="mgr-modal-header">
                <div className="mgr-modal-profile">
                  <div className="mgr-modal-avatar">
                    {selectedMember?.avatar_url ? <img src={selectedMember.avatar_url} alt="" /> : initials(selectedMember?.full_name || "SP")}
                  </div>
                  <div>
                    <h2>{selectedMember?.full_name || "Developer Details"}</h2>
                    <p>{specializationLabel(selectedMember?.specialization || null)}</p>
                    <div className="mgr-modal-meta">
                      {selectedMember && (
                        <>
                          <span style={{ color: scoreBadge(selectedMember.average_overall_score).color, background: scoreBadge(selectedMember.average_overall_score).bg }}>
                            {scoreBadge(selectedMember.average_overall_score).label}
                          </span>
                          <span>{selectedMember.repository_count} repositories</span>
                          <span>{selectedMember.analysis_count} snapshots</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <button className="mgr-modal-close" type="button" onClick={closeMemberDetails} title="Close details">
                  <X size={20} strokeWidth={2} />
                </button>
              </div>

              <div className="mgr-modal-body">
                {selectedMember && (
                  <section className="mgr-overall-card">
                    <div>
                      <span>Overall Performance Score</span>
                      <strong>{fmtScore(selectedMember.average_overall_score)}</strong>
                      <ScoreDelta value={selectedMember.overall_delta} />
                    </div>
                    <div className="mgr-overall-mark">
                      <Trophy size={48} strokeWidth={1.8} />
                    </div>
                  </section>
                )}

                <section>
                  <h3 className="mgr-modal-section-title">Skill Breakdown</h3>
                  {selectedMember && (
                    <div className="mgr-skill-card-grid">
                      {skillMeta.map(skill => {
                        const Icon = skill.icon;
                        const value = selectedMember[skill.key];
                        return (
                          <article key={skill.key} className="mgr-skill-card">
                            <div>
                              <span>
                                <Icon size={16} strokeWidth={2} />
                                {skill.label}
                              </span>
                              <strong>{fmtScore(value)}</strong>
                            </div>
                            <ProgressBar value={value} color={skill.color} />
                          </article>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="mgr-modal-chart-card">
                  <h3 className="mgr-modal-section-title">Performance Timeline</h3>
                  {loadingMemberDetail ? (
                    <div className="mgr-skeleton" style={{ height: 280, borderRadius: 8 }} />
                  ) : memberDetail && memberTimelineData.length ? (
                    <>
                      <div className="mgr-chart" style={{ height: 280 }}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={memberTimelineData} margin={{ top: 10, right: 16, left: 0, bottom: 8 }}>
                            <CartesianGrid stroke="var(--border)" strokeDasharray="4 4" />
                            <XAxis dataKey="label" tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-hover)" }} tickLine={false} />
                            <YAxis domain={[0, 100]} tick={{ fill: "var(--text-muted)", fontSize: 12 }} axisLine={{ stroke: "var(--border-hover)" }} tickLine={false} width={34} />
                            <Tooltip
                              cursor={{ stroke: "rgba(99,102,241,0.35)" }}
                              contentStyle={{
                                background: "var(--tooltip-bg)",
                                border: "1px solid var(--tooltip-border)",
                                borderRadius: 8,
                                color: "var(--text-primary)",
                              }}
                              formatter={(value: unknown, name: unknown) => {
                                const meta = scoreLineMeta.find(item => item.key === name);
                                return [fmtScore(Number(value), 1), meta?.label || String(name)];
                              }}
                            />
                            {scoreLineMeta.map(line => (
                              <Line
                                key={line.key}
                                type="monotone"
                                dataKey={line.key}
                                stroke={line.color}
                                strokeWidth={line.key === "average_score" ? 3 : 2}
                                dot={{ r: 3, strokeWidth: 2, fill: "var(--bg-card)", stroke: line.color }}
                                activeDot={{ r: 5, strokeWidth: 0, fill: line.color }}
                              />
                            ))}
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mgr-chart-legend mgr-chart-legend-centered">
                        {scoreLineMeta.map(line => (
                          <span key={line.key}>
                            <i style={{ background: line.color }} />
                            {line.label}
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="mgr-empty">
                      <strong>No performance timeline yet</strong>
                      More score snapshots are needed to draw this developer's trend.
                    </div>
                  )}
                </section>

                {memberDetail && (memberDetail.key_strengths.length > 0 || memberDetail.areas_for_improvement.length > 0) && (
                  <section className="mgr-modal-insights">
                    {memberDetail.key_strengths.length > 0 && (
                      <div className="mgr-modal-insight-card mgr-modal-strength">
                        <h3>Key Strengths</h3>
                        <ul>
                          {memberDetail.key_strengths.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {memberDetail.areas_for_improvement.length > 0 && (
                      <div className="mgr-modal-insight-card mgr-modal-improvement">
                        <h3>Areas for Improvement</h3>
                        <ul>
                          {memberDetail.areas_for_improvement.map((item, index) => (
                            <li key={`${item}-${index}`}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </section>
          </div>
        ), document.body)}
      </main>
    </DashboardLayout>
  );
}
