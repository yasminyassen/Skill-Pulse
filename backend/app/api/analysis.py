import sys
import os
import re
import logging
from collections import Counter
from datetime import datetime, timezone
from fastapi import Request, APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from typing import Optional
from pydantic import BaseModel

from sqlalchemy import func


ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from app.db.database import get_db
from app.db.models import (
    Repository,
    AnalysisRun,
    SecurityFinding,
    CodeMetrics,
    SkillScore,
    User,
    UserRole,
    RecruiterCandidate,
    RepositoryAnalysis,
    RepositoryContributor,
)
from app.core.auth_utils import get_current_user, decrypt_github_token, require_role
from app.core.rate_limiter import limiter

from app.services.github_client import (
    verify_repo_access,
    refresh_github_access_token_for_user,
    get_branch_head_sha,
    get_files_fingerprint,
    fetch_user_repo_contribution_summary,
    fetch_repository_commit_contributions,
)
from app.services.analysis_orchestrator import (
    background_analysis_task,
    background_manager_team_analysis_task,
    resolve_github_identity,
    build_personal_repo_context,
)
from app.services.code_analysis_service import (
    compute_overall_score,
    safe_float,
    safe_int,
    score_belongs_to_user,
    link_existing_run_to_user,
    build_github_connect_payload,
)
from app.services.security_service import (
    normalize_severity,
    compute_security_score_breakdown,
    group_findings_by_severity_and_file,
)
from app.services.learning_recommendations import build_learning_recommendations


router = APIRouter(prefix="/analysis", tags=["analysis"])


class RepoRequest(BaseModel):
    repo_url: str
    branch: str = "main"


class RecruiterCandidateRow(BaseModel):
    candidate_name: str
    github_login: str
    overall_score: float
    code_quality: float
    problem_solving: float
    architecture: float
    maintainability: float
    security: float
    repo_count: int
    contribution_count: int
    run_id: int


def compute_repository_display_score(code_score: float | None, security_score: float | None) -> float | None:
    if code_score is None:
        return None
    if security_score is None:
        return round(code_score, 2)

    code = max(0.0, min(100.0, float(code_score)))
    security = max(0.0, min(100.0, float(security_score)))

    code_weight = 0.7
    security_weight = 0.3
    return round((code * code_weight) + (security * security_weight), 2)


def compute_recruiter_weighted_score(score: SkillScore, recruiter: User) -> float:
    """
    Computes a candidate's overall score using the recruiter's own evaluation
    weights (Code Quality / Architecture / Maintainability / Security /
    Problem Solving), set in the Evaluation Preferences panel. This mirrors
    compute_weighted_score() used in app/api/routes/recruiter.py so the score
    shown in profile-dashboard (Recent Activity / KPIs) matches the score
    shown in the Candidate Evaluation page exactly.

    NOTE: `weight_git_activity` is the DB column name, but it is actually
    applied to `problem_solving_score` — the UI label for this slider is
    "Problem Solving", not "Git Activity".
    """
    w_code = (getattr(recruiter, "weight_code_quality", None) if getattr(recruiter, "weight_code_quality", None) is not None else 20) / 100.0
    w_architecture = (getattr(recruiter, "weight_architecture", None) if getattr(recruiter, "weight_architecture", None) is not None else 20) / 100.0
    w_maintainability = (getattr(recruiter, "weight_maintainability", None) if getattr(recruiter, "weight_maintainability", None) is not None else 20) / 100.0
    w_sec = (getattr(recruiter, "weight_security", None) if getattr(recruiter, "weight_security", None) is not None else 20) / 100.0
    w_problem = (getattr(recruiter, "weight_git_activity", None) if getattr(recruiter, "weight_git_activity", None) is not None else 20) / 100.0

    total_weight = w_code + w_architecture + w_maintainability + w_sec + w_problem
    if total_weight == 0:
        return float(score.overall_score or 0.0)

    weighted = (
        (score.code_quality_score       or 0.0) * w_code +
        (score.architecture_score       or 0.0) * w_architecture +
        (score.maintainability_score    or 0.0) * w_maintainability +
        (score.security_awareness_score or 0.0) * w_sec +
        (score.problem_solving_score    or 0.0) * w_problem
    )
    return round(weighted / total_weight, 1)


MIN_AWARE_DATETIME = datetime.min.replace(tzinfo=timezone.utc)


def _run_sort_time(run: AnalysisRun) -> datetime:
    value = run.completed_at or run.triggered_at or MIN_AWARE_DATETIME
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _normalise_identity(value: object) -> str | None:
    if value is None:
        return None
    normalised = str(value).strip().lower()
    return normalised or None


def _commit_matches_developer(commit_record: dict, developer: User) -> bool:
    login = _normalise_identity(commit_record.get("login"))
    github_id = _normalise_identity(commit_record.get("github_id"))
    emails = {
        _normalise_identity(email)
        for email in (commit_record.get("emails") or [])
    }
    emails.discard(None)

    developer_github_id = _normalise_identity(developer.github_id)
    developer_username = _normalise_identity(developer.username)
    developer_email = _normalise_identity(developer.work_email)

    return (
        bool(developer_github_id and github_id == developer_github_id)
        or bool(developer_username and login == developer_username)
        or bool(developer_email and developer_email in emails)
    )


def _build_manager_contributor_scopes(
    developers: list[User],
    commit_records: list[dict],
) -> list[dict]:
    contributor_scopes: list[dict] = []

    for developer in developers:
        touched_files: set[str] = set()
        matched_login: str | None = None
        matched_email: str | None = None

        for record in commit_records:
            if not _commit_matches_developer(record, developer):
                continue

            if not matched_login and record.get("login"):
                matched_login = str(record["login"])
            if not matched_email and record.get("emails"):
                matched_email = str(record["emails"][0])

            for file_path in record.get("touched_files") or []:
                if file_path:
                    touched_files.add(str(file_path).replace("\\", "/"))

        python_touched_files = sorted(path for path in touched_files if path.endswith(".py"))
        if not python_touched_files:
            continue

        contributor_scopes.append({
            "user_id": developer.id,
            "contributor_login": matched_login or developer.username or matched_email,
            "touched_files": sorted(touched_files),
            "python_touched_files": python_touched_files,
        })

    return contributor_scopes


def _link_repository_contributors(
    db: Session,
    repo_id: int,
    contributor_scopes: list[dict],
) -> None:
    for contributor in contributor_scopes:
        user_id = contributor.get("user_id")
        if not user_id:
            continue
        link_exists = (
            db.query(RepositoryContributor)
            .filter(
                RepositoryContributor.repository_id == repo_id,
                RepositoryContributor.user_id == user_id,
            )
            .first()
        )
        if not link_exists:
            db.add(RepositoryContributor(
                repository_id=repo_id,
                user_id=user_id,
            ))
    db.commit()


@router.post("/run")
@limiter.limit("2/minute")
async def run_analysis(
    request: Request,
    data: RepoRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    if not re.match(r"^https://github\.com/[^/]+/[^/]+", data.repo_url):
        raise HTTPException(status_code=400, detail="Invalid GitHub repository URL")
    
    full_name = data.repo_url.replace("https://github.com/", "").replace(".git", "")
    repo_name = full_name.split("/")[-1]
    
    token = decrypt_github_token(current_user.github_access_token) if current_user.github_access_token else None
    user_role = current_user.role.value if current_user.role else None
    is_developer = user_role == "developer"
    is_manager = user_role == "manager"

    if is_developer and not token:
        raise HTTPException(
            status_code=403,
                detail=build_github_connect_payload(request, current_user)
        )

    if (
        token
        and current_user.github_token_expires_at
        and current_user.github_token_expires_at <= datetime.now(timezone.utc)
    ):
        refreshed_token = await refresh_github_access_token_for_user(db, current_user)
        if refreshed_token:
            token = refreshed_token
    
    repo_data = None
    
    if token:
        try:
            repo_data = await verify_repo_access(token, full_name)
        except HTTPException as e:
            if e.status_code == 401:
                refreshed_token = await refresh_github_access_token_for_user(db, current_user)
                if refreshed_token:
                    token = refreshed_token
                    repo_data = await verify_repo_access(token, full_name)
                else:
                    payload = build_github_connect_payload(request, current_user)
                    payload["reason"] = "github_token_expired"
                    raise HTTPException(status_code=403, detail=payload)
            else:
                raise
    else:
        try:
            repo_data = await verify_repo_access(None, full_name)
        except HTTPException as e:
            if e.status_code == 404:
                if user_role == "recruiter":
                    raise HTTPException(
                        status_code=403,
                        detail={"recruiter_private_repo": True}
                    )

                raise HTTPException(
                    status_code=403,
                    detail=build_github_connect_payload(request, current_user)
                )
            raise
    # try:
    #     repo_data = await verify_repo_access(token, full_name)
    # except HTTPException as e:
    #     if e.status_code == 404 and not token:
    #         # Recruiters can't access private repos — show specific message
    #         if current_user.role.value == "recruiter":
    #             raise HTTPException(
    #                 status_code=403,
    #                 detail={"recruiter_private_repo": True}
    #             )
    #         # Other users without token — prompt GitHub connect
    #         auth_header = request.headers.get("authorization")
    #         if not auth_header:
    #             raise HTTPException(status_code=401, detail="Missing Authorization header")
    #         jwt_token = auth_header.split(" ")[1]
    #         raise HTTPException(
    #             status_code=403,
    #             detail={
    #                 "requires_github_auth": True,
    #                 "auth_url": f"http://127.0.0.1:8000/auth/github?action=connect&token={jwt_token}"
    #             }
    #         )
    #     if e.status_code == 403:
    #         raise HTTPException(
    #             status_code=503,
    #             detail="GitHub API rate limit reached. Connect your GitHub account or wait a moment and try again."
    #         )
    #     if e.status_code == 404:
    #         raise HTTPException(status_code=404, detail="Repository not found or inaccessible")
    #     raise

    is_private = repo_data.get("private", False)

    if is_private and user_role == "recruiter":
        raise HTTPException(
            status_code=403,
            detail={"recruiter_private_repo": True}
        )

    head_sha = await get_branch_head_sha(token, full_name, data.branch)
    if not head_sha:
        raise HTTPException(
            status_code=404,
            detail={
                "branch_not_found": True,
                "message": "Repository found, but this branch does not exist or is not accessible.",
            },
        )

    contributor_login = None
    contribution_context = None
    analysis_scope = "repository"
    touched_files: list[str] = []
    manager_contributors: list[dict] = []
    cache_sha = head_sha

    if is_developer:
        _, contributor_login = await resolve_github_identity(db, current_user)
        try:
            contribution_context = await fetch_user_repo_contribution_summary(
                token,
                full_name,
                contributor_login,
                data.branch,
            )
        except HTTPException as e:
            if e.status_code in {404, 422, 502}:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "branch_not_found": True,
                        "message": "Repository found, but this branch does not exist or is not accessible.",
                    },
                )
            raise
        touched_files = contribution_context.get("touched_files", [])
        python_touched_files = [p for p in touched_files if p.endswith(".py")]

        if not contribution_context.get("user_contributed"):
            raise HTTPException(
                status_code=403,
                detail={
                    "no_developer_contributions": True,
                    "message": "SkillPulse analyzes your own GitHub contributions. We could not find commits from your GitHub account in this repository.",
                },
            )

        if not python_touched_files:
            raise HTTPException(
                status_code=400,
                detail={
                    "no_python_contributions": True,
                    "message": "We found your commits, but none of the touched files are Python files that SkillPulse can analyze yet.",
                },
            )

        analysis_scope = "contribution"
        python_contribution_fingerprint = await get_files_fingerprint(
            token,
            full_name,
            data.branch,
            python_touched_files,
        )
        if not python_contribution_fingerprint:
            raise HTTPException(
                status_code=400,
                detail={
                    "no_python_contributions": True,
                    "message": "We found your commits, but none of the touched Python files are present on this branch anymore.",
                },
            )
        contribution_fingerprint = await get_files_fingerprint(
            token,
            full_name,
            data.branch,
            touched_files,
        ) or python_contribution_fingerprint
        cache_sha = contribution_fingerprint

    if is_manager:
        try:
            commit_records = await fetch_repository_commit_contributions(
                token,
                full_name,
                data.branch,
            )
        except HTTPException as e:
            if e.status_code in {404, 422, 502}:
                raise HTTPException(
                    status_code=404,
                    detail={
                        "branch_not_found": True,
                        "message": "Repository found, but this branch does not exist or is not accessible.",
                    },
                )
            raise

        registered_developers = (
            db.query(User)
            .filter(User.role == UserRole.developer)
            .all()
        )
        manager_contributors = _build_manager_contributor_scopes(
            registered_developers,
            commit_records,
        )

        if not manager_contributors:
            raise HTTPException(
                status_code=404,
                detail={
                    "no_registered_developer_contributions": True,
                    "message": "No registered developers with Python contributions were found for this repository.",
                },
            )

        analysis_scope = "team_contributions"
        all_python_touched_files = sorted({
            file_path
            for contributor in manager_contributors
            for file_path in contributor.get("python_touched_files", [])
        })
        team_fingerprint = await get_files_fingerprint(
            token,
            full_name,
            data.branch,
            all_python_touched_files,
        )
        if not team_fingerprint:
            raise HTTPException(
                status_code=400,
                detail={
                    "no_python_contributions": True,
                    "message": "Registered developers contributed Python files, but none are present on this branch anymore.",
                },
            )
        cache_sha = team_fingerprint

    # Get or Create Repo
    repo = db.query(Repository).filter(Repository.github_repo_id == str(repo_data["id"])).first()
    if not repo:
        repo = Repository(
            name=repo_name,
            full_name=full_name,
            url=data.repo_url,
            github_repo_id=str(repo_data["id"]) if repo_data else None,
            is_private=is_private,
        )
        db.add(repo)
        db.commit()
        db.refresh(repo)

    if is_manager:
        _link_repository_contributors(db, repo.id, manager_contributors)

    # ── Incremental analysis: skip re-analysis if the relevant snapshot has not changed ──
    if cache_sha:
        existing_run_query = (
            db.query(AnalysisRun)
            .filter(
                AnalysisRun.repository_id == repo.id,
                AnalysisRun.branch == data.branch,
                AnalysisRun.commit_sha == cache_sha,
                AnalysisRun.status == "completed",
                AnalysisRun.analysis_scope == analysis_scope,
            )
        )
        if is_manager:
            existing_run_query = existing_run_query.filter(AnalysisRun.user_id == current_user.id)

        existing_run = existing_run_query.order_by(AnalysisRun.triggered_at.desc()).first()
        if existing_run:
            if is_manager:
                cached_team_scores = (
                    db.query(SkillScore)
                    .join(User, SkillScore.user_id == User.id)
                    .filter(
                        SkillScore.analysis_run_id == existing_run.id,
                        User.role == UserRole.developer,
                    )
                    .count()
                )
                if cached_team_scores:
                    return {
                        "message": "Team contribution scope is up to date. Returning cached team results.",
                        "analysis_run_id": existing_run.id,
                        "status": "completed",
                        "cached": True,
                        "cached_scope": analysis_scope,
                        "contributors_analyzed": cached_team_scores,
                    }
                existing_run = None

        if existing_run and not is_manager:
            cached_for_current_user = score_belongs_to_user(db, existing_run.id, current_user.id)
            if link_existing_run_to_user(db, existing_run, current_user.id):
                return {
                    "message": (
                        "Your contribution scope is up to date. Returning cached results."
                        if cached_for_current_user
                        else "Existing analysis results are ready for this contribution scope."
                    ),
                    "analysis_run_id": existing_run.id,
                    "status": "completed",
                    "cached": True,
                    "cached_scope": analysis_scope,
                    "cached_for_current_user": cached_for_current_user,
                }

    # Create Analysis Run (Pending/Running)
    run = AnalysisRun(
        repository_id=repo.id,
        branch=data.branch,
        status="running",
        user_id=current_user.id,
        commit_sha=cache_sha,
        analysis_scope=analysis_scope,
        contributor_login=None if is_manager else contributor_login,
        triggered_at=datetime.now(timezone.utc)
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    # Trigger Background Task
    if is_manager:
        background_tasks.add_task(
            background_manager_team_analysis_task,
            run_id=run.id,
            repo_id=repo.id,
            repo_url=data.repo_url,
            repo_name=repo_name,
            branch=data.branch,
            full_name=full_name,
            token=token,
            is_private=is_private,
            manager_user_id=current_user.id,
            manager_contributors=manager_contributors,
        )
    else:
        background_tasks.add_task(
            background_analysis_task,
            run_id=run.id,
            repo_id=repo.id,
            repo_url=data.repo_url,
            repo_name=repo_name,
            branch=data.branch,
            full_name=full_name,
            token=token,
            is_private=is_private,
            current_user_id=current_user.id,
            user_role=user_role,
            analysis_scope=analysis_scope,
            contributor_login=contributor_login,
            touched_files=touched_files,
        )

    # Return Immediately
    return {
        "message": "Analysis started successfully. Running in the background.",
        "analysis_run_id": run.id,
        "status": "running",
        "analysis_scope": analysis_scope,
        "contributors_matched": len(manager_contributors) if is_manager else None,
    }
    
@router.get("/history")
async def get_analysis_history(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # linked_completed_runs = (
    #     db.query(AnalysisRun)
    #     .join(SkillScore, SkillScore.analysis_run_id == AnalysisRun.id)
    #     .filter(SkillScore.user_id == current_user.id)
    #     .all()
    # )
    # own_active_runs = (
    #     db.query(AnalysisRun)
    #     .filter(
    #         AnalysisRun.user_id == current_user.id,
    #         AnalysisRun.status != "completed",
    #     )
    #     .all()
    # )

    # unique_runs = {run.id: run for run in linked_completed_runs + own_active_runs}
    linked_runs = (
        db.query(AnalysisRun)
        .join(SkillScore, SkillScore.analysis_run_id == AnalysisRun.id)
        .filter(
            SkillScore.user_id == current_user.id,
            AnalysisRun.user_id == current_user.id,
        )
        .all()
    )
    own_runs = (
        db.query(AnalysisRun)
        .filter(AnalysisRun.user_id == current_user.id)
        .all()
    )

    unique_runs = {run.id: run for run in linked_runs + own_runs}
    past_runs = sorted(
        unique_runs.values(),
        key=lambda run: run.triggered_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:limit]

    result = []

    for run in past_runs:
        score = db.query(SkillScore).filter(
            SkillScore.analysis_run_id == run.id,
            SkillScore.user_id == current_user.id,
        ).first()
        code_score = score.overall_score if score else None
        security_score = score.security_awareness_score if score else None

        result.append({
            "analysis_id": run.id,
            "repo_name": run.repository.name,
            "branch": run.branch,
            "status": run.status,
            "triggered_at": run.triggered_at,
            "completed_at": run.completed_at,
            "score": compute_repository_display_score(code_score, security_score),
            "code_score": code_score,
            "security_score": security_score,
            "repo_id": run.repository.id,
        })

    return {"history": result}


@router.get("/recruiter/candidates", response_model=list[RecruiterCandidateRow])
async def get_recruiter_candidates(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["recruiter"])),
):
    rows = (
        db.query(AnalysisRun, Repository, SkillScore, RecruiterCandidate)
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .join(
            SkillScore,
            (SkillScore.analysis_run_id == AnalysisRun.id) & (SkillScore.user_id == current_user.id),
        )
        .join(RecruiterCandidate, RecruiterCandidate.analysis_run_id == AnalysisRun.id)
        .filter(AnalysisRun.user_id == current_user.id)
        .filter(AnalysisRun.status == "completed")
        .all()
    )

    latest_by_candidate: dict[str, tuple[AnalysisRun, Repository, SkillScore, RecruiterCandidate]] = {}
    for run, repo, score, candidate in rows:
        candidate_key = (candidate.github_login or candidate.candidate_name or "").strip().lower()
        if not candidate_key:
            candidate_key = str(run.id)

        existing = latest_by_candidate.get(candidate_key)
        if existing:
            existing_run = existing[0]
            existing_time = _run_sort_time(existing_run)
            incoming_time = _run_sort_time(run)
            if existing_time >= incoming_time:
                continue

        latest_by_candidate[candidate_key] = (run, repo, score, candidate)

    latest_rows = list(latest_by_candidate.values())
    run_ids = [run.id for run, _, _, _ in latest_rows]
    loc_by_run = {}
    if run_ids:
        loc_by_run = dict(
            db.query(
                CodeMetrics.analysis_run_id,
                func.coalesce(func.sum(CodeMetrics.lines_of_code), 0),
            )
            .filter(CodeMetrics.analysis_run_id.in_(run_ids))
            .group_by(CodeMetrics.analysis_run_id)
            .all()
        )

    repo_counts = Counter(candidate.candidate_name for _, _, _, candidate in rows)

    response: list[RecruiterCandidateRow] = []
    for run, _, score, candidate in sorted(
        latest_rows,
        key=lambda item: _run_sort_time(item[0]),
        reverse=True,
    ):
        # Overall score must reflect the recruiter's own evaluation weights
        # (Code Quality / Security / Problem Solving), set in Evaluation
        # Preferences — not a fixed 70/30 code/security split.
        recruiter_overall = compute_recruiter_weighted_score(score, current_user)
        response.append(RecruiterCandidateRow(
            candidate_name=candidate.candidate_name,
            github_login=candidate.github_login or "",
            overall_score=float(recruiter_overall or 0.0),
            code_quality=float(score.code_quality_score or 0.0),
            problem_solving=float(score.problem_solving_score or 0.0),
            architecture=float(score.architecture_score or 0.0),
            maintainability=float(score.maintainability_score or 0.0),
            security=float(score.security_awareness_score or 0.0),
            repo_count=int(repo_counts.get(candidate.candidate_name, 1)),
            contribution_count=int(loc_by_run.get(run.id, 0)),
            run_id=run.id,
        ))

    return response


@router.delete("/recruiter/analysis/{analysis_id}")
@router.delete("/recruiter/candidates/{analysis_id}")
async def delete_recruiter_candidate_analysis(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["recruiter"])),
):
    run = (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.id == analysis_id,
            AnalysisRun.user_id == current_user.id,
        )
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Analysis run not found")

    repo_analysis = (
        db.query(RepositoryAnalysis)
        .filter(
            RepositoryAnalysis.last_run_id == analysis_id,
            RepositoryAnalysis.user_id == current_user.id,
        )
        .first()
    )

    try:
        if repo_analysis:
            if repo_analysis.results_path and os.path.exists(repo_analysis.results_path):
                if os.path.isdir(repo_analysis.results_path):
                    import shutil
                    shutil.rmtree(repo_analysis.results_path)
                else:
                    os.remove(repo_analysis.results_path)
            db.delete(repo_analysis)

        (
            db.query(RecruiterCandidate)
            .filter(RecruiterCandidate.analysis_run_id == analysis_id)
            .delete(synchronize_session=False)
        )
        (
            db.query(CodeMetrics)
            .filter(CodeMetrics.analysis_run_id == analysis_id)
            .delete(synchronize_session=False)
        )
        (
            db.query(SecurityFinding)
            .filter(SecurityFinding.analysis_run_id == analysis_id)
            .delete(synchronize_session=False)
        )
        (
            db.query(SkillScore)
            .filter(
                SkillScore.analysis_run_id == analysis_id,
                SkillScore.user_id == current_user.id,
            )
            .delete(synchronize_session=False)
        )
        db.delete(run)
        db.commit()
    except Exception:
        db.rollback()
        logging.exception(
            "Failed to delete recruiter candidate analysis run_id=%s user_id=%s",
            analysis_id,
            current_user.id,
        )
        raise HTTPException(status_code=500, detail="Failed to delete candidate analysis")

    return {
        "deleted": True,
        "analysis_id": analysis_id,
        "analysis_exists": False,
    }


@router.get("/{analysis_run_id}/detailed-metrics")
async def get_detailed_metrics_breakdown(
    analysis_run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run = (
        db.query(AnalysisRun)
        .filter(AnalysisRun.id == analysis_run_id)
        .first()
    )

    if not run or run.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Analysis run not found")

    if run.status != "completed":
        raise HTTPException(status_code=400, detail="Analysis run is not completed")

    score_row = (
        db.query(SkillScore)
        .filter(
            SkillScore.analysis_run_id == run.id,
            SkillScore.user_id == current_user.id,
        )
        .first()
    )
    metric_rows = (
        db.query(CodeMetrics)
        .filter(CodeMetrics.analysis_run_id == run.id)
        .all()
    )
    findings = (
        db.query(SecurityFinding)
        .filter(SecurityFinding.analysis_run_id == run.id)
        .all()
    )

    total_files = len(metric_rows)
    total_loc = 0
    cyclomatic_values: list[float] = []
    duplication_values: list[float] = []
    maintainability_index_values: list[float] = []
    docstring_coverage_values: list[float] = []
    test_ratio_values: list[float] = []
    avg_nesting_values: list[float] = []
    function_size_values: list[float] = []
    comment_ratio_values: list[float] = []

    style_violations_total = 0
    missing_docstrings_total = 0
    long_functions_total = 0
    deep_nesting_total = 0
    too_many_params_total = 0
    unused_variables_total = 0
    import_coupling_total = 0
    test_files_total = 0
    max_inheritance_depth = 0

    for row in metric_rows:
        raw = row.raw_metrics if isinstance(row.raw_metrics, dict) else {}

        loc = row.lines_of_code if row.lines_of_code is not None else safe_int(raw.get("loc"), 0)
        total_loc += loc

        cyclomatic = (
            row.cyclomatic_complexity
            if row.cyclomatic_complexity is not None
            else safe_float(raw.get("cyclomatic_complexity"), 0.0)
        )
        cyclomatic_values.append(cyclomatic)

        duplication = (
            row.duplication_score
            if row.duplication_score is not None
            else safe_float(raw.get("duplication_score"), 0.0)
        )
        duplication_values.append(duplication)

        if row.maintainability_index is not None:
            maintainability_index_values.append(safe_float(row.maintainability_index, 0.0))

        if raw.get("docstring_coverage") is not None:
            docstring_coverage_values.append(safe_float(raw.get("docstring_coverage"), 0.0))
        if raw.get("test_function_ratio") is not None:
            test_ratio_values.append(safe_float(raw.get("test_function_ratio"), 0.0))
        if raw.get("avg_nesting_depth") is not None:
            avg_nesting_values.append(safe_float(raw.get("avg_nesting_depth"), 0.0))
        if raw.get("avg_function_size") is not None:
            function_size_values.append(safe_float(raw.get("avg_function_size"), 0.0))
        if raw.get("comment_ratio") is not None:
            comment_ratio_values.append(safe_float(raw.get("comment_ratio"), 0.0))

        style_violations_total += safe_int(raw.get("style_violations"), 0)
        missing_docstrings_total += safe_int(raw.get("missing_docstrings"), 0)
        long_functions_total += safe_int(raw.get("long_functions"), 0)
        deep_nesting_total += safe_int(raw.get("deep_nesting"), 0)
        too_many_params_total += safe_int(raw.get("too_many_params"), 0)
        unused_variables_total += safe_int(raw.get("unused_variables"), 0)
        import_coupling_total += safe_int(raw.get("import_coupling"), 0)

        if bool(raw.get("is_test_file")):
            test_files_total += 1

        max_inheritance_depth = max(
            max_inheritance_depth,
            safe_int(raw.get("max_inheritance_depth"), 0),
        )

    findings_by_severity = Counter(normalize_severity(f.severity) for f in findings)
    findings_by_owasp = Counter((f.owasp_category or "Unknown") for f in findings)
    findings_by_file = Counter(
        (os.path.basename((f.file_path or "unknown").replace("\\", "/")) or "unknown")
        for f in findings
    )

    def _avg(values: list[float]) -> float:
        return round(sum(values) / len(values), 4) if values else 0.0

    total_loc = sum(row.lines_of_code or 0 for row in metric_rows)

    code_quality_score = safe_float(score_row.code_quality_score, 0.0) if score_row else 0.0
    maintainability_score = safe_float(score_row.maintainability_score, 0.0) if score_row else 0.0
    architecture_score = safe_float(score_row.architecture_score, 0.0) if score_row else 0.0
    problem_solving_score = safe_float(score_row.problem_solving_score, 0.0) if score_row else 0.0
    security_score_inputs = [
        {
            "severity": f.severity,
            "cwe": f.cwe,
            "file_path": f.file_path,
            "tool": f.tool,
        }
        for f in findings
    ]
    security_breakdown = compute_security_score_breakdown(security_score_inputs, total_loc)
    security_score = security_breakdown["overall"]
    overall_score = safe_float(score_row.overall_score, 0.0) if score_row else compute_overall_score(
        {
            "code_quality": code_quality_score,
            "maintainability": maintainability_score,
            "architecture": architecture_score,
            "problem_solving": problem_solving_score,
            "security_score": security_score,
        }
    )

    ai_insights = run.ai_insights or {}
    if isinstance(ai_insights, dict):
        ai_insights = dict(ai_insights)
        ai_insights.pop("final_categorized_findings", None)

    stored_arch = ai_insights.get("architecture_metrics") if isinstance(ai_insights, dict) else None
    architecture_detailed: dict = {}
    if isinstance(stored_arch, dict) and isinstance(stored_arch.get("metrics"), dict):
        for metric_key, metric_entry in stored_arch["metrics"].items():
            if not isinstance(metric_entry, dict):
                continue
            architecture_detailed[metric_key] = {
                "score": round(safe_float(metric_entry.get("score"), 0.0), 2),
                "method": metric_entry.get("method", ""),
                "confidence": metric_entry.get("confidence"),
                "reason": metric_entry.get("reason", ""),
                "details": metric_entry.get("details", {}),
            }
        architecture_detailed["overall"] = round(safe_float(stored_arch.get("overall"), architecture_score), 2)
        metric_methods = stored_arch.get("metric_methods")
        if isinstance(metric_methods, dict):
            architecture_detailed["metric_methods"] = metric_methods
    else:
        architecture_detailed = {
            "overall": round(architecture_score, 2),
            "note": "Re-run analysis to populate new architecture metrics.",
        }

    analysis_context = await build_personal_repo_context(
        db,
        current_user,
        run.repository,
        run.branch,
    )

    return {
        "analysis_run_id": run.id,
        "repo": run.repository.full_name,
        "branch": run.branch,
        "status": run.status,
        "analysis_context": analysis_context,
        "scores": {
            "code_quality": round(code_quality_score, 2),
            "maintainability": round(maintainability_score, 2),
            "architecture": round(architecture_score, 2),
            "security_score": round(security_score, 2),
            "security_score_breakdown": security_breakdown,
            "problem_solving": round(problem_solving_score, 2),
            "overall": round(overall_score, 2),
        },
        "detailed_metrics": {
            "code_quality": {
                "python_files": total_files,
                "total_loc": total_loc,
                "avg_cyclomatic_complexity": _avg(cyclomatic_values),
                "avg_duplication_score": _avg(duplication_values),
                "style_violations": style_violations_total,
                "unused_variables": unused_variables_total,
            },
            "maintainability": {
                "avg_docstring_coverage": _avg(docstring_coverage_values),
                "missing_docstrings": missing_docstrings_total,
                "avg_maintainability_index": _avg(maintainability_index_values),
                "avg_comment_ratio": _avg(comment_ratio_values),
                "long_functions": long_functions_total,
                "too_many_params": too_many_params_total,
            },
            "architecture": architecture_detailed,
            "problem_solving": {
                "test_files": test_files_total,
                "avg_test_function_ratio": _avg(test_ratio_values),
                "avg_cyclomatic_complexity": _avg(cyclomatic_values),
                "long_functions": long_functions_total,
            },
        },
        "security": {
            "findings_count": len(findings),
            "severity_distribution": {
                "HIGH": findings_by_severity.get("HIGH", 0),
                "MEDIUM": findings_by_severity.get("MEDIUM", 0),
                "LOW": findings_by_severity.get("LOW", 0),
            },
            "owasp_distribution": dict(findings_by_owasp),
            "top_vulnerable_files": dict(findings_by_file.most_common(5)),
        },
        "completed_at": run.completed_at,
        "ai_insights": ai_insights,
    }


@router.get("/{analysis_run_id}/learning-recommendations")
async def get_learning_recommendations(
    analysis_run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run = (
        db.query(AnalysisRun)
        .filter(AnalysisRun.id == analysis_run_id)
        .first()
    )

    if not run or run.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Analysis run not found")

    if run.status != "completed":
        raise HTTPException(status_code=400, detail="Analysis run is not completed")

    score_row = (
        db.query(SkillScore)
        .filter(
            SkillScore.analysis_run_id == run.id,
            SkillScore.user_id == current_user.id,
        )
        .first()
    )
    if not score_row:
        raise HTTPException(status_code=404, detail="Skill scores not found")

    metric_rows = db.query(CodeMetrics).filter(CodeMetrics.analysis_run_id == run.id).all()
    findings = db.query(SecurityFinding).filter(SecurityFinding.analysis_run_id == run.id).all()
    total_loc = sum(row.lines_of_code or 0 for row in metric_rows)
    security_score_inputs = [
        {
            "severity": f.severity,
            "cwe": f.cwe,
            "file_path": f.file_path,
            "tool": f.tool,
        }
        for f in findings
    ]
    security_breakdown = compute_security_score_breakdown(security_score_inputs, total_loc)
    score_row.security_awareness_score = security_breakdown["overall"]

    ai_insights = run.ai_insights or {}
    if isinstance(ai_insights, dict):
        cached = ai_insights.get("learning_recommendations")
        if isinstance(cached, dict) and cached:
            cached = dict(cached)
            scores = dict(cached.get("scores") or {})
            scores["security_score"] = security_breakdown["overall"]
            cached["scores"] = scores
            cached["security_score_breakdown"] = security_breakdown

            skill_gaps = []
            for gap in cached.get("skill_gaps") or []:
                if not isinstance(gap, dict):
                    continue
                gap = dict(gap)
                if gap.get("domain") == "Security":
                    security_score = security_breakdown["overall"]
                    security_gap = max(0.0, 100.0 - security_score)
                    gap["score"] = round(security_score, 2)
                    gap["gap"] = round(security_gap, 2)
                    gap["priority"] = "High" if security_score < 82 else ("Medium" if security_score < 88 else "Low")
                    gap["target_difficulty"] = "Advanced" if security_gap >= 20 else ("Intermediate" if security_gap >= 10 else "Beginner")
                    gap["estimated_gain"] = 10 if security_gap >= 20 else (6 if security_gap >= 10 else 3)
                skill_gaps.append(gap)
            cached["skill_gaps"] = skill_gaps

            security_focus = dict(cached.get("security_focus") or {})
            security_focus["enabled"] = security_breakdown["overall"] < 82
            security_focus["threshold"] = 82
            cached["security_focus"] = security_focus

            ai_insights["learning_recommendations"] = cached
            run.ai_insights = ai_insights
            db.commit()
            return cached

    payload = build_learning_recommendations(run, score_row, metric_rows, findings)
    payload["security_score_breakdown"] = security_breakdown

    if isinstance(ai_insights, dict):
        ai_insights["learning_recommendations"] = payload
        run.ai_insights = ai_insights
        db.commit()

    return payload


class UpdateProfileRequest(BaseModel):
    organization: Optional[str] = None
    job_title: Optional[str] = None


@router.patch("/profile")
async def update_profile(
    data: UpdateProfileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if data.organization is not None:
        current_user.organization = data.organization.strip()
    if data.job_title is not None:
        current_user.job_title = data.job_title.strip()

    db.commit()
    db.refresh(current_user)

    return {
        "organization": current_user.organization,
        "job_title":    current_user.job_title,
    }

@router.get("/profile-dashboard")
async def get_profile_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Aggregated profile dashboard for the current developer.

    Returns:
      user            – profile info
      integrations    – connected services
      progress_overview – overall/best/most-improved/focus stats
      skill_timeline  – per-analysis score history (for the line chart)
      recent_improvements – latest skill deltas
      recent_activity – latest analysis runs & commits
      settings        – placeholder links
    """

    # ── 1. Fetch all completed SkillScore rows for this user 
    rows = (
        db.query(SkillScore, AnalysisRun, Repository)
        .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
        .join(Repository,  AnalysisRun.repository_id  == Repository.id)
        .filter(
            SkillScore.user_id == current_user.id,
            AnalysisRun.user_id == current_user.id,
            AnalysisRun.status == "completed",
        )
        .order_by(AnalysisRun.completed_at.asc())   # asc for timeline
        .all()
    )

    # ── 2. User block ─────────────────────────────────────────────────────────
    github_login = None
    if current_user.github_access_token:
        try:
            _, github_login = await resolve_github_identity(db, current_user)
        except Exception:
            pass

    user_block = {
        "id":           current_user.id,
        "full_name":    current_user.full_name,
        "username":     current_user.username,
        "email":        current_user.work_email,
        "role":         current_user.role.value if current_user.role else None,
        "avatar_url":   current_user.avatar_url,
        "github_login": github_login,
        "member_since": current_user.created_at.isoformat() if current_user.created_at else None,
       
        "organization": current_user.organization,
        "job_title":    current_user.job_title,
        
    }

    
    integrations_block = {
        "github": {
            "connected": bool(current_user.github_access_token),
            "login":     github_login,
        },
    }

    # ── 4. Skill timeline 
    SKILL_KEYS = ["code_quality", "maintainability", "architecture", "problem_solving", "security_awareness"]

    skill_timeline = []
    for skill_score, run, repo in rows:
        skill_timeline.append({
            "date":            run.completed_at.isoformat() if run.completed_at else None,
            "analysis_id":     run.id,
            "repo_name":       repo.name,
            "code_quality":    round(safe_float(skill_score.code_quality_score),    2),
            "maintainability": round(safe_float(skill_score.maintainability_score), 2),
            "architecture":    round(safe_float(skill_score.architecture_score),    2),
            "problem_solving": round(safe_float(skill_score.problem_solving_score), 2),
            "security":        round(safe_float(skill_score.security_awareness_score), 2),
            "overall":         round(safe_float(skill_score.overall_score),         2),
        })

    # ── 5. Progress overview 
    if not rows:
        progress_overview = {
            "overall_delta": 0.0,
            "best_skill":    None,
            "best_skill_score": 0.0,
            "most_improved": None,
            "most_improved_delta": 0.0,
            "focus_area":    None,
        }
        recent_improvements = []
    else:
        latest  = rows[-1].SkillScore
        previous = rows[-2].SkillScore if len(rows) > 1 else None

        dim_labels = {
            "code_quality":    "Code Quality",
            "maintainability": "Maintainability",
            "architecture":    "Architecture",
            "problem_solving": "Problem Solving",
            "security":        "Security",
        }

        current_scores = {
            "code_quality":    safe_float(latest.code_quality_score),
            "maintainability": safe_float(latest.maintainability_score),
            "architecture":    safe_float(latest.architecture_score),
            "problem_solving": safe_float(latest.problem_solving_score),
            "security":        safe_float(latest.security_awareness_score),
        }

        prev_scores = {
            "code_quality":    safe_float(previous.code_quality_score)    if previous else 0.0,
            "maintainability": safe_float(previous.maintainability_score) if previous else 0.0,
            "architecture":    safe_float(previous.architecture_score)    if previous else 0.0,
            "problem_solving": safe_float(previous.problem_solving_score) if previous else 0.0,
            "security":        safe_float(previous.security_awareness_score) if previous else 0.0,
        }

        deltas = {k: round(current_scores[k] - prev_scores[k], 2) for k in current_scores}

        best_key   = max(current_scores, key=lambda k: current_scores[k])
        worst_key  = min(current_scores, key=lambda k: current_scores[k])
        most_imp_k = max(deltas,         key=lambda k: deltas[k])

        overall_delta = round(
            safe_float(latest.overall_score) - safe_float(previous.overall_score if previous else latest.overall_score),
            2,
        )

        progress_overview = {
            "overall_delta":      overall_delta,
            "best_skill":         dim_labels[best_key],
            "best_skill_score":   round(current_scores[best_key], 1),
            "most_improved":      dim_labels[most_imp_k],
            "most_improved_delta": deltas[most_imp_k],
            "focus_area":         dim_labels[worst_key],
        }

        recent_improvements = [
            {
                "skill":    dim_labels[k],
                "score":    round(current_scores[k], 1),
                "previous": round(prev_scores[k],    1),
                "delta":    deltas[k],
            }
            for k in dim_labels
        ]

    # ── 6. Recent activity
    recent_runs = (
        db.query(AnalysisRun, Repository)
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .filter(AnalysisRun.user_id == current_user.id)
        .order_by(AnalysisRun.triggered_at.desc())
        .limit(10)
        .all()
    )

    recent_activity = []
    for run, repo in recent_runs:
        score_row = (
            db.query(SkillScore)
            .filter(
                SkillScore.analysis_run_id == run.id,
                SkillScore.user_id         == current_user.id,
            )
            .first()
        )
        recent_activity.append({
            "type":        "repository_analyzed",
            "repo_name":   repo.name,
            "full_name":   repo.full_name,
            "branch":      run.branch,
            "status":      run.status,
            "triggered_at": run.triggered_at.isoformat() if run.triggered_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "score":       round(safe_float(score_row.overall_score), 1) if score_row else None,
            "analysis_id": run.id,
        })

    # ── 7. Settings 
    settings_block = {
        "account_settings":         "/settings/account",
        "connected_repositories":   "/settings/repositories",
        
    }

    return {
        "user":                 user_block,
        "integrations":         integrations_block,
        "progress_overview":    progress_overview,
        "skill_timeline":       skill_timeline,
        "recent_improvements":  recent_improvements,
        "recent_activity":      recent_activity,
        "settings":             settings_block,
    }
@router.get("/{analysis_id}")
async def get_analysis_result(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    run = (
        db.query(AnalysisRun)
        .filter(AnalysisRun.id == analysis_id)
        .first()
    )

    # if not run or (run.status == "completed" and not score_belongs_to_user(db, run.id, current_user.id)) or (run.status != "completed" and run.user_id != current_user.id):
    #     return {
    #         "analysis_id": analysis_id,
    #         "status": "pending",
    #     }
    if not run:
        return {"analysis_id": analysis_id, "status": "pending"}

    is_owner = run.user_id == current_user.id
    has_score = score_belongs_to_user(db, run.id, current_user.id)

    if not is_owner:
        return {"analysis_id": analysis_id, "status": "pending"}

    if run.status != "completed":
        return {
            "analysis_id": run.id,
            "status": run.status,
            "error_reason": (run.ai_insights or {}).get("error_reason"),
            "message": "Analysis is still processing or failed."
        }

    scores = db.query(SkillScore).filter(
        SkillScore.analysis_run_id == run.id,
        SkillScore.user_id == current_user.id,
    ).first()
    findings_count = db.query(SecurityFinding).filter(SecurityFinding.analysis_run_id == run.id).count()
    ai_insights = run.ai_insights or {}
    if isinstance(ai_insights, dict):
        ai_insights = dict(ai_insights)
        ai_insights.pop("final_categorized_findings", None)

    return {
        "analysis_run_id": run.id,
        "repo": run.repository.full_name,
        "branch": run.branch,
        "status": run.status,
        "scores": {
            "code_quality": scores.code_quality_score if scores else 0,
            "maintainability": scores.maintainability_score if scores else 0,
            "architecture": scores.architecture_score if scores else 0,
            "security_score": scores.security_awareness_score if scores else 0,
            "problem_solving": scores.problem_solving_score if scores else 0,
            "overall": scores.overall_score if scores else 0,
        },
        "security_findings_count": findings_count,
        "ai_insights": ai_insights,
        "completed_at": run.completed_at
    }
    

@router.get("/skills/summary")
async def get_skills_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Returns aggregated skill scores across all completed analysis runs
    for the current user, plus a list of completed repos (with their
    latest analysis_run_id) to populate the repository dropdown.

    Response shape:
    {
        "overall": float,
        "delta": float,                # overall change vs previous run
        "scores": {
            "code_quality":    float,
            "maintainability": float,
            "architecture":    float,
            "problem_solving": float,
        },
        "deltas": {                    # change vs previous run per dimension
            "code_quality":    float,
            "maintainability": float,
            "architecture":    float,
            "problem_solving": float,
        },
        "repos": [
            {
                "analysis_id": int,
                "repo_name":   str,
                "full_name":   str,
                "branch":      str,
                "completed_at": str,
            }, ...
        ]
    }
    """

    # 1. Pull all completed skill score rows for this user, newest first
    # Temporary diagnostic — remove after confirming fix
    all_runs_count = (
        db.query(SkillScore)
        .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
        .filter(
            SkillScore.user_id == current_user.id,
            AnalysisRun.user_id == current_user.id,
        )
        .count()
    )
    logging.info(
        "[user=%s] Total SkillScore rows before scope filter: %s",
        current_user.id,
        all_runs_count,
    )

    score_rows = (
        db.query(SkillScore, AnalysisRun, Repository)
        .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
        .join(Repository,  AnalysisRun.repository_id == Repository.id)
        .filter(
            SkillScore.user_id    == current_user.id,
            AnalysisRun.user_id   == current_user.id,
            AnalysisRun.status    == "completed",
        )
        .order_by(AnalysisRun.triggered_at.desc())
    )
    if current_user.role.value == "developer":
        score_rows = score_rows.filter(AnalysisRun.analysis_scope == "contribution")
    logging.info(
        "[user=%s] SkillScore rows after scope filter: %s",
        current_user.id,
        len(score_rows.all()),
    )
    score_rows = score_rows.all()

    if not score_rows:
        empty_context = {
            "has_github_identity": bool(current_user.github_access_token),
            "github_login": None,
        }
        if current_user.github_access_token:
            try:
                _, github_login = await resolve_github_identity(db, current_user)
                empty_context["has_github_identity"] = bool(github_login)
                empty_context["github_login"] = github_login
            except Exception:
                pass

        return {
            "overall":  0.0,
            "delta":    0.0,
            "scores":   {"code_quality": 0.0, "maintainability": 0.0, "architecture": 0.0, "problem_solving": 0.0},
            "deltas":   {"code_quality": 0.0, "maintainability": 0.0, "architecture": 0.0, "problem_solving": 0.0},
            "repos":    [],
            "viewer":   empty_context,
        }

    # 2. Build analysis list. Keep each run visible so users can inspect
    # older contribution snapshots or disconnect only one instance.
    repos_list: list[dict] = []
    for skill_score, run, repo in score_rows:
        context = await build_personal_repo_context(db, current_user, repo, run.branch)
        repos_list.append({
            "analysis_id":  run.id,
            "repo_name":    repo.name,
            "full_name":    repo.full_name,
            "branch":       run.branch,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "is_private":   bool(repo.is_private),
            "analysis_context": context,
            "contributor_login": run.contributor_login,
        })

    # 3. Aggregate scores across ALL completed runs (average)
    def _avg_scores(rows):
        if not rows:
            return {"code_quality": 0.0, "maintainability": 0.0, "architecture": 0.0, "problem_solving": 0.0, "overall": 0.0}
        n = len(rows)
        return {
            "code_quality":    round(sum(safe_float(r.SkillScore.code_quality_score)    for r in rows) / n, 2),
            "maintainability": round(sum(safe_float(r.SkillScore.maintainability_score) for r in rows) / n, 2),
            "architecture":    round(sum(safe_float(r.SkillScore.architecture_score)    for r in rows) / n, 2),
            "problem_solving": round(sum(safe_float(r.SkillScore.problem_solving_score) for r in rows) / n, 2),
            "overall":         round(sum(safe_float(r.SkillScore.overall_score)         for r in rows) / n, 2),
        }

    # Latest run vs previous run for deltas
    latest_run_id  = score_rows[0].AnalysisRun.id
    previous_run_id = score_rows[1].AnalysisRun.id if len(score_rows) > 1 else None

    latest_row   = score_rows[0].SkillScore
    previous_row = score_rows[1].SkillScore if previous_run_id else None

    def _delta(latest_val, prev_val):
        if prev_val is None:
            return 0.0
        return round(safe_float(latest_val) - safe_float(prev_val), 2)

    aggregated = _avg_scores(score_rows)

    deltas = {
        "code_quality":    _delta(latest_row.code_quality_score,    previous_row.code_quality_score    if previous_row else None),
        "maintainability": _delta(latest_row.maintainability_score, previous_row.maintainability_score if previous_row else None),
        "architecture":    _delta(latest_row.architecture_score,    previous_row.architecture_score    if previous_row else None),
        "problem_solving": _delta(latest_row.problem_solving_score, previous_row.problem_solving_score if previous_row else None),
    }
    overall_delta = _delta(latest_row.overall_score, previous_row.overall_score if previous_row else None)

    return {
        "overall":  aggregated["overall"],
        "delta":    overall_delta,
        "scores":   {k: aggregated[k] for k in ("code_quality", "maintainability", "architecture", "problem_solving")},
        "deltas":   deltas,
        "repos":    repos_list,
        "viewer": {
            "has_github_identity": bool(repos_list[0]["analysis_context"].get("has_github_identity")) if repos_list else bool(current_user.github_access_token),
            "github_login": repos_list[0]["analysis_context"].get("github_login") if repos_list else None,
        },
    }
