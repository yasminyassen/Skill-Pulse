from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.auth_utils import require_role
from app.db.database import get_db
from app.db.models import AnalysisRun, ContributorAnalysisSummary, Repository, SecurityFinding, SkillScore, User, UserRole
from app.schemas.manager_security_schemas import (
    CommonSecurityIssue,
    ContributorIssueGroup,
    ContributorSecurityImpact,
    DetectedVulnerability,
    ManagerSecurityRepo,
    RepositoryRiskItem,
    RepositoryRiskResponse,
    RepositorySecurityDetail,
    RepositorySecuritySummary,
    SecurityMemberScore,
    SecurityRiskBreakdown,
    SecurityTrendPoint,
    TeamSecurityOverview,
)
from app.services.issue_progress import user_issue_delta
from app.services.security_service import normalize_severity


router = APIRouter(prefix="/manager/security", tags=["manager-security"])

SEVERITY_ORDER = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}


def _run_time(run: AnalysisRun) -> datetime:
    value = run.completed_at or run.triggered_at or datetime.min.replace(tzinfo=timezone.utc)
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _round_score(value: float) -> float:
    return round(float(value or 0.0), 2)


def _avg(values: list[float]) -> float:
    return sum(values) / len(values) if values else 0.0


def _latest_manager_runs_by_repo(db: Session, manager_id: int) -> list[AnalysisRun]:
    runs = (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.analysis_scope == "team_contributions",
            AnalysisRun.status == "completed",
        )
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.triggered_at.desc())
        .all()
    )
    latest: dict[int, AnalysisRun] = {}
    for run in runs:
        if run.repository_id not in latest:
            latest[run.repository_id] = run
    return list(latest.values())


def _latest_repository_runs_by_repo(db: Session, manager_id: int) -> list[AnalysisRun]:
    row_number = func.row_number().over(
        partition_by=AnalysisRun.repository_id,
        order_by=(
            AnalysisRun.completed_at.desc(),
            AnalysisRun.triggered_at.desc(),
            AnalysisRun.id.desc(),
        ),
    ).label("row_number")
    ranked_runs = (
        db.query(AnalysisRun.id.label("analysis_run_id"), row_number)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.analysis_scope == "repository",
            AnalysisRun.status == "completed",
        )
        .subquery()
    )
    return (
        db.query(AnalysisRun)
        .join(ranked_runs, AnalysisRun.id == ranked_runs.c.analysis_run_id)
        .filter(ranked_runs.c.row_number == 1)
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.triggered_at.desc(), AnalysisRun.id.desc())
        .all()
    )


def _latest_repository_run_for_repo(db: Session, manager_id: int, repo_id: int) -> AnalysisRun | None:
    return (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.repository_id == repo_id,
            AnalysisRun.analysis_scope == "repository",
            AnalysisRun.status == "completed",
        )
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.triggered_at.desc(), AnalysisRun.id.desc())
        .first()
    )


def _latest_manager_run_for_repo(db: Session, manager_id: int, repo_id: int) -> AnalysisRun | None:
    return (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.repository_id == repo_id,
            AnalysisRun.analysis_scope == "team_contributions",
            AnalysisRun.status == "completed",
        )
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.triggered_at.desc())
        .first()
    )


def _previous_manager_run_for_repo(
    db: Session,
    manager_id: int,
    repo_id: int,
    current_run_id: int,
) -> AnalysisRun | None:
    return (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.repository_id == repo_id,
            AnalysisRun.id != current_run_id,
            AnalysisRun.analysis_scope == "team_contributions",
            AnalysisRun.status == "completed",
        )
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.triggered_at.desc())
        .first()
    )


def _manager_runs_for_repo_until(
    db: Session,
    manager_id: int,
    repo_id: int,
    current_run: AnalysisRun,
) -> list[AnalysisRun]:
    current_time = _run_time(current_run)
    runs = (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.repository_id == repo_id,
            AnalysisRun.analysis_scope == "team_contributions",
            AnalysisRun.status == "completed",
        )
        .order_by(AnalysisRun.completed_at.asc(), AnalysisRun.triggered_at.asc(), AnalysisRun.id.asc())
        .all()
    )
    return [
        run
        for run in runs
        if run.id == current_run.id or _run_time(run) <= current_time
    ]


def _findings_for_runs(db: Session, run_ids: list[int]) -> list[SecurityFinding]:
    if not run_ids:
        return []
    return (
        db.query(SecurityFinding)
        .filter(SecurityFinding.analysis_run_id.in_(run_ids))
        .all()
    )


def _dedupe_findings(findings: list[SecurityFinding]) -> list[SecurityFinding]:
    seen: set[tuple] = set()
    result: list[SecurityFinding] = []
    for finding in findings:
        key = (
            finding.analysis_run_id,
            (finding.file_path or "").replace("\\", "/").strip().lower(),
            (finding.rule or "").strip().lower(),
            finding.line_number or 0,
            (finding.cwe or "").strip().upper(),
            normalize_severity(finding.severity),
        )
        if key in seen:
            continue
        seen.add(key)
        result.append(finding)
    return result


def _user_issue_delta(
    current_findings: list[SecurityFinding],
    previous_findings: list[SecurityFinding],
) -> dict[int, dict[str, int]]:
    return user_issue_delta(current_findings, previous_findings, _dedupe_findings)


def _cumulative_user_issue_delta(db: Session, runs: list[AnalysisRun]) -> dict[int, dict[str, int]]:
    if len(runs) < 2:
        return {}

    result: dict[int, dict[str, int]] = defaultdict(lambda: {"introduced": 0, "fixed": 0})
    previous_findings = _dedupe_findings(_findings_for_runs(db, [runs[0].id]))
    for run in runs[1:]:
        current_findings = _dedupe_findings(_findings_for_runs(db, [run.id]))
        step_delta = _user_issue_delta(current_findings, previous_findings)
        for user_id, delta in step_delta.items():
            result[user_id]["introduced"] += int(delta.get("introduced", 0))
            result[user_id]["fixed"] += int(delta.get("fixed", 0))
        previous_findings = current_findings
    return dict(result)


def _risk_breakdown(findings: list[SecurityFinding]) -> SecurityRiskBreakdown:
    counts = Counter(normalize_severity(finding.severity) for finding in findings)
    high = counts.get("HIGH", 0)
    medium = counts.get("MEDIUM", 0)
    low = counts.get("LOW", 0)
    return SecurityRiskBreakdown(high=high, medium=medium, low=low, total=high + medium + low)


def _repository_security_scores_for_runs(db: Session, run_ids: list[int], manager_id: int) -> dict[int, float]:
    if not run_ids:
        return {}
    rows = (
        db.query(SkillScore.analysis_run_id, SkillScore.security_awareness_score)
        .filter(
            SkillScore.analysis_run_id.in_(run_ids),
            SkillScore.user_id == manager_id,
        )
        .all()
    )
    return {
        int(run_id): _round_score(float(score or 0.0))
        for run_id, score in rows
    }


def _repository_security_score_for_run(db: Session, run: AnalysisRun | None, manager_id: int) -> float:
    if run is None:
        return 0.0
    scores = _repository_security_scores_for_runs(db, [run.id], manager_id)
    return scores.get(run.id, 0.0)


def _average_repository_security_score(db: Session, runs: list[AnalysisRun], manager_id: int) -> float:
    scores = _repository_security_scores_for_runs(db, [run.id for run in runs], manager_id)
    return _round_score(_avg([scores.get(run.id, 0.0) for run in runs]))


def _issue_title(finding: SecurityFinding) -> str:
    text = " ".join(
        str(part or "")
        for part in (finding.rule, finding.description, finding.cwe, finding.owasp_category)
    ).lower()
    if any(token in text for token in ("secret", "password", "token", "credential", "api key")):
        return "Insecure secret management"
    if any(token in text for token in ("sql", "injection", "xss", "validation", "sanitize", "cwe-79", "cwe-89")):
        return "Input validation weaknesses"
    if any(token in text for token in ("auth", "session", "jwt", "access control", "permission", "cwe-287", "cwe-306", "cwe-862", "cwe-863")):
        return "Weak authentication patterns"
    if any(token in text for token in ("dependency", "package", "requirements", "safety", "vulnerable")):
        return "Vulnerable dependencies"
    if any(token in text for token in ("config", "debug", "cors", "misconfiguration")):
        return "Security misconfiguration"
    return finding.rule or finding.owasp_category or finding.cwe or "Unclassified security issue"


def _common_issues(findings: list[SecurityFinding], run_repo_ids: dict[int, int]) -> list[CommonSecurityIssue]:
    grouped: dict[str, dict] = {}
    for finding in findings:
        title = _issue_title(finding)
        entry = grouped.setdefault(
            title,
            {"count": 0, "repos": set(), "severity": "LOW"},
        )
        entry["count"] += 1
        repo_id = run_repo_ids.get(finding.analysis_run_id)
        if repo_id is not None:
            entry["repos"].add(repo_id)
        severity = normalize_severity(finding.severity)
        if SEVERITY_ORDER[severity] > SEVERITY_ORDER[entry["severity"]]:
            entry["severity"] = severity

    return [
        CommonSecurityIssue(
            title=title,
            severity=data["severity"].title(),
            occurrences=data["count"],
            repositories_affected=len(data["repos"]),
        )
        for title, data in sorted(grouped.items(), key=lambda item: item[1]["count"], reverse=True)[:5]
    ]


def _trend(db: Session, manager_id: int) -> list[SecurityTrendPoint]:
    runs = (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == manager_id,
            AnalysisRun.analysis_scope == "team_contributions",
            AnalysisRun.status == "completed",
        )
        .order_by(AnalysisRun.completed_at.asc(), AnalysisRun.triggered_at.asc())
        .all()
    )
    run_ids = [run.id for run in runs]
    run_by_id = {run.id: run for run in runs}
    grouped: dict[str, Counter] = defaultdict(Counter)
    for finding in _dedupe_findings(_findings_for_runs(db, run_ids)):
        run = run_by_id.get(finding.analysis_run_id)
        if not run:
            continue
        when = _run_time(run)
        period = when.strftime("%Y-%m")
        grouped[period][normalize_severity(finding.severity)] += 1

    return [
        SecurityTrendPoint(
            period=period,
            label=datetime.strptime(period, "%Y-%m").strftime("%b"),
            high=counts.get("HIGH", 0),
            medium=counts.get("MEDIUM", 0),
            low=counts.get("LOW", 0),
        )
        for period, counts in sorted(grouped.items())[-3:]
    ]


def _systemic_analysis(common: list[CommonSecurityIssue], repo_count: int) -> str:
    if not common:
        return "No recurring security pattern is visible in the latest manager-run repository analyses."
    top = common[0]
    if top.repositories_affected > 1:
        return (
            f"{top.title} appears {top.occurrences} times across {top.repositories_affected} repositories, "
            "which points to a process-level pattern rather than an isolated implementation mistake."
        )
    return (
        f"The most common current issue is {top.title.lower()} with {top.occurrences} occurrence(s). "
        f"Across {repo_count} repository analysis snapshot(s), this is best treated as a targeted remediation item."
    )


def _why_this_matters() -> list[str]:
    return [
        "Early detection reduces the chance that preventable vulnerabilities reach production.",
        "Shared security patterns help managers prioritize coaching and review standards across the team.",
        "Continuous security monitoring keeps release decisions tied to current repository evidence.",
    ]


def _member_scores(db: Session, run_ids: list[int]) -> list[SecurityMemberScore]:
    if not run_ids:
        return []
    rows = (
        db.query(SkillScore, AnalysisRun, User)
        .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
        .join(User, SkillScore.user_id == User.id)
        .filter(SkillScore.analysis_run_id.in_(run_ids), User.role == UserRole.developer)
        .all()
    )
    findings = _findings_for_runs(db, run_ids)
    findings_by_user: dict[int, list[SecurityFinding]] = defaultdict(list)
    for finding in findings:
        if finding.user_id is not None:
            findings_by_user[finding.user_id].append(finding)

    grouped: dict[int, dict] = {}
    for score, run, user in rows:
        entry = grouped.setdefault(user.id, {"user": user, "scores": [], "repos": set()})
        entry["scores"].append(float(score.security_awareness_score or 0.0))
        entry["repos"].add(run.repository_id)

    result: list[SecurityMemberScore] = []
    for user_id, data in grouped.items():
        breakdown = _risk_breakdown(_dedupe_findings(findings_by_user.get(user_id, [])))
        user = data["user"]
        result.append(
            SecurityMemberScore(
                id=user.id,
                full_name=user.full_name,
                username=user.username,
                avatar_url=user.avatar_url,
                specialization=user.specialization.value if user.specialization else None,
                repository_count=len(data["repos"]),
                security_score=_round_score(_avg(data["scores"])),
                high=breakdown.high,
                medium=breakdown.medium,
                low=breakdown.low,
            )
        )
    return sorted(result, key=lambda item: item.security_score)


def _vulnerability_item(
    finding: SecurityFinding,
    users_by_id: dict[int, User],
    *,
    include_contributor: bool = True,
) -> DetectedVulnerability:
    contributor = (
        users_by_id.get(finding.user_id)
        if include_contributor and finding.user_id is not None
        else None
    )
    return DetectedVulnerability(
        id=finding.id,
        title=_issue_title(finding),
        severity=normalize_severity(finding.severity).title(),
        description=finding.description,
        file_path=finding.file_path,
        line_number=finding.line_number,
        cwe=finding.cwe,
        owasp_category=finding.owasp_category,
        contributor_id=contributor.id if contributor else None,
        contributor_name=contributor.full_name if contributor else None,
    )


def _users_by_id_for_findings(db: Session, findings: list[SecurityFinding], fallback_run_id: int | None = None) -> dict[int, User]:
    user_ids = {finding.user_id for finding in findings if finding.user_id is not None}
    if fallback_run_id is not None:
        user_ids.update(
            user_id
            for (user_id,) in (
                db.query(ContributorAnalysisSummary.user_id)
                .filter(ContributorAnalysisSummary.analysis_run_id == fallback_run_id)
                .all()
            )
            if user_id is not None
        )
        user_ids.update(
            user_id
            for (user_id,) in (
                db.query(SkillScore.user_id)
                .filter(SkillScore.analysis_run_id == fallback_run_id)
                .all()
            )
            if user_id is not None
        )
    if not user_ids:
        return {}
    return {
        user.id: user
        for user in db.query(User).filter(User.id.in_(user_ids)).all()
    }


def _contributors_for_team_run(db: Session, run_id: int) -> list[User]:
    rows = (
        db.query(User)
        .join(ContributorAnalysisSummary, ContributorAnalysisSummary.user_id == User.id)
        .filter(
            ContributorAnalysisSummary.analysis_run_id == run_id,
            User.role == UserRole.developer,
        )
        .order_by(User.full_name.asc(), User.username.asc())
        .all()
    )
    if rows:
        return rows
    return (
        db.query(User)
        .join(SkillScore, SkillScore.user_id == User.id)
        .filter(SkillScore.analysis_run_id == run_id, User.role == UserRole.developer)
        .order_by(User.full_name.asc(), User.username.asc())
        .all()
    )


def _issues_grouped_by_contributor(
    findings: list[SecurityFinding],
    users_by_id: dict[int, User],
    contributors: list[User] | None = None,
) -> list[ContributorIssueGroup]:
    grouped: dict[int | None, list[SecurityFinding]] = defaultdict(list)
    for contributor in contributors or []:
        grouped[contributor.id]
    for finding in findings:
        grouped[finding.user_id].append(finding)

    result: list[ContributorIssueGroup] = []
    for user_id, rows in grouped.items():
        user = users_by_id.get(user_id) if user_id is not None else None
        deduped_rows = _dedupe_findings(rows)
        vulnerabilities = sorted(
            [_vulnerability_item(finding, users_by_id) for finding in deduped_rows],
            key=lambda item: SEVERITY_ORDER.get(item.severity.upper(), 0),
            reverse=True,
        )
        breakdown = _risk_breakdown(deduped_rows)
        result.append(
            ContributorIssueGroup(
                contributor_id=user.id if user else None,
                contributor_name=user.full_name if user else "Unattributed",
                username=user.username if user else None,
                high=breakdown.high,
                medium=breakdown.medium,
                low=breakdown.low,
                issues=vulnerabilities,
            )
        )

    return sorted(
        result,
        key=lambda item: (item.high, item.medium, item.low, len(item.issues), item.contributor_name),
        reverse=True,
    )


def _release_readiness(repo_name: str | None, breakdown: SecurityRiskBreakdown) -> str:
    label = repo_name or "This repository"
    if breakdown.high:
        return (
            f"{label} is not release-ready while {breakdown.high} high-risk finding(s) remain open. "
            "Treat these as blocking issues before production deployment."
        )
    if breakdown.medium:
        return (
            f"{label} can move toward release after targeted review of {breakdown.medium} medium-risk finding(s). "
            "The current risk is manageable only with documented remediation ownership."
        )
    if breakdown.low:
        return (
            f"{label} has no high or medium-risk findings in the latest analysis. "
            f"The remaining {breakdown.low} low-risk item(s) can be handled as release polish."
        )
    return f"{label} has no detected security findings in the latest manager-run analysis."


def _recommended_actions(breakdown: SecurityRiskBreakdown, common: list[CommonSecurityIssue]) -> list[str]:
    actions: list[str] = []
    if breakdown.high:
        actions.append(f"Block production release until {breakdown.high} high-risk finding(s) are remediated or explicitly accepted.")
    if breakdown.medium:
        actions.append(f"Assign owners for {breakdown.medium} medium-risk finding(s) and verify fixes before the next release candidate.")
    if common:
        actions.append(f"Run a focused review for {common[0].title.lower()} because it is the dominant security pattern in this view.")
    if not actions:
        actions.append("Keep the repository on regular security analysis cadence and monitor for newly introduced findings.")
    return actions


def _contributor_impacts(
    db: Session,
    run_id: int,
    findings: list[SecurityFinding],
    previous_findings: list[SecurityFinding],
    cumulative_deltas: dict[int, dict[str, int]] | None = None,
) -> list[ContributorSecurityImpact]:
    summary_rows = (
        db.query(ContributorAnalysisSummary, User)
        .join(User, ContributorAnalysisSummary.user_id == User.id)
        .filter(
            ContributorAnalysisSummary.analysis_run_id == run_id,
            User.role == UserRole.developer,
        )
        .all()
    )
    score_rows = (
        db.query(SkillScore.user_id, SkillScore.security_awareness_score)
        .filter(SkillScore.analysis_run_id == run_id)
        .all()
    )
    score_by_user = {
        user_id: security_awareness_score
        for user_id, security_awareness_score in score_rows
        if user_id is not None
    }
    if summary_rows:
        rows = [
            (summary.security_score, user)
            for summary, user in summary_rows
        ]
    else:
        rows = (
            db.query(SkillScore.security_awareness_score, User)
            .join(User, SkillScore.user_id == User.id)
            .filter(SkillScore.analysis_run_id == run_id, User.role == UserRole.developer)
            .all()
        )
    findings_by_user: dict[int, list[SecurityFinding]] = defaultdict(list)
    for finding in findings:
        if finding.user_id is not None:
            findings_by_user[finding.user_id].append(finding)

    deltas = cumulative_deltas if cumulative_deltas is not None else _user_issue_delta(findings, previous_findings)
    result: list[ContributorSecurityImpact] = []
    for score_value_raw, user in rows:
        breakdown = _risk_breakdown(_dedupe_findings(findings_by_user.get(user.id, [])))
        delta = deltas.get(user.id, {})
        issue_count = breakdown.total
        score_value = _round_score(
            score_value_raw
            if score_value_raw is not None
            else score_by_user.get(user.id, 0.0)
        )
        introduced = int(delta.get("introduced", 0))
        fixed = int(delta.get("fixed", 0))
        if breakdown.high or introduced > fixed:
            net_impact = "Risky"
        elif fixed > introduced or issue_count == 0 or score_value >= 85:
            net_impact = "Positive"
        else:
            net_impact = "Neutral"
        result.append(
            ContributorSecurityImpact(
                id=user.id,
                full_name=user.full_name,
                username=user.username,
                avatar_url=user.avatar_url,
                specialization=user.specialization.value if user.specialization else None,
                security_score=score_value,
                issue_count=issue_count,
                issues_fixed=fixed,
                issues_introduced=introduced,
                high=breakdown.high,
                medium=breakdown.medium,
                low=breakdown.low,
                net_impact=net_impact,
            )
        )
    return sorted(
        result,
        key=lambda item: (item.high, item.issues_introduced, item.issue_count),
        reverse=True,
    )


@router.get("/repos", response_model=list[ManagerSecurityRepo])
def get_manager_security_repos(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    latest_runs = _latest_repository_runs_by_repo(db, current_user.id)
    scores = _repository_security_scores_for_runs(db, [run.id for run in latest_runs], current_user.id)
    result: list[ManagerSecurityRepo] = []
    for run in sorted(latest_runs, key=_run_time, reverse=True):
        findings = _dedupe_findings(_findings_for_runs(db, [run.id]))
        result.append(
            ManagerSecurityRepo(
                id=run.repository.id,
                name=run.repository.name,
                full_name=run.repository.full_name,
                is_private=bool(run.repository.is_private),
                last_analyzed_at=run.completed_at,
                security_score=scores.get(run.id, 0.0),
                total_issues=len(findings),
            )
        )
    return result


@router.get("/team", response_model=TeamSecurityOverview)
def get_team_security_overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    latest_repository_runs = _latest_repository_runs_by_repo(db, current_user.id)
    latest_team_runs = _latest_manager_runs_by_repo(db, current_user.id)
    repository_run_ids = [run.id for run in latest_repository_runs]
    team_run_ids = [run.id for run in latest_team_runs]
    run_repo_ids = {run.id: run.repository_id for run in latest_repository_runs}
    findings = _dedupe_findings(_findings_for_runs(db, repository_run_ids))
    breakdown = _risk_breakdown(findings)
    common = _common_issues(findings, run_repo_ids)
    members = _member_scores(db, team_run_ids)

    return TeamSecurityOverview(
        overall_score=_average_repository_security_score(db, latest_repository_runs, current_user.id),
        repository_count=len(latest_repository_runs),
        total_issues=breakdown.total,
        team_members=len(members),
        risk_breakdown=breakdown,
        trend=_trend(db, current_user.id),
        common_issues=common,
        systemic_risk_analysis=_systemic_analysis(common, len(latest_repository_runs)),
        why_this_matters=_why_this_matters(),
        members=members,
    )


@router.get("/repository-risk", response_model=RepositoryRiskResponse)
def get_repository_risk(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    latest_repository_runs = _latest_repository_runs_by_repo(db, current_user.id)
    if not latest_repository_runs:
        return RepositoryRiskResponse()

    run_by_id = {run.id: run for run in latest_repository_runs}
    scores = _repository_security_scores_for_runs(db, list(run_by_id), current_user.id)
    findings_by_repo: dict[int, list[SecurityFinding]] = defaultdict(list)
    for finding in _findings_for_runs(db, list(run_by_id)):
        run = run_by_id.get(finding.analysis_run_id)
        if run is not None:
            findings_by_repo[run.repository_id].append(finding)

    repositories: list[RepositoryRiskItem] = []
    run_times_by_repo: dict[int, datetime] = {}
    for run in latest_repository_runs:
        repo_findings = findings_by_repo.get(run.repository_id, [])
        if not repo_findings:
            continue

        counts = Counter(normalize_severity(finding.severity) for finding in repo_findings)
        high = counts.get("HIGH", 0)
        medium = counts.get("MEDIUM", 0)
        low = counts.get("LOW", 0)
        risk_weight = high * 5 + medium * 3 + low
        run_times_by_repo[run.repository_id] = _run_time(run)
        repositories.append(
            RepositoryRiskItem(
                repository_id=run.repository_id,
                repository_name=run.repository.name or run.repository.full_name or "Repository",
                high=high,
                medium=medium,
                low=low,
                total_issues=high + medium + low,
                risk_weight=risk_weight,
                security_score=scores.get(run.id),
            )
        )

    if not repositories:
        return RepositoryRiskResponse()

    top_repositories = sorted(repositories, key=lambda item: item.risk_weight, reverse=True)[:6]
    latest_used_at = max(run_times_by_repo[item.repository_id] for item in top_repositories)
    return RepositoryRiskResponse(
        period=latest_used_at.strftime("%Y-%m"),
        label=latest_used_at.strftime("%b %Y"),
        repositories=top_repositories,
    )


@router.get("/repositories/{repo_id}", response_model=RepositorySecurityDetail)
def get_repository_security_detail(
    repo_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["manager"])),
):
    run = _latest_repository_run_for_repo(db, current_user.id, repo_id)
    if not run:
        raise HTTPException(status_code=404, detail="Repository security analysis not found")

    findings = _dedupe_findings(_findings_for_runs(db, [run.id]))
    breakdown = _risk_breakdown(findings)
    score = _repository_security_score_for_run(db, run, current_user.id)
    team_run = _latest_manager_run_for_repo(db, current_user.id, repo_id)
    team_findings = _dedupe_findings(_findings_for_runs(db, [team_run.id])) if team_run else []
    previous_team_run = (
        _previous_manager_run_for_repo(db, current_user.id, repo_id, team_run.id)
        if team_run
        else None
    )
    previous_team_findings = _dedupe_findings(_findings_for_runs(db, [previous_team_run.id])) if previous_team_run else []
    team_run_timeline = (
        _manager_runs_for_repo_until(db, current_user.id, repo_id, team_run)
        if team_run
        else []
    )
    cumulative_team_deltas = _cumulative_user_issue_delta(db, team_run_timeline)
    team_contributors = _contributors_for_team_run(db, team_run.id) if team_run else []
    users_by_id = _users_by_id_for_findings(
        db,
        [*findings, *team_findings],
        fallback_run_id=team_run.id if team_run else run.id,
    )
    users_by_id.update({contributor.id: contributor for contributor in team_contributors})
    vulnerabilities = sorted(
        [_vulnerability_item(finding, users_by_id, include_contributor=False) for finding in findings],
        key=lambda item: SEVERITY_ORDER.get(item.severity.upper(), 0),
        reverse=True,
    )
    grouped_by_contributor = (
        _issues_grouped_by_contributor(team_findings, users_by_id, team_contributors)
        if team_run
        else []
    )

    common = _common_issues(findings, {run.id: run.repository_id})

    return RepositorySecurityDetail(
        repository=RepositorySecuritySummary(
            id=run.repository.id,
            name=run.repository.name,
            full_name=run.repository.full_name,
            security_score=score,
            total_issues=breakdown.total,
            high=breakdown.high,
            medium=breakdown.medium,
            low=breakdown.low,
        ),
        release_readiness=_release_readiness(run.repository.name, breakdown),
        detected_vulnerabilities=vulnerabilities,
        recommended_actions=_recommended_actions(breakdown, common),
        contributor_impacts=(
            _contributor_impacts(db, team_run.id, team_findings, previous_team_findings, cumulative_team_deltas)
            if team_run
            else []
        ),
        issues_by_contributor=grouped_by_contributor,
    )
