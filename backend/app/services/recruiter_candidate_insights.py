import logging
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.db.models import (
    AnalysisRun,
    RecruiterCandidate,
    RecruiterTask,
    Repository,
    SecurityFinding,
    SkillScore,
    SonarAnalysisSummary,
    SonarFileMeasure,
    SonarIssue,
)
from app.services.llm_client import (
    _fallback_recruiter_candidate_insights,
    generate_recruiter_candidate_insights,
)
from app.services.sonarqube_score_service import (
    build_skill_score_fields,
    compute_sonar_health_score,
    get_coverage_metadata,
    get_sonar_measure_map,
    get_sonar_payload,
    get_sonar_quality_gate_status,
)

logger = logging.getLogger(__name__)


def _safe_number(value: Any) -> float | int | None:
    if value is None or value == "" or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        numeric = float(value)
    else:
        try:
            numeric = float(value)
        except (TypeError, ValueError):
            return None
    return int(numeric) if numeric.is_integer() else numeric


def _round_metric(value: Any) -> float | int | None:
    numeric = _safe_number(value)
    if numeric is None:
        return None
    return round(float(numeric), 2)


def _rating_label(value: Any) -> str | None:
    if value is None or value == "":
        return None
    numeric = _safe_number(value)
    if numeric is not None:
        return {1: "A", 2: "B", 3: "C", 4: "D", 5: "E"}.get(int(round(float(numeric))), str(value))
    text = str(value).strip()
    return text or None


def _sonar_summary_for_dashboard(
    run: AnalysisRun,
    summary: SonarAnalysisSummary | None,
) -> dict[str, Any]:
    if summary:
        measures = summary.measures if isinstance(summary.measures, dict) else {}
        return {
            "sonar_health_score": _round_metric(summary.sonar_health_score),
            "sonar_state": "ready" if summary.sonar_health_score is not None else "sonar_unavailable",
            "quality_gate": summary.quality_gate,
            "bugs": _safe_number(measures.get("bugs")),
            "code_smells": _safe_number(measures.get("code_smells")),
            "coverage": _safe_number(measures.get("coverage")),
            "duplication_percentage": _safe_number(measures.get("duplicated_lines_density")),
            "cognitive_complexity": _safe_number(measures.get("cognitive_complexity")),
            "reliability_rating": _rating_label(measures.get("reliability_rating")),
            "maintainability_rating": _rating_label(measures.get("sqale_rating")),
            "technical_debt_minutes": _safe_number(measures.get("sqale_index")),
            "lines_of_code": _safe_number(measures.get("ncloc")),
        }

    sonar_payload = get_sonar_payload(run)
    measures = get_sonar_measure_map(sonar_payload)
    coverage_meta = get_coverage_metadata(sonar_payload)
    sonar_health_score = compute_sonar_health_score(sonar_payload)
    return {
        "sonar_health_score": _round_metric(sonar_health_score),
        "sonar_state": "ready" if sonar_health_score is not None else "sonar_unavailable",
        "quality_gate": get_sonar_quality_gate_status(sonar_payload),
        "bugs": _safe_number(measures.get("bugs")) if sonar_payload else None,
        "code_smells": _safe_number(measures.get("code_smells")) if sonar_payload else None,
        "coverage": _safe_number(measures.get("coverage")) if sonar_payload and coverage_meta.get("available") else None,
        "duplication_percentage": _safe_number(measures.get("duplicated_lines_density")) if sonar_payload else None,
        "cognitive_complexity": _safe_number(measures.get("cognitive_complexity")) if sonar_payload else None,
        "reliability_rating": _rating_label(measures.get("reliability_rating")) if sonar_payload else None,
        "maintainability_rating": _rating_label(measures.get("sqale_rating")) if sonar_payload else None,
        "technical_debt_minutes": _safe_number(measures.get("sqale_index")) if sonar_payload else None,
        "lines_of_code": _safe_number(measures.get("ncloc")) if sonar_payload else None,
    }


def build_candidate_dashboard_row(
    run: AnalysisRun,
    repo: Repository,
    score: SkillScore,
    candidate: RecruiterCandidate,
    sonar_summary: SonarAnalysisSummary | None = None,
    task: RecruiterTask | None = None,
    repo_count: int = 1,
    contribution_count: int = 1,
) -> dict[str, Any]:
    sonar = _sonar_summary_for_dashboard(run, sonar_summary)
    security_score = _round_metric(getattr(score, "security_awareness_score", None))
    skill_fields = build_skill_score_fields(
        score,
        sonar_health_score=sonar["sonar_health_score"],
        security_score=security_score,
    )
    return {
        "candidate_name": candidate.candidate_name,
        "github_login": candidate.github_login or "",
        "github_avatar_url": candidate.github_avatar_url,
        "repo_name": repo.name or repo.full_name or "",
        "repo_url": repo.url,
        "task_id": candidate.task_id,
        "task_title": task.title if task else None,
        "skill_score": _round_metric(skill_fields.get("skill_score")),
        "skill_score_level": skill_fields.get("skill_score_level") or "Unavailable",
        "sonar_health_score": sonar["sonar_health_score"],
        "sonar_state": sonar["sonar_state"],
        "security": security_score,
        "quality_gate": sonar["quality_gate"],
        "bugs": sonar["bugs"],
        "code_smells": sonar["code_smells"],
        "coverage": sonar["coverage"],
        "duplication_percentage": sonar["duplication_percentage"],
        "cognitive_complexity": sonar["cognitive_complexity"],
        "reliability_rating": sonar["reliability_rating"],
        "maintainability_rating": sonar["maintainability_rating"],
        "technical_debt_minutes": sonar["technical_debt_minutes"],
        "lines_of_code": sonar["lines_of_code"],
        "repo_count": int(repo_count or 1),
        "contribution_count": int(contribution_count or 0),
        "run_id": run.id,
        "analysis_status": run.status,
        "completed_at": run.completed_at,
    }


def _compact_sonar_issue(row: SonarIssue) -> dict[str, Any]:
    return {
        "type": row.type,
        "severity": row.severity,
        "file_path": row.file_path,
        "line": row.line,
        "rule": row.rule,
        "message": row.message,
    }


def _compact_security_finding(row: SecurityFinding) -> dict[str, Any]:
    return {
        "tool": row.tool,
        "rule": row.rule,
        "cwe": row.cwe,
        "file_path": row.file_path,
        "severity": row.severity,
        "description": row.description,
        "line_number": row.line_number,
        "owasp_category": row.owasp_category,
    }


def _compact_risky_file(row: SonarFileMeasure) -> dict[str, Any]:
    return {
        "file_path": row.file_path,
        "coverage": _safe_number(row.coverage),
        "duplicated_lines_density": _safe_number(row.duplicated_lines_density),
        "ncloc": _safe_number(row.ncloc),
        "complexity": _safe_number(row.complexity),
        "cognitive_complexity": _safe_number(row.cognitive_complexity),
    }


def _severity_rank(value: object) -> int:
    text = str(value or "").upper()
    return {
        "BLOCKER": 0,
        "CRITICAL": 1,
        "HIGH": 2,
        "MAJOR": 2,
        "MEDIUM": 3,
        "MINOR": 4,
        "LOW": 5,
        "INFO": 6,
    }.get(text, 9)


def _risky_file_rank(row: SonarFileMeasure) -> float:
    return (
        float(_safe_number(row.cognitive_complexity) or 0)
        + float(_safe_number(row.duplicated_lines_density) or 0)
        + max(0.0, 80.0 - float(_safe_number(row.coverage) or 80))
    )


def build_recruiter_candidate_llm_payload(
    row: dict[str, Any],
    run: AnalysisRun,
    repo: Repository,
    candidate: RecruiterCandidate,
    task: RecruiterTask | None,
    sonar_issues: list[SonarIssue],
    security_findings: list[SecurityFinding],
    risky_files: list[SonarFileMeasure],
) -> dict[str, Any]:
    return {
        "candidate": {
            "name": candidate.candidate_name,
            "github_login": candidate.github_login,
            "task_title": task.title if task else None,
        },
        "repository": {
            "name": repo.name,
            "full_name": repo.full_name,
            "url": repo.url,
            "branch": run.branch,
        },
        "scores": {
            "skill_score": row.get("skill_score"),
            "skill_score_level": row.get("skill_score_level"),
            "sonar_health_score": row.get("sonar_health_score"),
            "security_score": row.get("security"),
            "quality_gate": row.get("quality_gate"),
        },
        "sonar_metrics": {
            "bugs": row.get("bugs"),
            "code_smells": row.get("code_smells"),
            "coverage": row.get("coverage"),
            "duplication_percentage": row.get("duplication_percentage"),
            "cognitive_complexity": row.get("cognitive_complexity"),
            "technical_debt_minutes": row.get("technical_debt_minutes"),
            "lines_of_code": row.get("lines_of_code"),
            "reliability_rating": row.get("reliability_rating"),
            "maintainability_rating": row.get("maintainability_rating"),
        },
        "top_sonar_issues": [_compact_sonar_issue(item) for item in sonar_issues[:10]],
        "top_security_findings": [_compact_security_finding(item) for item in security_findings[:10]],
        "risky_files": [_compact_risky_file(item) for item in risky_files[:10]],
    }


def get_cached_recruiter_candidate_insight(run: AnalysisRun | None) -> dict[str, Any] | None:
    ai_insights = getattr(run, "ai_insights", None)
    if not isinstance(ai_insights, dict):
        return None
    cached = ai_insights.get("recruiter_candidate_insight")
    if not isinstance(cached, dict):
        return None
    insight = cached.get("insight")
    if not isinstance(insight, dict):
        return None
    return cached


def set_cached_recruiter_candidate_insight(
    run: AnalysisRun,
    insight: dict[str, Any],
    model_source: str,
) -> dict[str, Any]:
    cache_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_source": model_source,
        "payload_version": 1,
        "insight": insight,
    }
    ai_insights = dict(run.ai_insights) if isinstance(run.ai_insights, dict) else {}
    ai_insights["recruiter_candidate_insight"] = cache_payload
    run.ai_insights = ai_insights
    flag_modified(run, "ai_insights")
    return cache_payload


def _candidate_context(
    db: Session,
    run_id: int,
    recruiter_user_id: int,
) -> tuple[AnalysisRun, Repository, SkillScore, RecruiterCandidate, SonarAnalysisSummary | None, RecruiterTask | None, dict[str, Any]]:
    row = (
        db.query(AnalysisRun, Repository, SkillScore, RecruiterCandidate, SonarAnalysisSummary, RecruiterTask)
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .join(
            SkillScore,
            (SkillScore.analysis_run_id == AnalysisRun.id) & (SkillScore.user_id == recruiter_user_id),
        )
        .join(RecruiterCandidate, RecruiterCandidate.analysis_run_id == AnalysisRun.id)
        .outerjoin(SonarAnalysisSummary, SonarAnalysisSummary.analysis_run_id == AnalysisRun.id)
        .outerjoin(RecruiterTask, RecruiterTask.id == RecruiterCandidate.task_id)
        .filter(
            AnalysisRun.id == run_id,
            AnalysisRun.user_id == recruiter_user_id,
            SkillScore.user_id == recruiter_user_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Candidate analysis not found")

    run, repo, score, candidate, sonar_summary, task = row
    if run.status != "completed":
        raise HTTPException(status_code=400, detail="Candidate analysis is not completed")
    if task and task.recruiter_id != recruiter_user_id:
        raise HTTPException(status_code=404, detail="Candidate analysis not found")

    dashboard_row = build_candidate_dashboard_row(
        run,
        repo,
        score,
        candidate,
        sonar_summary,
        task,
        repo_count=1,
        contribution_count=1,
    )
    return run, repo, score, candidate, sonar_summary, task, dashboard_row


def generate_and_cache_recruiter_candidate_insight(
    db: Session,
    run_id: int,
    recruiter_user_id: int,
    force_refresh: bool = False,
) -> tuple[dict[str, Any], dict[str, Any]]:
    run, repo, _score, candidate, _sonar_summary, task, dashboard_row = _candidate_context(
        db,
        run_id,
        recruiter_user_id,
    )

    cached = get_cached_recruiter_candidate_insight(run)
    if cached and not force_refresh:
        return dashboard_row, cached

    sonar_issues = (
        db.query(SonarIssue)
        .filter(SonarIssue.analysis_run_id == run.id)
        .all()
    )
    sonar_issues = sorted(
        sonar_issues,
        key=lambda item: (_severity_rank(item.severity), item.file_path or "", item.line or 0),
    )[:10]

    security_findings = (
        db.query(SecurityFinding)
        .filter(SecurityFinding.analysis_run_id == run.id)
        .all()
    )
    security_findings = sorted(
        security_findings,
        key=lambda item: (_severity_rank(item.severity), item.file_path or "", item.line_number or 0),
    )[:10]

    file_measures = (
        db.query(SonarFileMeasure)
        .filter(SonarFileMeasure.analysis_run_id == run.id)
        .all()
    )
    risky_files = sorted(file_measures, key=_risky_file_rank, reverse=True)[:10]

    llm_payload = build_recruiter_candidate_llm_payload(
        dashboard_row,
        run,
        repo,
        candidate,
        task,
        sonar_issues,
        security_findings,
        risky_files,
    )

    ai_mode = (os.environ.get("AI_MODE") or "openrouter").lower()
    model_source = ai_mode if ai_mode in {"openrouter", "ollama"} else "openrouter"
    try:
        insight = generate_recruiter_candidate_insights(llm_payload)
    except Exception as exc:
        logger.warning(
            "recruiter_candidate_insights failed; using fallback for run_id=%s: %s",
            run.id,
            exc,
        )
        insight = _fallback_recruiter_candidate_insights(llm_payload)
        model_source = "fallback"

    cached_payload = set_cached_recruiter_candidate_insight(run, insight, model_source)
    db.commit()
    return dashboard_row, cached_payload
