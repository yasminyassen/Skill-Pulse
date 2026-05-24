import sys
import os

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.db.database import get_db
from app.db.models import (
    User, AnalysisRun, Repository, SkillScore,
    RecruiterCandidate, RepositoryAnalysis,
)
from app.core.auth_utils import get_current_user

router = APIRouter(prefix="/recruiter", tags=["recruiter"])


def compute_weighted_score(score: SkillScore, recruiter: User) -> float:
    w_code    = (recruiter.weight_code_quality if recruiter.weight_code_quality is not None else 40) / 100.0
    w_sec     = (recruiter.weight_security     if recruiter.weight_security     is not None else 30) / 100.0
    w_problem = (recruiter.weight_git_activity if recruiter.weight_git_activity is not None else 30) / 100.0

    total_weight = w_code + w_sec + w_problem
    if total_weight == 0:
        return float(score.overall_score or 0.0)

    weighted = (
        (score.code_quality_score       or 0.0) * w_code    +
        (score.security_awareness_score or 0.0) * w_sec     +
        (score.problem_solving_score    or 0.0) * w_problem
    )
    return round(weighted / total_weight, 1)


def _require_recruiter(current_user: User) -> User:
    if not current_user.role or current_user.role.value != "recruiter":
        raise HTTPException(status_code=403, detail="Recruiter access required.")
    return current_user


class UpdateRecruiterProfileRequest(BaseModel):
    organization: Optional[str] = None
    job_title:    Optional[str] = None
    department:   Optional[str] = None
    hiring_focus: Optional[str] = None


class UpdateEvalSettingsRequest(BaseModel):
    security_score_visible:  Optional[bool] = None
    high_priority_threshold: Optional[int]  = None
    weight_code_quality:     Optional[int]  = None
    weight_security:         Optional[int]  = None
    weight_git_activity:     Optional[int]  = None


@router.patch("/profile")
async def update_recruiter_profile(
    data: UpdateRecruiterProfileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_recruiter(current_user)

    if data.organization is not None:
        current_user.organization = data.organization.strip() or None
    if data.job_title is not None:
        current_user.job_title = data.job_title.strip() or None
    if data.department is not None:
        current_user.department = data.department.strip() or None
    if data.hiring_focus is not None:
        current_user.hiring_focus = data.hiring_focus.strip() or None

    db.commit()
    db.refresh(current_user)

    return {
        "organization": current_user.organization,
        "job_title":    current_user.job_title,
        "department":   current_user.department,
        "hiring_focus": current_user.hiring_focus,
    }


@router.patch("/eval-settings")
async def update_eval_settings(
    data: UpdateEvalSettingsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_recruiter(current_user)

    if data.security_score_visible is not None:
        current_user.security_score_visible = data.security_score_visible

    if data.high_priority_threshold is not None:
        if not (0 <= data.high_priority_threshold <= 100):
            raise HTTPException(status_code=422, detail="high_priority_threshold must be 0–100")
        current_user.high_priority_threshold = data.high_priority_threshold

    for field, val in [
        ("weight_code_quality", data.weight_code_quality),
        ("weight_security",     data.weight_security),
        ("weight_git_activity", data.weight_git_activity),
    ]:
        if val is not None:
            if not (0 <= val <= 100):
                raise HTTPException(status_code=422, detail=f"{field} must be 0–100")
            setattr(current_user, field, val)

    db.commit()
    db.refresh(current_user)

    return {
        "security_score_visible":  current_user.security_score_visible,
        "high_priority_threshold": current_user.high_priority_threshold,
        "weight_code_quality":     current_user.weight_code_quality,
        "weight_security":         current_user.weight_security,
        "weight_git_activity":     current_user.weight_git_activity,
    }


@router.delete("/candidates/{run_id}")
async def delete_candidate(
    run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_recruiter(current_user)

    candidate = (
        db.query(RecruiterCandidate)
        .join(AnalysisRun, RecruiterCandidate.analysis_run_id == AnalysisRun.id)
        .filter(
            RecruiterCandidate.analysis_run_id == run_id,
            AnalysisRun.user_id == current_user.id,
        )
        .first()
    )
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found.")

    run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
    if not run:
        raise HTTPException(status_code=404, detail="Analysis run not found.")

    db.query(RepositoryAnalysis).filter(
        RepositoryAnalysis.last_run_id == run_id
    ).update({"last_run_id": None}, synchronize_session="fetch")

    db.query(RecruiterCandidate).filter(
        RecruiterCandidate.analysis_run_id == run_id
    ).delete(synchronize_session="fetch")

    db.delete(run)
    db.commit()

    return {"message": "Candidate analysis deleted successfully."}


@router.get("/profile-dashboard")
async def get_recruiter_profile_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_recruiter(current_user)

    user_block = {
        "id":                      current_user.id,
        "full_name":               current_user.full_name,
        "username":                current_user.username,
        "email":                   current_user.work_email,
        "role":                    current_user.role.value if current_user.role else None,
        "avatar_url":              current_user.avatar_url,
        "organization":            current_user.organization,
        "job_title":               current_user.job_title,
        "department":              current_user.department,
        "hiring_focus":            current_user.hiring_focus,
        "member_since":            current_user.created_at.isoformat() if current_user.created_at else None,
        "github_connected":        bool(current_user.github_access_token),
        "security_score_visible":  current_user.security_score_visible  if current_user.security_score_visible  is not None else True,
        "high_priority_threshold": current_user.high_priority_threshold if current_user.high_priority_threshold is not None else 75,
        "weight_code_quality":     current_user.weight_code_quality     if current_user.weight_code_quality     is not None else 40,
        "weight_security":         current_user.weight_security         if current_user.weight_security         is not None else 30,
        "weight_git_activity":     current_user.weight_git_activity     if current_user.weight_git_activity     is not None else 30,
    }

    candidates_evaluated = (
        db.query(func.count(func.distinct(RecruiterCandidate.candidate_name)))
        .join(AnalysisRun, RecruiterCandidate.analysis_run_id == AnalysisRun.id)
        .filter(AnalysisRun.user_id == current_user.id, AnalysisRun.status == "completed")
        .scalar()
    ) or 0

    latest_run_per_candidate = (
        db.query(func.max(AnalysisRun.id))
        .join(RecruiterCandidate, RecruiterCandidate.analysis_run_id == AnalysisRun.id)
        .filter(
            AnalysisRun.user_id == current_user.id,
            AnalysisRun.status == "completed",
        )
        .group_by(RecruiterCandidate.candidate_name)
        .subquery()
    )

    all_scores = (
        db.query(SkillScore)
        .filter(
            SkillScore.analysis_run_id.in_(latest_run_per_candidate),
            SkillScore.user_id == current_user.id,
        )
        .all()
    )

    priority_threshold = current_user.high_priority_threshold if current_user.high_priority_threshold is not None else 75

    high_priority_count = sum(
        1 for s in all_scores
        if compute_weighted_score(s, current_user) >= priority_threshold
    )

    shortlisted_count = sum(
        1 for s in all_scores
        if compute_weighted_score(s, current_user) >= 65
    )

    recent_runs = (
        db.query(AnalysisRun, Repository, RecruiterCandidate, SkillScore)
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .join(RecruiterCandidate, RecruiterCandidate.analysis_run_id == AnalysisRun.id)
        .outerjoin(
            SkillScore,
            (SkillScore.analysis_run_id == AnalysisRun.id) &
            (SkillScore.user_id == current_user.id)
        )
        .filter(
            AnalysisRun.user_id == current_user.id,
            AnalysisRun.status == "completed",
            AnalysisRun.id.in_(latest_run_per_candidate),
        )
        .order_by(AnalysisRun.completed_at.desc())
        .limit(8)
        .all()
    )

    recent_activity = []
    for run, repo, candidate, score in recent_runs:
        weighted_overall = compute_weighted_score(score, current_user) if score else None
        recent_activity.append({
            "type":           "candidate_evaluated",
            "title":          "Candidate evaluated",
            "description":    (
                f"{candidate.candidate_name} - Overall score: {weighted_overall}"
                if weighted_overall is not None else candidate.candidate_name
            ),
            "candidate_name": candidate.candidate_name,
            "repo_name":      repo.name,
            "score":          weighted_overall,
            "run_id":         run.id,
            "completed_at":   run.completed_at.isoformat() if run.completed_at else None,
        })

    return {
        "user": user_block,
        "talent_overview": {
            "candidates_evaluated": candidates_evaluated,
            "high_priority":        high_priority_count,
            "profiles_shortlisted": shortlisted_count,
        },
        "recent_activity": recent_activity,
    }