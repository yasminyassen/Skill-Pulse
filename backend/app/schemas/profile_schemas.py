from datetime import datetime
from typing import Any

from pydantic import BaseModel, EmailStr, Field


class ProfileResponse(BaseModel):
    id: int
    full_name: str
    username: str
    email: str
    role: str | None = None
    avatar_url: str | None = None
    github_login: str | None = None
    github_connected: bool = False
    has_password: bool = False
    organization: str | None = None
    department: str | None = None
    job_title: str | None = None
    member_since: datetime | None = None


class ProfileUpdateRequest(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=100)
    email: EmailStr | None = None
    avatar_url: str | None = Field(default=None, max_length=500)
    organization: str | None = Field(default=None, max_length=150)
    department: str | None = Field(default=None, max_length=150)
    job_title: str | None = Field(default=None, max_length=150)


class ChangePasswordCodeRequest(BaseModel):
    current_password: str = Field(..., min_length=1)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)
    verification_code: str = Field(..., min_length=6, max_length=6)


# للـ GitHub users اللي معندهمش password
class SetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8)
    verification_code: str = Field(..., min_length=6, max_length=6)


class DeleteAccountRequest(BaseModel):
    confirm_email: EmailStr
    password: str = Field(..., min_length=1)


class ProfileTeamOverview(BaseModel):
    team_members: int
    repositories: int
    ongoing_analyses: int
    team_health: float


class ProfileActivity(BaseModel):
    id: str
    icon: str
    title: str
    description: str
    created_at: datetime
    time_ago: str


class InviteTeamMemberRequest(BaseModel):
    email: EmailStr
    specialization: str | None = Field(default=None, pattern="^(backend|frontend|qa)$")


class UpdateMemberSpecializationRequest(BaseModel):
    specialization: str = Field(..., pattern="^(backend|frontend|qa)$")


class ProfileTeamMember(BaseModel):
    id: int | None = None
    invite_id: int | None = None
    full_name: str
    username: str | None = None
    email: str
    avatar_url: str | None = None
    specialization: str | None = None
    status: str
    repository_count: int = 0
    analysis_count: int = 0
    average_overall_score: float = 0


class MessageResponse(BaseModel):
    message: str
    data: dict[str, Any] | None = None
