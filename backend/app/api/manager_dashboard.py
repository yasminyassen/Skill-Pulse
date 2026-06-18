from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Iterable

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth_utils import require_role
from app.db.database import get_db
from app.db.models import AnalysisRun, CodeMetrics, Repository, SkillScore, User, UserRole
from app.schemas.manager_schemas import (
    ManagerDashboardRepo,
    ManagerTeamInsights,
    ManagerKpis,
    ManagerSkillDistribution,
    ManagerTeamMember,
    ManagerTopPerformer,
    ManagerTrendPoint,
)
from ai_services.insights.ai_insights import generate_insights
from ai_services.rag.rag_seeder import STANDARDS_DOC_ID


router = APIRouter(prefix="/manager/dashboard", tags=["manager-dashboard"])


ScoreRow = tuple[SkillScore, AnalysisRun, Repository, User]


def _safe_float(value: object, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _round_score(value: float) -> float:
    return round(value, 2)


def _avg(values: Iterable[float]) -> float:
    values = list(values)
    if not values:
        return 0.0
    return sum(values) / len(values)


def _run_time(run: AnalysisRun) -> datetime:
    value = run.completed_at or run.triggered_at or datetime.min.replace(tzinfo=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _query_manager_score_rows(
    db: Session,
    manager_id: int,
    repo_id: int | None = None,
) -> list[ScoreRow]:
    query = (
        db.query(SkillScore, AnalysisRun, Repository, User)
        .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .join(User, SkillScore.user_id == User.id)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.status == "completed",
            User.role == UserRole.developer,
        )
    )
    if repo_id is not None:
        query = query.filter(AnalysisRun.repository_id == repo_id)

    return query.order_by(AnalysisRun.completed_at.asc(), AnalysisRun.triggered_at.asc()).all()


def _average_scores_by_developer(rows: list[ScoreRow]) -> dict[int, dict[str, float]]:
    grouped: dict[int, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for score, _, _, user in rows:
        grouped[user.id]["overall"].append(_safe_float(score.overall_score))
        grouped[user.id]["code_quality"].append(_safe_float(score.code_quality_score))
        grouped[user.id]["problem_solving"].append(_safe_float(score.problem_solving_score))
        grouped[user.id]["architecture"].append(_safe_float(score.architecture_score))
        grouped[user.id]["maintainability"].append(_safe_float(score.maintainability_score))

    return {
        user_id: {
            key: _avg(values)
            for key, values in score_groups.items()
        }
        for user_id, score_groups in grouped.items()
    }


def _team_average_from_developer_averages(
    developer_averages: dict[int, dict[str, float]],
    key: str,
) -> float:
    return _round_score(_avg(scores.get(key, 0.0) for scores in developer_averages.values()))


def _analysis_run_ids(rows: list[ScoreRow]) -> list[int]:
    return sorted({run.id for _, run, _, _ in rows})


def _build_team_score_payload(rows: list[ScoreRow]) -> dict[str, float]:
    developer_averages = _average_scores_by_developer(rows)
    return {
        "code_quality": _team_average_from_developer_averages(developer_averages, "code_quality"),
        "maintainability": _team_average_from_developer_averages(developer_averages, "maintainability"),
        "architecture": _team_average_from_developer_averages(developer_averages, "architecture"),
        "problem_solving": _team_average_from_developer_averages(developer_averages, "problem_solving"),
        "overall": _team_average_from_developer_averages(developer_averages, "overall"),
    }


def _build_team_aggregate_metrics(db: Session, run_ids: list[int]) -> dict:
    if not run_ids:
        return {
            "total_files_analyzed": 0,
            "test_files": 0,
            "avg_cyclomatic_complexity": 0.0,
            "long_functions": 0,
            "avg_docstring_coverage": 0.0,
            "import_coupling_total": 0,
            "style_violations": 0,
            "total_loc": 0,
            "avg_duplication_score": 0.0,
            "unused_variables": 0,
        }

    metric_rows = (
        db.query(CodeMetrics)
        .filter(CodeMetrics.analysis_run_id.in_(run_ids))
        .all()
    )

    total_loc = 0
    test_files = 0
    cyclomatic_values: list[float] = []
    docstring_values: list[float] = []
    duplication_values: list[float] = []
    test_ratio_values: list[float] = []
    function_size_values: list[float] = []
    nesting_values: list[float] = []
    maintainability_index_values: list[float] = []
    long_functions = 0
    import_coupling_total = 0
    style_violations = 0
    unused_variables = 0

    for row in metric_rows:
        raw = row.raw_metrics if isinstance(row.raw_metrics, dict) else {}
        total_loc += int(row.lines_of_code or raw.get("loc") or 0)
        cyclomatic_values.append(_safe_float(row.cyclomatic_complexity, _safe_float(raw.get("cyclomatic_complexity"))))
        duplication_values.append(_safe_float(row.duplication_score, _safe_float(raw.get("duplication_score"))))

        if raw.get("docstring_coverage") is not None:
            docstring_values.append(_safe_float(raw.get("docstring_coverage")))
        if raw.get("test_function_ratio") is not None:
            test_ratio_values.append(_safe_float(raw.get("test_function_ratio")))
        if raw.get("avg_function_size") is not None:
            function_size_values.append(_safe_float(raw.get("avg_function_size")))
        if raw.get("avg_nesting_depth") is not None:
            nesting_values.append(_safe_float(raw.get("avg_nesting_depth")))
        if row.maintainability_index is not None:
            maintainability_index_values.append(_safe_float(row.maintainability_index))
        if raw.get("is_test_file"):
            test_files += 1

        long_functions += int(raw.get("long_functions") or 0)
        import_coupling_total += int(raw.get("import_coupling") or raw.get("import_coupling_total") or 0)
        style_violations += int(raw.get("style_violations") or 0)
        unused_variables += int(raw.get("unused_variables") or 0)

    return {
        "total_files_analyzed": len(metric_rows),
        "test_files": test_files,
        "avg_cyclomatic_complexity": _round_score(_avg(cyclomatic_values)),
        "avg_test_function_ratio": _round_score(_avg(test_ratio_values)),
        "avg_function_size": _round_score(_avg(function_size_values)),
        "avg_nesting_depth": _round_score(_avg(nesting_values)),
        "avg_maintainability_index": _round_score(_avg(maintainability_index_values)),
        "long_functions": long_functions,
        "avg_docstring_coverage": _round_score(_avg(docstring_values)),
        "import_coupling_total": import_coupling_total,
        "style_violations": style_violations,
        "total_loc": total_loc,
        "avg_duplication_score": _round_score(_avg(duplication_values)),
        "unused_variables": unused_variables,
    }


def _stringify_attention_items(items: object) -> list[str]:
    result: list[str] = []
    if not isinstance(items, list):
        return result

    for item in items:
        if isinstance(item, str):
            text = item.strip()
        elif isinstance(item, dict):
            title = str(item.get("title") or "").strip()
            description = str(item.get("description") or "").strip()
            text = f"{title} - {description}".strip(" -")
        else:
            text = ""
        if text:
            result.append(text)
    return result


def _fallback_team_insights(scores: dict[str, float], metrics: dict) -> ManagerTeamInsights:
    ordered_scores = [
        ("Code quality", scores.get("code_quality", 0.0)),
        ("Problem solving", scores.get("problem_solving", 0.0)),
        ("Architecture", scores.get("architecture", 0.0)),
        ("Maintainability", scores.get("maintainability", 0.0)),
    ]
    low = sorted(
        [
            item
            for item in ordered_scores
            if item[1] > 0.0 and item[1] < 75.0
        ],
        key=lambda item: item[1],
    )[:3]
    high = sorted(
        [
            item
            for item in ordered_scores
            if item[1] >= 80.0
        ],
        key=lambda item: item[1],
        reverse=True,
    )[:3]

    return ManagerTeamInsights(
        areas_needing_attention=[
            f"{label} needs attention at {score:.0f}/100 based on the current filtered team average."
            for label, score in low
        ],
        team_strengths=[
            f"{label} is a team strength at {score:.0f}/100 across the selected contribution scope."
            for label, score in high
        ],
    )


def _normalise_team_insights(raw: dict, scores: dict[str, float], metrics: dict) -> ManagerTeamInsights:
    fallback = _fallback_team_insights(scores, metrics)
    has_strengths = "team_strengths" in raw
    has_attention = "areas_needing_attention" in raw
    strengths = [str(item).strip() for item in raw.get("team_strengths", []) if str(item).strip()]
    attention = _stringify_attention_items(raw.get("areas_needing_attention"))

    return ManagerTeamInsights(
        team_strengths=strengths if has_strengths else fallback.team_strengths,
        areas_needing_attention=attention if has_attention else fallback.areas_needing_attention,
    )


def _latest_manager_analysis_run(
    db: Session,
    manager_id: int,
    repo_id: int | None = None,
) -> AnalysisRun | None:
    query = (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.status == "completed",
        )
    )
    if repo_id is not None:
        query = query.filter(AnalysisRun.repository_id == repo_id)

    return (
        query
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.triggered_at.desc())
        .first()
    )


def _cached_team_insights(payload: dict | None) -> ManagerTeamInsights | None:
    if not isinstance(payload, dict):
        return None
    if "team_strengths" not in payload:
        return None

    return ManagerTeamInsights(
        team_strengths=[
            str(item).strip()
            for item in (payload.get("team_strengths") or [])
            if str(item).strip()
        ],
        areas_needing_attention=_stringify_attention_items(
            payload.get("areas_needing_attention") or []
        ),
    )


def _trend_average_for_rows(rows: list[ScoreRow]) -> float:
    developer_averages = _average_scores_by_developer(rows)
    return _team_average_from_developer_averages(developer_averages, "overall")


def _calculate_growth_rate(rows: list[ScoreRow]) -> float:
    if not rows:
        return 0.0

    rows_by_month: dict[str, list[ScoreRow]] = defaultdict(list)
    for row in rows:
        _, run, _, _ = row
        rows_by_month[_run_time(run).strftime("%Y-%m")].append(row)

    ordered_months = sorted(rows_by_month)
    if len(ordered_months) < 2:
        return 0.0

    latest = _trend_average_for_rows(rows_by_month[ordered_months[-1]])
    previous = _trend_average_for_rows(rows_by_month[ordered_months[-2]])
    return _round_score(latest - previous)


@router.get("/repos", response_model=list[ManagerDashboardRepo])
def get_manager_dashboard_repos(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = (
        db.query(
            Repository.id,
            Repository.name,
            Repository.full_name,
            Repository.is_private,
            func.max(AnalysisRun.completed_at).label("last_analyzed_at"),
            func.count(func.distinct(AnalysisRun.id)).label("analysis_count"),
            func.count(func.distinct(SkillScore.user_id)).label("member_count"),
        )
        .join(AnalysisRun, AnalysisRun.repository_id == Repository.id)
        .join(SkillScore, SkillScore.analysis_run_id == AnalysisRun.id)
        .join(User, SkillScore.user_id == User.id)
        .filter(
            AnalysisRun.user_id == current_user.id,
            AnalysisRun.status == "completed",
            User.role == UserRole.developer,
        )
        .group_by(Repository.id, Repository.name, Repository.full_name, Repository.is_private)
        .order_by(func.max(AnalysisRun.completed_at).desc())
        .all()
    )

    return [
        ManagerDashboardRepo(
            id=row.id,
            name=row.name,
            full_name=row.full_name,
            is_private=bool(row.is_private),
            last_analyzed_at=row.last_analyzed_at,
            analysis_count=int(row.analysis_count or 0),
            member_count=int(row.member_count or 0),
        )
        for row in rows
    ]


@router.get("/kpis", response_model=ManagerKpis)
def get_manager_dashboard_kpis(
    repo_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id, repo_id)
    developer_averages = _average_scores_by_developer(rows)
    users_by_id = {user.id: user for _, _, _, user in rows}

    team_average = _team_average_from_developer_averages(developer_averages, "overall")
    top_performer: ManagerTopPerformer | None = None
    if developer_averages:
        top_user_id, top_scores = max(
            developer_averages.items(),
            key=lambda item: item[1].get("overall", 0.0),
        )
        top_user = users_by_id[top_user_id]
        top_performer = ManagerTopPerformer(
            id=top_user.id,
            full_name=top_user.full_name,
            username=top_user.username,
            average_score=_round_score(top_scores.get("overall", 0.0)),
        )

    return ManagerKpis(
        team_average_score=team_average,
        team_size=len(developer_averages),
        top_performer=top_performer,
        growth_rate=_calculate_growth_rate(rows),
    )


@router.get("/trends", response_model=list[ManagerTrendPoint])
def get_manager_dashboard_trends(
    repo_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id, repo_id)
    rows_by_month: dict[str, list[ScoreRow]] = defaultdict(list)
    for row in rows:
        _, run, _, _ = row
        rows_by_month[_run_time(run).strftime("%Y-%m")].append(row)

    return [
        ManagerTrendPoint(
            month=month,
            average_score=_trend_average_for_rows(month_rows),
        )
        for month, month_rows in sorted(rows_by_month.items())
    ]


@router.get("/skills", response_model=ManagerSkillDistribution)
def get_manager_dashboard_skills(
    repo_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id, repo_id)
    developer_averages = _average_scores_by_developer(rows)

    return ManagerSkillDistribution(
        code_quality=_team_average_from_developer_averages(developer_averages, "code_quality"),
        problem_solving=_team_average_from_developer_averages(developer_averages, "problem_solving"),
        architecture=_team_average_from_developer_averages(developer_averages, "architecture"),
        maintainability=_team_average_from_developer_averages(developer_averages, "maintainability"),
    )


@router.get("/insights", response_model=ManagerTeamInsights)
async def get_manager_dashboard_insights(
    repo_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    latest_repo_run: AnalysisRun | None = None
    if repo_id is None:
        cached = _cached_team_insights(current_user.global_team_insights)
    else:
        latest_repo_run = _latest_manager_analysis_run(db, current_user.id, repo_id)
        cached = _cached_team_insights(
            latest_repo_run.ai_insights if latest_repo_run else None
        )

    if cached:
        return cached

    rows = _query_manager_score_rows(db, current_user.id, repo_id)
    if not rows:
        return ManagerTeamInsights(
            team_strengths=[],
            areas_needing_attention=[],
        )

    scores = _build_team_score_payload(rows)
    run_ids = _analysis_run_ids(rows)
    aggregate_metrics = _build_team_aggregate_metrics(db, run_ids)
    analysis_payload = {
        "scores": scores,
        "aggregate_metrics": {
            **aggregate_metrics,
            "team_size": len({user.id for _, _, _, user in rows}),
            "repository_count": len({run.repository_id for _, run, _, _ in rows}),
        },
        "manager_dashboard_prompt": (
            "CRITICAL: Rely STRICTLY on the numerical metrics provided in the payload. "
            "DO NOT invent, guess, or hallucinate numbers like file counts or scores. "
            "DO NOT mention or evaluate Security/Vulnerabilities at all. Focus only on "
            "Code Quality, Maintainability, Architecture, and Problem Solving. "
            "DO NOT force exactly 3 items. Generate only the truly relevant team_strengths "
            "and areas_needing_attention based on the actual data. If the codebase has very "
            "low scores, it is perfectly fine to return fewer strengths, and vice versa."
        ),
    }

    try:
        raw_insights = await generate_insights(
            role="manager",
            analysis_result=analysis_payload,
            security_report={},
            doc_id=STANDARDS_DOC_ID,
        )
    except Exception:
        raw_insights = {}

    raw_insights = raw_insights if isinstance(raw_insights, dict) else {}
    insights = _normalise_team_insights(
        raw_insights,
        scores,
        aggregate_metrics,
    )
    pure_insights = {
        "team_strengths": insights.team_strengths,
        "areas_needing_attention": insights.areas_needing_attention,
    }

    if (
        "team_strengths" in raw_insights
        or "areas_needing_attention" in raw_insights
    ):
        if repo_id is None:
            current_user.global_team_insights = pure_insights
            db.add(current_user)
        elif latest_repo_run:
            latest_repo_run.ai_insights = pure_insights
        db.commit()

    return ManagerTeamInsights(**pure_insights)


@router.get("/members", response_model=list[ManagerTeamMember])
def get_manager_dashboard_members(
    repo_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id, repo_id)
    by_user: dict[int, list[ScoreRow]] = defaultdict(list)
    for row in rows:
        _, _, _, user = row
        by_user[user.id].append(row)

    members: list[ManagerTeamMember] = []
    for user_id, user_rows in by_user.items():
        user = user_rows[0][3]
        score_rows = [row[0] for row in user_rows]
        repo_ids = {row[1].repository_id for row in user_rows}

        members.append(ManagerTeamMember(
            id=user_id,
            full_name=user.full_name,
            username=user.username,
            email=user.work_email,
            avatar_url=user.avatar_url,
            specialization=user.specialization.value if user.specialization else None,
            average_overall_score=_round_score(_avg(_safe_float(score.overall_score) for score in score_rows)),
            code_quality=_round_score(_avg(_safe_float(score.code_quality_score) for score in score_rows)),
            problem_solving=_round_score(_avg(_safe_float(score.problem_solving_score) for score in score_rows)),
            architecture=_round_score(_avg(_safe_float(score.architecture_score) for score in score_rows)),
            maintainability=_round_score(_avg(_safe_float(score.maintainability_score) for score in score_rows)),
            repository_count=len(repo_ids),
            analysis_count=len(score_rows),
        ))

    return sorted(members, key=lambda member: member.average_overall_score, reverse=True)
