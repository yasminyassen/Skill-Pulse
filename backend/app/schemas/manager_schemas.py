from datetime import datetime

from pydantic import BaseModel


class ManagerDashboardRepo(BaseModel):
    id: int
    name: str | None = None
    full_name: str | None = None
    is_private: bool = False
    last_analyzed_at: datetime | None = None
    analysis_count: int = 0
    member_count: int = 0


class ManagerTopPerformer(BaseModel):
    id: int
    full_name: str
    username: str
    average_score: float


class ManagerKpis(BaseModel):
    team_average_score: float
    team_size: int
    top_performer: ManagerTopPerformer | None = None
    growth_rate: float


class ManagerTrendPoint(BaseModel):
    month: str
    average_score: float


class ManagerSkillDistribution(BaseModel):
    code_quality: float
    problem_solving: float
    architecture: float
    maintainability: float


class ManagerTeamMember(BaseModel):
    id: int
    full_name: str
    username: str
    email: str
    avatar_url: str | None = None
    specialization: str | None = None
    average_overall_score: float
    code_quality: float
    problem_solving: float
    architecture: float
    maintainability: float
    repository_count: int
    analysis_count: int


class ManagerTeamInsights(BaseModel):
    team_strengths: list[str]
    areas_needing_attention: list[str]
