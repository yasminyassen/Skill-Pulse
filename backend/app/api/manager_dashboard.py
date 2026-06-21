from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Iterable

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.auth_utils import require_role
from app.db.database import get_db
from app.db.models import AnalysisRun, CodeMetrics, Repository, SkillScore, User, UserRole
from app.schemas.manager_schemas import (
    ManagerActionableRecommendations,
    ManagerDashboardRepo,
    ManagerKpis,
    ManagerMemberDetail,
    ManagerSkillDistribution,
    ManagerTeamInsights,
    ManagerTeamMember,
    ManagerTopPerformer,
    ManagerTrendPoint,
)
from ai_services.insights.ai_insights import generate_insights
from ai_services.rag.rag_seeder import STANDARDS_DOC_ID


router = APIRouter(prefix="/manager/dashboard", tags=["manager-dashboard"])


MANAGER_INSIGHT_STYLE_VERSION = "manager_action_recommendations_v2"
MEMBER_DETAIL_STYLE_VERSION = "manager_member_detail_v1"
RECOMMENDATION_BUCKET_KEYS = (
    "mandatory",
    "highly_required",
    "nice_to_have",
    "enhanced",
)
DEFAULT_TREND_RANGE = "6m"

SKILL_KEYS = ("code_quality", "problem_solving", "architecture", "maintainability")
SKILL_LABELS = {
    "code_quality": "Code Quality",
    "problem_solving": "Problem Solving",
    "architecture": "Architecture",
    "maintainability": "Maintainability",
}

MANAGER_DASHBOARD_PROMPT = (
    "CRITICAL: Rely STRICTLY on the numerical metrics provided in the payload. "
    "DO NOT invent, guess, or hallucinate numbers like file counts or scores. "
    "DO NOT mention or evaluate Security/Vulnerabilities at all. Focus only on "
    "Code Quality, Maintainability, Architecture, and Problem Solving. "
    "Return ONLY valid JSON with exactly one top-level key: actionable_recommendations. "
    "actionable_recommendations must contain exactly these bucket keys: "
    "mandatory, highly_required, nice_to_have, enhanced. "
    "Each bucket is a list of manager-facing recommendation strings grounded in the metrics. "
    "mandatory = critical delivery or regression risk. "
    "highly_required = important velocity or quality issues. "
    "nice_to_have = low-risk polish when capacity allows. "
    "enhanced = strength-based leverage opportunities. "
    "Generate only genuinely relevant items; empty buckets are allowed."
)

MANAGER_MEMBER_DETAIL_PROMPT = (
    "You are advising an Engineering Manager about one developer on their team. "
    "Return ONLY valid JSON with exactly two keys: key_strengths and areas_for_improvement. "
    "Write to the manager, not to the developer. "
    "Use only the exact values provided in the payload. "
    "Discuss only Code Quality, Maintainability, Architecture, and Problem Solving. "
    "Do NOT mention Security, Vulnerabilities, OWASP, or compliance. "
    "Each item must cite at least one exact metric from the payload."
)


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


def _model_to_dict(model: object) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _run_time(run: AnalysisRun) -> datetime:
    value = run.completed_at or run.triggered_at or datetime.min.replace(tzinfo=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _normalise_trend_range(range_value: str | None) -> str:
    value = (range_value or DEFAULT_TREND_RANGE).strip().lower()
    if value == "1y":
        value = "12m"
    allowed = {"30d", "90d", "6m", "12m", "all"}
    if value not in allowed:
        return DEFAULT_TREND_RANGE
    return value


def _trend_range_start(range_key: str, reference: datetime | None = None) -> datetime | None:
    if range_key == "all":
        return None
    now = reference or datetime.now(timezone.utc)
    offsets = {
        "30d": timedelta(days=30),
        "90d": timedelta(days=90),
        "6m": timedelta(days=183),
        "12m": timedelta(days=365),
    }
    return now - offsets[range_key]


def _filter_rows_by_trend_range(rows: list[ScoreRow], range_key: str) -> list[ScoreRow]:
    start = _trend_range_start(range_key)
    if start is None:
        return rows
    return [row for row in rows if _run_time(row[1]) >= start]


def _trend_group_key(run_time: datetime, range_key: str) -> tuple[str, str]:
    if range_key == "30d":
        return run_time.strftime("%Y-%m-%d"), run_time.strftime("%b %d")
    if range_key == "90d":
        iso = run_time.isocalendar()
        return f"{iso.year}-W{iso.week:02d}", f"Week {iso.week}"
    period = run_time.strftime("%Y-%m")
    return period, run_time.strftime("%b %Y")


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


def _empty_actionable_recommendations() -> ManagerActionableRecommendations:
    return ManagerActionableRecommendations()


def _normalise_recommendation_items(items: object) -> list[str]:
    if not isinstance(items, list):
        return []
    result: list[str] = []
    for item in items:
        text = str(item).strip()
        if text:
            result.append(text)
    return result


def _fallback_team_insights(scores: dict[str, float], metrics: dict) -> ManagerTeamInsights:
    recommendations = _empty_actionable_recommendations()
    test_files = int(metrics.get("test_files") or 0)
    total_files = int(metrics.get("total_files_analyzed") or 0)

    if test_files == 0 and total_files > 0:
        recommendations.mandatory.append(
            f"Zero test files across {total_files} analyzed files creates unmanaged regression risk; "
            "release confidence depends on manual verification."
        )

    doc_cov = metrics.get("avg_docstring_coverage")
    if doc_cov is not None and _safe_float(doc_cov) < 0.25 and total_files > 0:
        recommendations.highly_required.append(
            f"Docstring coverage at {_safe_float(doc_cov) * 100:.0f}% increases handoff friction and onboarding cost."
        )

    for key, label in SKILL_LABELS.items():
        value = scores.get(key, 0.0)
        if value >= 80.0:
            recommendations.enhanced.append(
                f"{label} score of {value:.0f}/100 indicates a leverage opportunity for expanded ownership."
            )
        elif 0.0 < value < 40.0:
            recommendations.mandatory.append(
                f"{label} score of {value:.0f}/100 is critically low and increases delivery risk."
            )

    style_violations = int(metrics.get("style_violations") or 0)
    if 0 < style_violations <= 10:
        recommendations.nice_to_have.append(
            f"{style_violations} style violations remain low-risk polish items when review capacity allows."
        )

    return ManagerTeamInsights(actionable_recommendations=recommendations)


def _normalise_team_insights(
    raw: dict,
    scores: dict[str, float],
    metrics: dict,
) -> ManagerTeamInsights:
    fallback = _fallback_team_insights(scores, metrics)
    raw_buckets = raw.get("actionable_recommendations")
    if not isinstance(raw_buckets, dict):
        return fallback

    recommendations = _empty_actionable_recommendations()
    for bucket in RECOMMENDATION_BUCKET_KEYS:
        items = _normalise_recommendation_items(raw_buckets.get(bucket))
        setattr(recommendations, bucket, items if items else getattr(fallback.actionable_recommendations, bucket))

    if not any(getattr(recommendations, bucket) for bucket in RECOMMENDATION_BUCKET_KEYS):
        return fallback

    return ManagerTeamInsights(actionable_recommendations=recommendations)


def _manager_team_insight_payload(insights: ManagerTeamInsights) -> dict:
    return {
        "style_version": MANAGER_INSIGHT_STYLE_VERSION,
        "actionable_recommendations": _model_to_dict(insights.actionable_recommendations),
    }


def _merge_preserved_member_details(existing: object, new_insights: dict) -> dict:
    result = dict(new_insights)
    if isinstance(existing, dict) and isinstance(existing.get("member_detail_insights"), dict):
        result["member_detail_insights"] = existing["member_detail_insights"]
    return result


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


def _insights_from_payload(payload: dict) -> ManagerTeamInsights | None:
    buckets = payload.get("actionable_recommendations")
    if not isinstance(buckets, dict):
        return None

    recommendations = _empty_actionable_recommendations()
    for bucket in RECOMMENDATION_BUCKET_KEYS:
        setattr(recommendations, bucket, _normalise_recommendation_items(buckets.get(bucket)))

    return ManagerTeamInsights(actionable_recommendations=recommendations)


def _cached_team_insights(payload: dict | None) -> ManagerTeamInsights | None:
    if not isinstance(payload, dict):
        return None
    if payload.get("style_version") != MANAGER_INSIGHT_STYLE_VERSION:
        return None
    return _insights_from_payload(payload)


def _trend_point_from_rows(
    period: str,
    label: str,
    rows: list[ScoreRow],
) -> ManagerTrendPoint:
    developer_averages = _average_scores_by_developer(rows)
    return ManagerTrendPoint(
        period=period,
        label=label,
        average_score=_team_average_from_developer_averages(developer_averages, "overall"),
        code_quality=_team_average_from_developer_averages(developer_averages, "code_quality"),
        problem_solving=_team_average_from_developer_averages(developer_averages, "problem_solving"),
        architecture=_team_average_from_developer_averages(developer_averages, "architecture"),
        maintainability=_team_average_from_developer_averages(developer_averages, "maintainability"),
    )


def _build_trend_points(rows: list[ScoreRow], range_key: str) -> list[ManagerTrendPoint]:
    range_key = _normalise_trend_range(range_key)
    filtered_rows = _filter_rows_by_trend_range(rows, range_key)
    grouped: dict[str, tuple[str, list[ScoreRow]]] = {}

    for row in filtered_rows:
        _, run, _, _ = row
        period, label = _trend_group_key(_run_time(run), range_key)
        if period not in grouped:
            grouped[period] = (label, [])
        grouped[period][1].append(row)

    return [
        _trend_point_from_rows(period, grouped[period][0], grouped[period][1])
        for period in sorted(grouped)
    ]


def _trend_average_for_rows(rows: list[ScoreRow]) -> float:
    developer_averages = _average_scores_by_developer(rows)
    return _team_average_from_developer_averages(developer_averages, "overall")


def _calculate_growth_rate(rows: list[ScoreRow]) -> float:
    points = _build_trend_points(rows, "all")
    if len(points) < 2:
        return 0.0
    return _round_score(points[-1].average_score - points[-2].average_score)


def _member_overall_delta(rows: list[ScoreRow]) -> float | None:
    points = _build_trend_points(rows, "all")
    if len(points) < 2:
        return None
    return _round_score(points[-1].average_score - points[-2].average_score)


def _member_from_rows(rows: list[ScoreRow]) -> ManagerTeamMember:
    user = rows[0][3]
    score_rows = [row[0] for row in rows]
    repo_ids = {row[1].repository_id for row in rows}

    return ManagerTeamMember(
        id=user.id,
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
        overall_delta=_member_overall_delta(rows),
    )


def _build_member_skill_summary(scores: dict[str, float]) -> dict:
    ranked = sorted(
        ((key, scores.get(key, 0.0)) for key in SKILL_KEYS),
        key=lambda item: item[1],
        reverse=True,
    )
    strongest_key, strongest_score = ranked[0]
    weakest_key, weakest_score = ranked[-1]
    return {
        "strongest": {
            "key": strongest_key,
            "label": SKILL_LABELS[strongest_key],
            "score": _round_score(strongest_score),
        },
        "weakest": {
            "key": weakest_key,
            "label": SKILL_LABELS[weakest_key],
            "score": _round_score(weakest_score),
        },
    }


def _normalise_member_detail_insights(raw: dict) -> tuple[list[str], list[str]]:
    strengths = _normalise_recommendation_items(raw.get("key_strengths"))
    improvements = _normalise_recommendation_items(raw.get("areas_for_improvement"))
    return strengths, improvements


def _member_detail_cache_root(user: User) -> dict:
    payload = user.global_team_insights
    if not isinstance(payload, dict):
        return {}
    member_details = payload.get("member_detail_insights")
    if not isinstance(member_details, dict):
        return {}
    return member_details


def _cached_member_detail_insights(
    user: User,
    member_id: int,
    run_ids: list[int],
) -> tuple[list[str], list[str]] | None:
    cached = _member_detail_cache_root(user).get(str(member_id))
    if not isinstance(cached, dict):
        return None
    if cached.get("style_version") != MEMBER_DETAIL_STYLE_VERSION:
        return None
    cached_run_ids = cached.get("run_ids")
    if not isinstance(cached_run_ids, list) or sorted(cached_run_ids) != sorted(run_ids):
        return None
    strengths = _normalise_recommendation_items(cached.get("key_strengths"))
    improvements = _normalise_recommendation_items(cached.get("areas_for_improvement"))
    return strengths, improvements


def _store_member_detail_insights(
    db: Session,
    user: User,
    member_id: int,
    run_ids: list[int],
    strengths: list[str],
    improvements: list[str],
) -> None:
    existing = user.global_team_insights if isinstance(user.global_team_insights, dict) else {}
    member_details = dict(existing.get("member_detail_insights") or {})
    member_details[str(member_id)] = {
        "style_version": MEMBER_DETAIL_STYLE_VERSION,
        "run_ids": sorted(run_ids),
        "key_strengths": strengths,
        "areas_for_improvement": improvements,
    }
    merged = dict(existing)
    merged["member_detail_insights"] = member_details
    user.global_team_insights = merged
    flag_modified(user, "global_team_insights")
    db.add(user)


async def _generate_and_store_member_detail_insights_from_rows(
    db: Session,
    current_user: User,
    member_rows: list[ScoreRow],
) -> tuple[list[str], list[str]]:
    if not member_rows:
        return [], []

    member = _member_from_rows(member_rows)
    timeline = _build_trend_points(member_rows, DEFAULT_TREND_RANGE)
    run_ids = _analysis_run_ids(member_rows)
    scores = _build_team_score_payload(member_rows)
    aggregate_metrics = _build_team_aggregate_metrics(db, run_ids)
    skill_summary = _build_member_skill_summary(scores)

    analysis_payload = {
        "developer": {
            "name": member.full_name,
            "specialization": member.specialization,
            "analysis_count": member.analysis_count,
            "repository_count": member.repository_count,
            "overall_delta": member.overall_delta,
        },
        "scores": scores,
        "aggregate_metrics": aggregate_metrics,
        "skill_summary": skill_summary,
        "timeline": [_model_to_dict(point) for point in timeline],
        "manager_member_detail_prompt": MANAGER_MEMBER_DETAIL_PROMPT,
    }

    try:
        raw_insights = await generate_insights(
            role="manager_member",
            analysis_result=analysis_payload,
            security_report={},
            doc_id=STANDARDS_DOC_ID,
        )
    except Exception:
        raw_insights = {}

    raw_insights = raw_insights if isinstance(raw_insights, dict) else {}
    strengths, improvements = _normalise_member_detail_insights(raw_insights)
    _store_member_detail_insights(
        db,
        current_user,
        member.id,
        run_ids,
        strengths,
        improvements,
    )
    return strengths, improvements


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
    range: str = Query(default=DEFAULT_TREND_RANGE),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id, repo_id)
    return _build_trend_points(rows, range)


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
        return ManagerTeamInsights(actionable_recommendations=_empty_actionable_recommendations())

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
        "manager_dashboard_prompt": MANAGER_DASHBOARD_PROMPT,
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
    pure_insights = _manager_team_insight_payload(insights)

    if "actionable_recommendations" in raw_insights:
        if repo_id is None:
            current_user.global_team_insights = _merge_preserved_member_details(
                current_user.global_team_insights,
                pure_insights,
            )
            flag_modified(current_user, "global_team_insights")
            db.add(current_user)
        elif latest_repo_run:
            latest_repo_run.ai_insights = pure_insights
        db.commit()

    return insights


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

    members = [_member_from_rows(user_rows) for user_rows in by_user.values()]
    return sorted(members, key=lambda member: member.average_overall_score, reverse=True)


@router.get("/members/{member_id}/details", response_model=ManagerMemberDetail)
def get_manager_dashboard_member_details(
    member_id: int,
    range: str = Query(default=DEFAULT_TREND_RANGE),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    rows = _query_manager_score_rows(db, current_user.id)
    member_rows = [row for row in rows if row[3].id == member_id]
    if not member_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Developer not found in manager dashboard scope.",
        )

    member = _member_from_rows(member_rows)
    timeline = _build_trend_points(member_rows, range)
    run_ids = _analysis_run_ids(member_rows)
    cached_insights = _cached_member_detail_insights(current_user, member_id, run_ids)
    strengths, improvements = cached_insights if cached_insights is not None else ([], [])

    return ManagerMemberDetail(
        member=member,
        timeline=timeline,
        key_strengths=strengths,
        areas_for_improvement=improvements,
    )
