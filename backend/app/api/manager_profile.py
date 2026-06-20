from __future__ import annotations

import secrets
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.auth_utils import has_usable_password_hash, hash_password, require_role, verify_password
from app.db.database import get_db
from app.db.models import (
    AnalysisRun,
    CodeMetrics,
    DeveloperSpecialization,
    ManagerTeamInvite,
    ManagerTeamMember as ManagerTeamMemberModel,
    ProfileActivityLog,
    RecruiterCandidate,
    Repository,
    RepositoryAnalysis,
    RepositoryContributor,
    RequirementDocument,
    RefreshToken,
    SecurityFinding,
    SkillScore,
    TechnicalTask,
    User,
    UserStory,
    UserRole,
)
from app.services.email_service import EmailDeliveryError, send_verification_email
from app.schemas.profile_schemas import (
    ChangePasswordCodeRequest,
    ChangePasswordRequest,
    DeleteAccountRequest,
    InviteTeamMemberRequest,
    MessageResponse,
    ProfileActivity,
    ProfileResponse,
    ProfileTeamMember,
    ProfileTeamOverview,
    ProfileUpdateRequest,
    SetPasswordRequest,
    UpdateMemberSpecializationRequest,
)


router = APIRouter(prefix="/manager/profile", tags=["manager-profile"])

ScoreRow = tuple[SkillScore, AnalysisRun, Repository, User]


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _avg(values: Iterable[float]) -> float:
    values = list(values)
    return sum(values) / len(values) if values else 0.0


def _round_score(value: float) -> float:
    return round(value, 2)


def _time_ago(value: datetime | None) -> str:
    if not value:
        return "just now"
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - value
    seconds = max(0, int(delta.total_seconds()))
    if seconds < 60:
        return "just now"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes} min ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours} hr ago"
    days = hours // 24
    if days < 30:
        return f"{days} days ago"
    months = days // 30
    if months < 12:
        return f"{months} mo ago"
    return f"{months // 12} yr ago"


def _get_github_login(db: Session, user: User) -> str | None:
    if not user.github_access_token:
        return None
    run = (
        db.query(AnalysisRun.contributor_login)
        .filter(
            AnalysisRun.user_id == user.id,
            AnalysisRun.contributor_login.isnot(None),
        )
        .order_by(AnalysisRun.triggered_at.desc())
        .first()
    )
    return run.contributor_login if run else None


def _query_manager_score_rows(db: Session, manager_id: int) -> list[ScoreRow]:
    return (
        db.query(SkillScore, AnalysisRun, Repository, User)
        .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .join(User, SkillScore.user_id == User.id)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.status == "completed",
            User.role == UserRole.developer,
        )
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.triggered_at.desc())
        .all()
    )


def _developer_average_scores(rows: list[ScoreRow]) -> dict[int, float]:
    grouped: dict[int, list[float]] = defaultdict(list)
    for score, _, _, user in rows:
        grouped[user.id].append(_safe_float(score.overall_score))
    return {user_id: _avg(scores) for user_id, scores in grouped.items()}


def _explicit_status_by_member(db: Session, manager_id: int) -> dict[int, str]:
    return {
        row.user_id: row.status
        for row in db.query(ManagerTeamMemberModel)
        .filter(ManagerTeamMemberModel.manager_id == manager_id)
        .all()
    }


def _team_member_ids(db: Session, manager_id: int) -> set[int]:
    rows = _query_manager_score_rows(db, manager_id)
    ids = {user.id for _, _, _, user in rows}
    links = (
        db.query(ManagerTeamMemberModel)
        .filter(ManagerTeamMemberModel.manager_id == manager_id)
        .all()
    )
    for link in links:
        if link.status == "active":
            ids.add(link.user_id)
        elif link.status == "removed":
            ids.discard(link.user_id)
    return ids


def _log_activity(
    db: Session,
    manager_id: int,
    actor_id: int | None,
    activity_type: str,
    title: str,
    description: str,
    member_id: int | None = None,
    metadata: dict | None = None,
) -> None:
    db.add(
        ProfileActivityLog(
            manager_id=manager_id,
            actor_id=actor_id,
            member_id=member_id,
            activity_type=activity_type,
            title=title,
            description=description,
            metadata_json=metadata,
        )
    )


def _profile_response(db: Session, current_user: User) -> ProfileResponse:
    return ProfileResponse(
        id=current_user.id,
        full_name=current_user.full_name or "",
        username=current_user.username or "",
        email=current_user.work_email or "",
        role=current_user.role.value if current_user.role else None,
        avatar_url=current_user.avatar_url,
        github_login=_get_github_login(db, current_user),
        github_connected=bool(current_user.github_access_token),
        has_password=has_usable_password_hash(current_user.hashed_password),
        organization=current_user.organization,
        department=current_user.department,
        job_title=current_user.job_title,
        member_since=current_user.created_at,
    )


def _ensure_password_login_configured(current_user: User) -> None:
    if has_usable_password_hash(current_user.hashed_password):
        return
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=(
            "This account does not have a usable password hash. "
            "Use the forgot-password flow to set a new password."
        ),
    )


@router.get("", response_model=ProfileResponse)
def get_manager_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    return _profile_response(db, current_user)


@router.patch("", response_model=ProfileResponse)
def update_manager_profile(
    data: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    updates = data.dict(exclude_unset=True)
    if not updates:
        raise HTTPException(status_code=422, detail="No fields provided to update")

    if "email" in updates and updates["email"] != current_user.work_email:
        exists = (
            db.query(User)
            .filter(User.work_email == updates["email"], User.id != current_user.id)
            .first()
        )
        if exists:
            raise HTTPException(status_code=400, detail="Email already registered")
        current_user.work_email = updates["email"]

    for field in ("full_name", "avatar_url", "organization", "department", "job_title"):
        if field in updates:
            value = updates[field]
            setattr(current_user, field, value.strip() or None if isinstance(value, str) else value)

    if not current_user.full_name:
        raise HTTPException(status_code=422, detail="full_name cannot be empty")

    _log_activity(
        db,
        current_user.id,
        current_user.id,
        "profile_updated",
        "Profile updated",
        "Manager account details were updated.",
    )
    db.commit()
    db.refresh(current_user)
    return _profile_response(db, current_user)


# ─── Set Password (GitHub users only) ────────────────────────────────────────

@router.post("/set-password/request-code", response_model=MessageResponse)
async def request_set_password_code(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    """للـ GitHub users اللي معندهمش password — يطلبوا كود عشان يحددوا password."""
    if has_usable_password_hash(current_user.hashed_password):
        raise HTTPException(
            status_code=400,
            detail="Account already has a password. Use change-password instead.",
        )

    code = f"{secrets.randbelow(1_000_000):06d}"
    current_user.verification_code = code
    current_user.reset_password_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.commit()

    try:
        await send_verification_email(current_user.work_email, code)
    except EmailDeliveryError:
        return MessageResponse(
            message="Email delivery failed; use the returned verification code for local testing",
            data={"verification_code": code, "email_delivery": "failed"},
        )

    return MessageResponse(message="Verification code sent to your email")


@router.post("/set-password", response_model=MessageResponse)
def set_manager_password(
    data: SetPasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    """للـ GitHub users اللي معندهمش password — يحددوا password لأول مرة."""
    if has_usable_password_hash(current_user.hashed_password):
        raise HTTPException(
            status_code=400,
            detail="Account already has a password. Use change-password instead.",
        )

    expires_at = current_user.reset_password_expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if (
        not current_user.verification_code
        or current_user.verification_code != data.verification_code
        or not expires_at
        or expires_at < datetime.now(timezone.utc)
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    current_user.hashed_password = hash_password(data.new_password)
    current_user.verification_code = None
    current_user.reset_password_expires_at = None
    _log_activity(
        db,
        current_user.id,
        current_user.id,
        "password_set",
        "Password set",
        "Account password was set for the first time.",
    )
    db.commit()
    return MessageResponse(message="Password set successfully")


# ─── Change Password (password users only) ───────────────────────────────────

@router.post("/change-password/request-code", response_model=MessageResponse)
async def request_manager_password_change_code(
    data: ChangePasswordCodeRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    _ensure_password_login_configured(current_user)
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    code = f"{secrets.randbelow(1_000_000):06d}"
    current_user.verification_code = code
    current_user.reset_password_expires_at = datetime.now(timezone.utc) + timedelta(minutes=10)
    db.commit()

    try:
        await send_verification_email(current_user.work_email, code)
    except EmailDeliveryError:
        return MessageResponse(
            message="Email delivery failed; use the returned verification code for local testing",
            data={"verification_code": code, "email_delivery": "failed"},
        )

    return MessageResponse(message="Verification code sent to your email")


@router.post("/change-password", response_model=MessageResponse)
def change_manager_password(
    data: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    _ensure_password_login_configured(current_user)
    if not verify_password(data.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if data.current_password == data.new_password:
        raise HTTPException(status_code=400, detail="New password must be different")

    expires_at = current_user.reset_password_expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if (
        not current_user.verification_code
        or current_user.verification_code != data.verification_code
        or not expires_at
        or expires_at < datetime.now(timezone.utc)
    ):
        raise HTTPException(status_code=400, detail="Invalid or expired verification code")

    current_user.hashed_password = hash_password(data.new_password)
    current_user.verification_code = None
    current_user.reset_password_expires_at = None
    _log_activity(
        db,
        current_user.id,
        current_user.id,
        "password_changed",
        "Password changed",
        "Account password was updated.",
    )
    db.commit()
    return MessageResponse(message="Password changed successfully")


# ─── Delete Account ───────────────────────────────────────────────────────────

def _do_delete_account(
    data: DeleteAccountRequest,
    db: Session,
    current_user: User,
) -> MessageResponse:
    if data.confirm_email.lower() != (current_user.work_email or "").lower():
        raise HTTPException(status_code=400, detail="Confirmation email does not match")

    # GitHub users لازم يكون عندهم password اتحدد الأول
    _ensure_password_login_configured(current_user)

    if not verify_password(data.password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Password is incorrect")

    user_id = current_user.id
    run_ids = [
        row.id
        for row in db.query(AnalysisRun.id)
        .filter(AnalysisRun.user_id == user_id)
        .all()
    ]

    if run_ids:
        db.query(RepositoryAnalysis).filter(RepositoryAnalysis.last_run_id.in_(run_ids)).update(
            {RepositoryAnalysis.last_run_id: None},
            synchronize_session=False,
        )
        db.query(RecruiterCandidate).filter(RecruiterCandidate.analysis_run_id.in_(run_ids)).delete(
            synchronize_session=False
        )
        db.query(CodeMetrics).filter(CodeMetrics.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SecurityFinding).filter(SecurityFinding.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SkillScore).filter(SkillScore.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(AnalysisRun).filter(AnalysisRun.id.in_(run_ids)).delete(synchronize_session=False)

    uploaded_doc_ids = [
        row.id
        for row in db.query(RequirementDocument.id)
        .filter(RequirementDocument.uploaded_by_id == user_id)
        .all()
    ]
    if uploaded_doc_ids:
        story_ids = [
            row.id
            for row in db.query(UserStory.id)
            .filter(UserStory.document_id.in_(uploaded_doc_ids))
            .all()
        ]
        if story_ids:
            db.query(TechnicalTask).filter(TechnicalTask.story_id.in_(story_ids)).delete(synchronize_session=False)
            db.query(UserStory).filter(UserStory.id.in_(story_ids)).delete(synchronize_session=False)
        db.query(RequirementDocument).filter(RequirementDocument.id.in_(uploaded_doc_ids)).delete(
            synchronize_session=False
        )

    db.query(TechnicalTask).filter(TechnicalTask.assigned_to == user_id).update(
        {TechnicalTask.assigned_to: None},
        synchronize_session=False,
    )
    db.query(RepositoryAnalysis).filter(RepositoryAnalysis.user_id == user_id).delete(synchronize_session=False)
    db.query(RepositoryContributor).filter(RepositoryContributor.user_id == user_id).delete(synchronize_session=False)
    db.query(RefreshToken).filter(RefreshToken.user_id == user_id).delete(synchronize_session=False)
    db.query(SkillScore).filter(SkillScore.user_id == user_id).delete(synchronize_session=False)

    db.query(ManagerTeamMemberModel).filter(
        or_(
            ManagerTeamMemberModel.manager_id == user_id,
            ManagerTeamMemberModel.user_id == user_id,
        )
    ).delete(synchronize_session=False)
    db.query(ManagerTeamInvite).filter(ManagerTeamInvite.manager_id == user_id).delete(synchronize_session=False)
    db.query(ProfileActivityLog).filter(ProfileActivityLog.manager_id == user_id).delete(synchronize_session=False)
    db.query(ProfileActivityLog).filter(ProfileActivityLog.actor_id == user_id).update(
        {ProfileActivityLog.actor_id: None},
        synchronize_session=False,
    )
    db.query(ProfileActivityLog).filter(ProfileActivityLog.member_id == user_id).update(
        {ProfileActivityLog.member_id: None},
        synchronize_session=False,
    )

    db.delete(current_user)
    db.commit()
    return MessageResponse(message="Account deleted successfully")


@router.delete("", response_model=MessageResponse)
def delete_manager_account(
    data: DeleteAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    return _do_delete_account(data, db, current_user)


@router.post("/delete-account", response_model=MessageResponse)
def delete_manager_account_post(
    data: DeleteAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    return _do_delete_account(data, db, current_user)


# ─── Team Overview ────────────────────────────────────────────────────────────

@router.get("/team-overview", response_model=ProfileTeamOverview)
def get_team_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id)
    active_member_ids = _team_member_ids(db, current_user.id)
    repository_count = len({run.repository_id for _, run, _, _ in rows})
    ongoing_count = (
        db.query(func.count(AnalysisRun.id))
        .filter(
            AnalysisRun.user_id == current_user.id,
            AnalysisRun.status.in_(["pending", "running", "processing", "in_progress"]),
        )
        .scalar()
        or 0
    )
    score_by_member = _developer_average_scores(
        [row for row in rows if row[3].id in active_member_ids]
    )

    return ProfileTeamOverview(
        team_members=len(active_member_ids),
        repositories=repository_count,
        ongoing_analyses=int(ongoing_count),
        team_health=_round_score(_avg(score_by_member.values())),
    )


@router.get("/activities", response_model=list[ProfileActivity])
def get_profile_activities(
    limit: int = Query(default=6, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    log_rows = (
        db.query(ProfileActivityLog)
        .filter(ProfileActivityLog.manager_id == current_user.id)
        .order_by(ProfileActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
    activities: list[ProfileActivity] = [
        ProfileActivity(
            id=f"log-{row.id}",
            icon=row.activity_type,
            title=row.title,
            description=row.description,
            created_at=row.created_at,
            time_ago=_time_ago(row.created_at),
        )
        for row in log_rows
    ]

    remaining = max(0, limit - len(activities))
    if remaining:
        recent_runs = (
            db.query(AnalysisRun, Repository)
            .join(Repository, Repository.id == AnalysisRun.repository_id)
            .filter(AnalysisRun.user_id == current_user.id)
            .order_by(AnalysisRun.triggered_at.desc())
            .limit(remaining)
            .all()
        )
        for run, repo in recent_runs:
            created_at = run.completed_at or run.triggered_at
            title = "Analysis completed" if run.status == "completed" else "Analysis started"
            activities.append(
                ProfileActivity(
                    id=f"run-{run.id}",
                    icon="analysis",
                    title=title,
                    description=f"{repo.full_name or repo.name or 'Repository'} on {run.branch or 'main'}",
                    created_at=created_at,
                    time_ago=_time_ago(created_at),
                )
            )

    return sorted(activities, key=lambda item: item.created_at or datetime.min, reverse=True)[:limit]


@router.get("/team-members", response_model=list[ProfileTeamMember])
def get_team_members(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id)
    by_user: dict[int, list[ScoreRow]] = defaultdict(list)
    for row in rows:
        by_user[row[3].id].append(row)

    status_by_member = _explicit_status_by_member(db, current_user.id)
    active_ids = _team_member_ids(db, current_user.id)
    users = db.query(User).filter(User.id.in_(active_ids)).all() if active_ids else []
    result: list[ProfileTeamMember] = []

    for user in users:
        user_rows = by_user.get(user.id, [])
        score_rows = [row[0] for row in user_rows]
        repo_ids = {row[1].repository_id for row in user_rows}
        result.append(
            ProfileTeamMember(
                id=user.id,
                full_name=user.full_name,
                username=user.username,
                email=user.work_email,
                avatar_url=user.avatar_url,
                specialization=user.specialization.value if user.specialization else None,
                status=status_by_member.get(user.id, "active"),
                repository_count=len(repo_ids),
                analysis_count=len(score_rows),
                average_overall_score=_round_score(_avg(_safe_float(score.overall_score) for score in score_rows)),
            )
        )

    invites = (
        db.query(ManagerTeamInvite)
        .filter(
            ManagerTeamInvite.manager_id == current_user.id,
            ManagerTeamInvite.status == "pending",
        )
        .order_by(ManagerTeamInvite.created_at.desc())
        .all()
    )
    result.extend(
        ProfileTeamMember(
            invite_id=invite.id,
            full_name=invite.email.split("@")[0],
            email=invite.email,
            specialization=invite.specialization,
            status="pending",
        )
        for invite in invites
    )

    return sorted(result, key=lambda member: (member.status != "active", member.full_name.lower()))


@router.post("/team-members/invite", response_model=MessageResponse, status_code=status.HTTP_201_CREATED)
def invite_team_member(
    data: InviteTeamMemberRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    existing_user = (
        db.query(User)
        .filter(User.work_email.ilike(data.email), User.role == UserRole.developer)
        .first()
    )
    if existing_user:
        link = (
            db.query(ManagerTeamMemberModel)
            .filter(
                ManagerTeamMemberModel.manager_id == current_user.id,
                ManagerTeamMemberModel.user_id == existing_user.id,
            )
            .first()
        )
        if not link:
            db.add(ManagerTeamMemberModel(manager_id=current_user.id, user_id=existing_user.id, status="active"))
        else:
            link.status = "active"
        if data.specialization:
            existing_user.specialization = DeveloperSpecialization(data.specialization)
        _log_activity(
            db,
            current_user.id,
            current_user.id,
            "member_added",
            "Team member added",
            f"{existing_user.full_name} was added to the manager team.",
            member_id=existing_user.id,
        )
        db.commit()
        return MessageResponse(message="Existing developer added to team")

    invite = ManagerTeamInvite(
        manager_id=current_user.id,
        email=data.email,
        specialization=data.specialization,
        status="pending",
    )
    db.add(invite)
    _log_activity(
        db,
        current_user.id,
        current_user.id,
        "member_invited",
        "Invitation created",
        f"Invitation prepared for {data.email}.",
    )
    db.commit()
    return MessageResponse(message="Invitation saved")


@router.patch("/team-members/{member_id}/specialization", response_model=ProfileTeamMember)
def update_member_specialization(
    member_id: int,
    data: UpdateMemberSpecializationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    if member_id not in _team_member_ids(db, current_user.id):
        raise HTTPException(status_code=404, detail="Team member not found")
    member = db.query(User).filter(User.id == member_id, User.role == UserRole.developer).first()
    if not member:
        raise HTTPException(status_code=404, detail="Team member not found")

    member.specialization = DeveloperSpecialization(data.specialization)
    _log_activity(
        db,
        current_user.id,
        current_user.id,
        "specialization_updated",
        "Specialization updated",
        f"{member.full_name} is now marked as {data.specialization}.",
        member_id=member.id,
    )
    db.commit()
    db.refresh(member)
    return ProfileTeamMember(
        id=member.id,
        full_name=member.full_name,
        username=member.username,
        email=member.work_email,
        avatar_url=member.avatar_url,
        specialization=member.specialization.value if member.specialization else None,
        status="active",
    )


@router.delete("/team-members/{member_id}", response_model=MessageResponse)
def remove_team_member(
    member_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    if member_id not in _team_member_ids(db, current_user.id):
        raise HTTPException(status_code=404, detail="Team member not found")
    member = db.query(User).filter(User.id == member_id).first()
    link = (
        db.query(ManagerTeamMemberModel)
        .filter(
            ManagerTeamMemberModel.manager_id == current_user.id,
            ManagerTeamMemberModel.user_id == member_id,
        )
        .first()
    )
    if not link:
        link = ManagerTeamMemberModel(manager_id=current_user.id, user_id=member_id, status="removed")
        db.add(link)
    else:
        link.status = "removed"
    _log_activity(
        db,
        current_user.id,
        current_user.id,
        "member_removed",
        "Team member removed",
        f"{member.full_name if member else 'A developer'} was removed from the manager team.",
        member_id=member_id,
    )
    db.commit()
    return MessageResponse(message="Team member removed")
