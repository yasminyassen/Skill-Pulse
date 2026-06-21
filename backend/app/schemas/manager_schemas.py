from datetime import datetime

from pydantic import BaseModel, Field


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
    period: str
    label: str
    average_score: float
    code_quality: float
    problem_solving: float
    architecture: float
    maintainability: float


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
    overall_delta: float | None = None


class ManagerActionableRecommendations(BaseModel):
    mandatory: list[str] = Field(default_factory=list)
    highly_required: list[str] = Field(default_factory=list)
    nice_to_have: list[str] = Field(default_factory=list)
    enhanced: list[str] = Field(default_factory=list)


class ManagerTeamInsights(BaseModel):
    actionable_recommendations: ManagerActionableRecommendations = Field(
        default_factory=ManagerActionableRecommendations
    )


class ManagerMemberDetail(BaseModel):
    member: ManagerTeamMember
    timeline: list[ManagerTrendPoint] = Field(default_factory=list)
    key_strengths: list[str] = Field(default_factory=list)
    areas_for_improvement: list[str] = Field(default_factory=list)
