

import sys
import os

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Optional

from app.db.database import get_db
from app.db.models import User, AnalysisRun
from app.core.auth_utils import get_current_user
from app.db.models import User, AnalysisRun, SkillScore, CodeMetrics, SecurityFinding, RefreshToken

router = APIRouter(prefix="/profile", tags=["profile"])




def _get_github_login(db: Session, user: User) -> Optional[str]:
    """
    The User model stores github_access_token (encrypted) but NOT a plain
    github_login column.  The login is written to AnalysisRun.contributor_login
    by resolve_github_identity() during analysis.  We read it from there.
    Returns None if GitHub is not connected or no analysis has been run yet.
    """
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




class ProfileResponse(BaseModel):
    id: int
    full_name: str
    username: str
    email: str
    role: Optional[str] = None
    avatar_url: Optional[str] = None
    github_login: Optional[str] = None
    github_connected: bool = False
    organization: Optional[str] = None
    job_title: Optional[str] = None
    member_since: Optional[str] = None

    class Config:
        from_attributes = True


class UpdateAccountRequest(BaseModel):
    full_name: Optional[str] = None
    organization: Optional[str] = None
    job_title: Optional[str] = None




@router.get("", response_model=ProfileResponse)
async def get_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Lightweight account info for the Account Settings page.
    Does NOT run any analytics queries.
    """
    github_login = _get_github_login(db, current_user)

    return ProfileResponse(
        id=current_user.id,
        full_name=current_user.full_name or "",
        username=current_user.username or "",
        email=current_user.work_email or "",
        role=current_user.role.value if current_user.role else None,
        avatar_url=current_user.avatar_url,
        github_login=github_login,
        github_connected=bool(current_user.github_access_token),
        organization=current_user.organization,
        job_title=current_user.job_title,
        member_since=current_user.created_at.isoformat() if current_user.created_at else None,
    )




@router.patch("")
async def update_profile(
    data: UpdateAccountRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update full_name, organization, and/or job_title."""
    changed: dict = {}

    if data.full_name is not None:
        v = data.full_name.strip()
        if not v:
            raise HTTPException(status_code=422, detail="full_name cannot be empty")
        current_user.full_name = v
        changed["full_name"] = v

    if data.organization is not None:
        current_user.organization = data.organization.strip() or None
        changed["organization"] = current_user.organization

    if data.job_title is not None:
        current_user.job_title = data.job_title.strip() or None
        changed["job_title"] = current_user.job_title

    if not changed:
        raise HTTPException(status_code=422, detail="No fields provided to update")

    db.commit()
    db.refresh(current_user)
    return {"message": "Profile updated successfully", **changed}


@router.delete("")
async def delete_account(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    
    run_ids = [r.id for r in db.query(AnalysisRun.id)
               .filter(AnalysisRun.user_id == current_user.id).all()]
    
    if run_ids:
        db.query(SkillScore).filter(SkillScore.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(CodeMetrics).filter(CodeMetrics.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(SecurityFinding).filter(SecurityFinding.analysis_run_id.in_(run_ids)).delete(synchronize_session=False)
        db.query(AnalysisRun).filter(AnalysisRun.user_id == current_user.id).delete(synchronize_session=False)
    
    db.query(RefreshToken).filter(RefreshToken.user_id == current_user.id).delete(synchronize_session=False)
    db.query(SkillScore).filter(SkillScore.user_id == current_user.id).delete(synchronize_session=False)
    
    db.delete(current_user)
    db.commit()
    
    return {"message": "Account deleted successfully"}