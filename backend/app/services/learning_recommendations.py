from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.db.models import AnalysisRun, CodeMetrics, SecurityFinding, SkillScore
from app.services.code_analysis_service import safe_float, safe_int
from app.services.llm_client import rank_learning_resources, LLMError
from ai_services.learning.resource_store import retrieve_resources

logger = logging.getLogger(__name__)

PRIORITY_THRESHOLDS = {
    "high": 82,
    "medium": 88,
}

ISSUE_TO_DOMAINS = {
    "long functions": ["refactoring", "clean code"],
    "high complexity": ["refactoring", "complexity management"],
    "duplicate logic": ["refactoring", "code quality"],
    "deep nesting": ["readability", "maintainability"],
    "too many parameters": ["api design", "maintainability"],
    "missing docstrings": ["documentation", "readability"],
    "low test coverage": ["testing", "tdd"],
    "high coupling": ["architecture", "modularity"],
    "weak authentication": ["authentication security"],
    "broken access control": ["access control security"],
    "injection": ["secure coding", "input validation"],
    "security vulnerabilities": ["secure coding"],
}

DIFFICULTY_LEVELS = {
    "Beginner": 0,
    "Intermediate": 1,
    "Advanced": 2,
}


def _priority_for_score(score: float) -> str:
    if score < PRIORITY_THRESHOLDS["high"]:
        return "High"
    if score < PRIORITY_THRESHOLDS["medium"]:
        return "Medium"
    return "Low"


def _difficulty_for_gap(gap: float) -> str:
    if gap >= 20:
        return "Advanced"
    if gap >= 10:
        return "Intermediate"
    return "Beginner"


def _difficulty_match(target: str, resource_level: str) -> float:
    t = DIFFICULTY_LEVELS.get(target, 1)
    r = DIFFICULTY_LEVELS.get(resource_level, 1)
    diff = abs(t - r)
    if diff == 0:
        return 1.0
    if diff == 1:
        return 0.6
    return 0.2


def _aggregate_metrics(rows: list[CodeMetrics]) -> dict:
    total_files = len(rows)
    totals = {
        "total_loc": 0,
        "style_violations": 0,
        "missing_docstrings": 0,
        "long_functions": 0,
        "deep_nesting": 0,
        "too_many_params": 0,
        "unused_variables": 0,
        "import_coupling_total": 0,
        "test_files": 0,
    }
    cyclomatic_values: list[float] = []
    duplication_values: list[float] = []
    docstring_values: list[float] = []
    test_ratio_values: list[float] = []
    nesting_values: list[float] = []
    function_size_values: list[float] = []
    comment_ratio_values: list[float] = []

    for row in rows:
        raw = row.raw_metrics if isinstance(row.raw_metrics, dict) else {}
        totals["total_loc"] += safe_int(row.lines_of_code, 0)

        cyclomatic_values.append(safe_float(row.cyclomatic_complexity, safe_float(raw.get("cyclomatic_complexity"), 0.0)))
        duplication_values.append(safe_float(row.duplication_score, safe_float(raw.get("duplication_score"), 0.0)))

        if raw.get("docstring_coverage") is not None:
            docstring_values.append(safe_float(raw.get("docstring_coverage"), 0.0))
        if raw.get("test_function_ratio") is not None:
            test_ratio_values.append(safe_float(raw.get("test_function_ratio"), 0.0))
        if raw.get("avg_nesting_depth") is not None:
            nesting_values.append(safe_float(raw.get("avg_nesting_depth"), 0.0))
        if raw.get("avg_function_size") is not None:
            function_size_values.append(safe_float(raw.get("avg_function_size"), 0.0))
        if raw.get("comment_ratio") is not None:
            comment_ratio_values.append(safe_float(raw.get("comment_ratio"), 0.0))

        totals["style_violations"] += safe_int(raw.get("style_violations"), 0)
        totals["missing_docstrings"] += safe_int(raw.get("missing_docstrings"), 0)
        totals["long_functions"] += safe_int(raw.get("long_functions"), 0)
        totals["deep_nesting"] += safe_int(raw.get("deep_nesting"), 0)
        totals["too_many_params"] += safe_int(raw.get("too_many_params"), 0)
        totals["unused_variables"] += safe_int(raw.get("unused_variables"), 0)
        totals["import_coupling_total"] += safe_int(raw.get("import_coupling"), 0)

        if bool(raw.get("is_test_file")):
            totals["test_files"] += 1

    def _avg(values: list[float]) -> float:
        return round(sum(values) / len(values), 4) if values else 0.0

    totals.update({
        "total_files": total_files,
        "avg_cyclomatic_complexity": _avg(cyclomatic_values),
        "avg_duplication_score": _avg(duplication_values),
        "avg_docstring_coverage": _avg(docstring_values),
        "avg_test_function_ratio": _avg(test_ratio_values),
        "avg_nesting_depth": _avg(nesting_values),
        "avg_function_size": _avg(function_size_values),
        "avg_comment_ratio": _avg(comment_ratio_values),
    })
    return totals


def _extract_issues(metrics: dict, findings: list[SecurityFinding]) -> list[str]:
    issues: list[str] = []

    if metrics.get("long_functions", 0) > 0:
        issues.append("long functions")
    if metrics.get("avg_cyclomatic_complexity", 0.0) >= 10:
        issues.append("high complexity")
    if metrics.get("avg_duplication_score", 0.0) >= 0.12:
        issues.append("duplicate logic")
    if metrics.get("avg_nesting_depth", 0.0) >= 4.0 or metrics.get("deep_nesting", 0) > 0:
        issues.append("deep nesting")
    if metrics.get("too_many_params", 0) > 0:
        issues.append("too many parameters")
    if metrics.get("missing_docstrings", 0) > 0 or metrics.get("avg_docstring_coverage", 1.0) < 0.6:
        issues.append("missing docstrings")

    total_files = max(1, metrics.get("total_files", 0))
    coupling_per_file = metrics.get("import_coupling_total", 0) / total_files
    if coupling_per_file >= 8:
        issues.append("high coupling")

    if metrics.get("test_files", 0) == 0 or metrics.get("avg_test_function_ratio", 0.0) < 0.1:
        issues.append("low test coverage")

    if findings:
        issues.append("security vulnerabilities")
        for finding in findings:
            category = (finding.owasp_category or "").lower()
            if "authentication" in category:
                issues.append("weak authentication")
            if "access control" in category:
                issues.append("broken access control")
            if "injection" in category:
                issues.append("injection")

    return list(dict.fromkeys(issues))


def _map_domains(issues: list[str]) -> list[str]:
    domains: list[str] = []
    for issue in issues:
        for domain in ISSUE_TO_DOMAINS.get(issue, []):
            domains.append(domain)
    return list(dict.fromkeys(domains))


def _build_query(issues: list[str], domains: list[str]) -> str:
    parts = issues + domains
    return " ".join(dict.fromkeys([p for p in parts if p]))


def _score_resource(hit: dict, target_difficulty: str) -> dict:
    resource = hit.get("resource") or {}
    similarity = max(0.0, min(1.0, float(hit.get("score", 0.0))))
    rating = safe_float(resource.get("rating"), 0.0)
    popularity = max(0.0, min(1.0, rating / 5.0))
    difficulty_match = _difficulty_match(target_difficulty, resource.get("difficulty", "Intermediate"))

    final_score = (0.5 * similarity) + (0.3 * popularity) + (0.2 * difficulty_match)
    return {
        "resource": resource,
        "similarity": round(similarity, 4),
        "popularity": round(popularity, 4),
        "difficulty_match": round(difficulty_match, 4),
        "final_score": round(final_score, 4),
    }


def _estimate_gain(gap: float) -> int:
    if gap >= 20:
        return 10
    if gap >= 10:
        return 6
    return 3


def build_learning_recommendations(
    run: AnalysisRun,
    score_row: SkillScore,
    metric_rows: list[CodeMetrics],
    findings: list[SecurityFinding],
) -> dict:
    metrics = _aggregate_metrics(metric_rows)
    issues = _extract_issues(metrics, findings)
    domains = _map_domains(issues)
    query = _build_query(issues, domains)

    scores = {
        "code_quality": safe_float(score_row.code_quality_score, 0.0),
        "maintainability": safe_float(score_row.maintainability_score, 0.0),
        "architecture": safe_float(score_row.architecture_score, 0.0),
        "problem_solving": safe_float(score_row.problem_solving_score, 0.0),
        "security_score": safe_float(score_row.security_awareness_score, 0.0),
        "overall": safe_float(score_row.overall_score, 0.0),
    }

    skill_gaps = []
    for label, score in (
        ("Code Quality", scores["code_quality"]),
        ("Maintainability", scores["maintainability"]),
        ("Architecture", scores["architecture"]),
        ("Problem Solving", scores["problem_solving"]),
        ("Security", scores["security_score"]),
    ):
        gap = max(0.0, 100.0 - score)
        skill_gaps.append({
            "domain": label,
            "score": round(score, 2),
            "gap": round(gap, 2),
            "priority": _priority_for_score(score),
            "target_difficulty": _difficulty_for_gap(gap),
            "estimated_gain": _estimate_gain(gap),
        })

    target_gap = max((g["gap"] for g in skill_gaps), default=0.0)
    target_difficulty = _difficulty_for_gap(target_gap)

    hits: list[dict] = []
    if query:
        try:
            hits = retrieve_resources(query, top_k=10)
        except FileNotFoundError as exc:
            logger.warning("Learning resource index missing: %s", exc)
    scored = [_score_resource(hit, target_difficulty) for hit in hits]
    scored.sort(key=lambda x: x["final_score"], reverse=True)

    deduped = []
    seen = set()
    for entry in scored:
        resource = entry["resource"]
        rid = resource.get("id")
        if not rid or rid in seen:
            continue
        seen.add(rid)
        deduped.append(entry)

    fallback_ranked = [
        {
            "id": r["resource"].get("id"),
            "explanation": "Ranked by semantic relevance, quality, and fit.",
            "expected_gain": _estimate_gain(target_gap),
        }
        for r in deduped
    ]

    ranked_output = None
    try:
        ranked_output = rank_learning_resources({
            "analysis": {
                "scores": scores,
                "issues": issues,
                "skill_gaps": skill_gaps,
            },
            "resources": [
                {
                    "id": e["resource"].get("id"),
                    "title": e["resource"].get("title"),
                    "type": e["resource"].get("type"),
                    "difficulty": e["resource"].get("difficulty"),
                    "topics": e["resource"].get("topics"),
                    "tags": e["resource"].get("tags"),
                    "score": e["final_score"],
                }
                for e in deduped
            ],
        })
    except LLMError as exc:
        logger.warning("Learning LLM ranking failed: %s", exc)

    ranked_list = ranked_output.get("ranked") if isinstance(ranked_output, dict) else None
    if not isinstance(ranked_list, list):
        ranked_list = fallback_ranked

    ranked_index = {item.get("id"): item for item in ranked_list if isinstance(item, dict)}
    deduped_index = {entry["resource"].get("id"): entry for entry in deduped}

    recommendations = []
    for ranked in ranked_list:
        rid = ranked.get("id") if isinstance(ranked, dict) else None
        entry = deduped_index.get(rid)
        if not entry:
            continue
        resource = entry["resource"]
        recommendations.append({
            "id": rid,
            "title": resource.get("title"),
            "provider": resource.get("provider"),
            "type": resource.get("type"),
            "difficulty": resource.get("difficulty"),
            "topics": resource.get("topics"),
            "duration": resource.get("duration"),
            "rating": resource.get("rating"),
            "url": resource.get("url"),
            "tags": resource.get("tags"),
            "relevance": entry["similarity"],
            "final_score": entry["final_score"],
            "expected_gain": ranked.get("expected_gain", _estimate_gain(target_gap)),
            "explanation": ranked.get("explanation", ""),
        })

    if not recommendations:
        for entry in deduped:
            resource = entry["resource"]
            recommendations.append({
                "id": resource.get("id"),
                "title": resource.get("title"),
                "provider": resource.get("provider"),
                "type": resource.get("type"),
                "difficulty": resource.get("difficulty"),
                "topics": resource.get("topics"),
                "duration": resource.get("duration"),
                "rating": resource.get("rating"),
                "url": resource.get("url"),
                "tags": resource.get("tags"),
                "relevance": entry["similarity"],
                "final_score": entry["final_score"],
                "expected_gain": _estimate_gain(target_gap),
                "explanation": "Ranked by semantic relevance, quality, and fit.",
            })

    security_focus = scores["security_score"] < PRIORITY_THRESHOLDS["high"]
    security_resources = []
    if security_focus:
        try:
            security_hits = retrieve_resources(
                "owasp secure coding authentication injection access control",
                top_k=6,
            )
        except FileNotFoundError:
            security_hits = []
        for hit in security_hits:
            resource = hit.get("resource") or {}
            rid = resource.get("id")
            if not rid or rid in seen:
                continue
            security_resources.append({
                "id": rid,
                "title": resource.get("title"),
                "provider": resource.get("provider"),
                "type": resource.get("type"),
                "difficulty": resource.get("difficulty"),
                "topics": resource.get("topics"),
                "duration": resource.get("duration"),
                "rating": resource.get("rating"),
                "url": resource.get("url"),
                "tags": resource.get("tags"),
                "relevance": round(max(0.0, min(1.0, float(hit.get("score", 0.0)))), 4),
            })

    return {
        "analysis_run_id": run.id,
        "repo": run.repository.full_name if run.repository else None,
        "branch": run.branch,
        "scores": scores,
        "issues": issues,
        "skill_gaps": skill_gaps,
        "query": query,
        "recommendations": recommendations,
        "security_focus": {
            "enabled": security_focus,
            "threshold": PRIORITY_THRESHOLDS["high"],
            "resources": security_resources,
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
