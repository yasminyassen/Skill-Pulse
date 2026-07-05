from __future__ import annotations

from collections import defaultdict
from typing import Callable, Iterable, TypeVar

from sqlalchemy.orm import Session

from app.db.models import AnalysisRun, SecurityFinding, SonarIssue

T = TypeVar("T")


def previous_completed_run_for_user_repo(db: Session, run: AnalysisRun) -> AnalysisRun | None:
    if not run.completed_at:
        return None
    return (
        db.query(AnalysisRun)
        .filter(
            AnalysisRun.user_id == run.user_id,
            AnalysisRun.repository_id == run.repository_id,
            AnalysisRun.id != run.id,
            AnalysisRun.status == "completed",
            AnalysisRun.completed_at.isnot(None),
            AnalysisRun.completed_at < run.completed_at,
        )
        .order_by(AnalysisRun.completed_at.desc(), AnalysisRun.id.desc())
        .first()
    )


def compare_fingerprints(
    current_items: Iterable[T],
    previous_items: Iterable[T],
    fingerprint: Callable[[T], tuple],
) -> dict[str, int]:
    current = {fingerprint(item) for item in current_items}
    previous = {fingerprint(item) for item in previous_items}
    return {
        "fixed": len(previous - current),
        "introduced": len(current - previous),
        "remaining": len(current),
    }


def security_finding_fingerprint(finding: SecurityFinding) -> tuple:
    return (
        (finding.file_path or "").replace("\\", "/").strip().lower(),
        finding.line_number or 0,
        (finding.rule or "").strip().lower(),
        (finding.cwe or "").strip().upper(),
        (finding.owasp_category or "").strip().lower(),
    )


def sonar_issue_fingerprint(issue: SonarIssue) -> tuple:
    return (
        (issue.file_path or "").replace("\\", "/").strip().lower(),
        issue.line or 0,
        (issue.type or "").strip().upper(),
        (issue.rule or "").strip().lower(),
        (issue.message or "").strip().lower(),
    )


def user_issue_delta(
    current_findings: list[SecurityFinding],
    previous_findings: list[SecurityFinding],
    dedupe_findings: Callable[[list[SecurityFinding]], list[SecurityFinding]] | None = None,
) -> dict[int, dict[str, int]]:
    if not previous_findings:
        return {}

    normalize = dedupe_findings or (lambda items: items)
    current_by_user: dict[int, set[tuple]] = defaultdict(set)
    previous_by_user: dict[int, set[tuple]] = defaultdict(set)

    for finding in normalize(current_findings):
        if finding.user_id is not None:
            current_by_user[finding.user_id].add(security_finding_fingerprint(finding))

    for finding in normalize(previous_findings):
        if finding.user_id is not None:
            previous_by_user[finding.user_id].add(security_finding_fingerprint(finding))

    result: dict[int, dict[str, int]] = {}
    for user_id in set(current_by_user) | set(previous_by_user):
        current = current_by_user.get(user_id, set())
        previous = previous_by_user.get(user_id, set())
        result[user_id] = {
            "introduced": len(current - previous),
            "fixed": len(previous - current),
        }
    return result
