from __future__ import annotations

from fastapi import HTTPException, Request
from sqlalchemy.orm import Session

from app.db.models import AnalysisRun, SkillScore, User


def compute_overall_score(scores: dict) -> float:
    code_quality = float(scores.get("code_quality", 0.0) or 0.0)
    maintainability = float(scores.get("maintainability", 0.0) or 0.0)
    architecture = float(scores.get("architecture", 0.0) or 0.0)
    problem_solving = float(scores.get("problem_solving", 0.0) or 0.0)
    if problem_solving == 0.0:
        import logging
        logging.warning(
            "compute_overall_score called with problem_solving=0. Full scores dict: %s",
            scores,
        )
    return round((code_quality + maintainability + architecture + problem_solving) / 4.0, 2)


def apply_adjustment(base_score: float, adjustment: float, confidence: float) -> float:
    weight = 0.3 * confidence
    return base_score + (adjustment * weight)


def safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def score_belongs_to_user(db: Session, run_id: int, user_id: int) -> bool:
    return (
        db.query(SkillScore)
        .filter(
            SkillScore.analysis_run_id == run_id,
            SkillScore.user_id == user_id,
        )
        .first()
        is not None
    )


def link_existing_run_to_user(db: Session, run: AnalysisRun, user_id: int) -> bool:
    existing = (
        db.query(SkillScore)
        .filter(
            SkillScore.analysis_run_id == run.id,
            SkillScore.user_id == user_id,
        )
        .first()
    )
    if existing:
        return True

    source_score = (
        db.query(SkillScore)
        .filter(SkillScore.analysis_run_id == run.id)
        .first()
    )
    if not source_score:
        return False

    db.add(SkillScore(
        analysis_run_id=run.id,
        user_id=user_id,
        code_quality_score=source_score.code_quality_score,
        maintainability_score=source_score.maintainability_score,
        architecture_score=source_score.architecture_score,
        security_awareness_score=source_score.security_awareness_score,
        problem_solving_score=source_score.problem_solving_score,
        overall_score=source_score.overall_score,
    ))
    db.commit()
    return True


def build_github_connect_payload(request: Request, current_user: User) -> dict:
    auth_header = request.headers.get("authorization")
    if not auth_header or " " not in auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    jwt_token = auth_header.split(" ", 1)[1]
    base_url = str(request.base_url).rstrip("/")
    return {
        "requires_github_auth": True,
        "auth_url": f"{base_url}/auth/github?action=connect&token={jwt_token}",
    }
