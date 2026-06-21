from __future__ import annotations

import asyncio
import os
import subprocess
import tempfile
import uuid
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm.attributes import flag_modified
from app.db.database import SessionLocal
from app.db.models import AnalysisRun, Repository, RepositoryAnalysis, SecurityFinding, CodeMetrics, SkillScore, User, UserRole
from app.services.security.pipeline import run_security_analysis
from app.services.github_client import (
    read_local_repo_files,
    refresh_github_access_token_for_user,
    fetch_authenticated_github_user,
)
from app.services.code_intelligence import analyze_python_files
from app.services.llm_client import (
    analyze_problem_solving,
    analyze_skill_scores,
    analyze_architecture_metrics,
    LLMError,
)
from app.services.architecture_scoring import (
    compute_static_architecture_metrics,
    aggregate_architecture_score,
)
from app.services.metrics import build_unified_schema
from app.services.learning_recommendations import build_learning_recommendations
from app.api.manager_dashboard import (
    _analysis_run_ids,
    _build_team_aggregate_metrics,
    _build_team_score_payload,
    _generate_and_store_member_detail_insights_from_rows,
    _manager_team_insight_payload,
    _normalise_team_insights,
    _query_manager_score_rows,
)
from ai_services.insights.ai_insights import generate_insights
from ai_services.rag.rag_seeder import STANDARDS_DOC_ID
from app.core.auth_utils import decrypt_github_token
from app.services.security_service import compute_security_score_breakdown, group_findings_by_severity_and_file
from app.services.code_analysis_service import apply_adjustment, compute_overall_score


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def _build_manager_dashboard_payload(rows: list, db: Session) -> dict:
    scores = _build_team_score_payload(rows)
    aggregate_metrics = _build_team_aggregate_metrics(db, _analysis_run_ids(rows))
    return {
        "scores": scores,
        "aggregate_metrics": {
            **aggregate_metrics,
            "team_size": len({user.id for _, _, _, user in rows}),
            "repository_count": len({run.repository_id for _, run, _, _ in rows}),
        },
    }


def _merge_preserved_member_details(existing: object, new_insights: dict) -> dict:
    result = dict(new_insights)
    if isinstance(existing, dict) and isinstance(existing.get("member_detail_insights"), dict):
        result["member_detail_insights"] = existing["member_detail_insights"]
    return result


def _model_to_dict(model: BaseModel) -> dict:
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


def _pure_manager_insights(
    raw_insights: object,
    scores: dict[str, float],
    metrics: dict,
) -> dict | None:
    if not isinstance(raw_insights, dict):
        return None
    if (
        "actionable_recommendations" not in raw_insights
    ):
        return None

    return _manager_team_insight_payload(
        _normalise_team_insights(raw_insights, scores, metrics)
    )


async def _generate_manager_dashboard_insights_from_rows(
    rows: list,
    db: Session,
    manager_user_id: int,
    scope: str,
) -> dict | None:
    if not rows:
        logger.info(
            "Skipped manager dashboard insight generation manager_user_id=%s scope=%s reason=no_rows",
            manager_user_id,
            scope,
        )
        return None

    analysis_payload = _build_manager_dashboard_payload(rows, db)
    raw_insights = await generate_insights(
        role="manager",
        analysis_result=analysis_payload,
        security_report={},
        doc_id=STANDARDS_DOC_ID,
    )
    pure_insights = _pure_manager_insights(
        raw_insights,
        analysis_payload["scores"],
        analysis_payload["aggregate_metrics"],
    )
    if pure_insights is None:
        logger.warning(
            "Manager dashboard LLM returned no cacheable team insights manager_user_id=%s scope=%s",
            manager_user_id,
            scope,
        )
    return pure_insights


class FindingModel(BaseModel):
    tool: str
    rule: str
    file_path: str
    severity: str
    description: str
    line_number: int
    cwe: str
    owasp_category: str


def _prepare_repo_checkout(
    repo_url: str,
    branch: str,
    token: str,
    is_private: bool,
    repo_name: str,
    full_name: str,
) -> tuple[str, tempfile.TemporaryDirectory | None]:
    cache_root = os.environ.get("ANALYSIS_CACHE_DIR")
    auth_repo_url = repo_url
    if is_private and token:
        auth_repo_url = repo_url.replace("https://", f"https://x-access-token:{token}@")

    if cache_root:
        os.makedirs(cache_root, exist_ok=True)
        safe_name = full_name.replace("/", "__")
        clone_path = os.path.join(cache_root, safe_name)

        if os.path.isdir(os.path.join(clone_path, ".git")):
            subprocess.run(["git", "remote", "set-url", "origin", auth_repo_url], cwd=clone_path, check=True, timeout=300)
            subprocess.run(["git", "fetch", "--prune", "origin"], cwd=clone_path, check=True, timeout=300)
            subprocess.run(["git", "checkout", branch], cwd=clone_path, check=True, timeout=300)
            subprocess.run(["git", "reset", "--hard", f"origin/{branch}"], cwd=clone_path, check=True, timeout=300)
        else:
            clone_cmd = [
                "git", "clone", "--depth", "1", "--no-tags", "--filter=blob:none",
                "--branch", branch, "--single-branch", auth_repo_url, clone_path,
            ]
            subprocess.run(clone_cmd, check=True, timeout=300)

        return clone_path, None

    temp_dir = tempfile.TemporaryDirectory(prefix="repo_")
    clone_path = os.path.join(temp_dir.name, f"{repo_name}_{uuid.uuid4().hex}")
    clone_cmd = [
        "git", "clone", "--depth", "1", "--no-tags", "--filter=blob:none",
        "--branch", branch, "--single-branch", auth_repo_url, clone_path,
    ]
    subprocess.run(clone_cmd, check=True, timeout=300)
    return clone_path, temp_dir


async def resolve_github_identity(db: Session, user: User) -> tuple[str | None, str | None]:
    if not user.github_access_token:
        return None, None

    token = decrypt_github_token(user.github_access_token)
    if (
        user.github_token_expires_at
        and user.github_token_expires_at <= datetime.now(timezone.utc)
    ):
        refreshed_token = await refresh_github_access_token_for_user(db, user)
        if refreshed_token:
            token = refreshed_token

    github_user = await fetch_authenticated_github_user(token)
    github_login = github_user.get("login") if github_user else None
    return token, github_login


async def build_personal_repo_context(
    db: Session,
    user: User,
    repo,
    branch: str,
) -> dict:
    github_login = None
    if user.github_access_token:
        try:
            _, github_login = await resolve_github_identity(db, user)
        except Exception as exc:
            logging.warning(
                "Failed to resolve GitHub identity for user %s: %s",
                user.id,
                exc,
            )
    return {
        "has_github_identity": bool(github_login),
        "github_login": github_login,
        "is_private": bool(repo.is_private),
        "user_contributed": True,
        "commit_count_sample": 0,
        "latest_commit_at": None,
    }


def background_analysis_task(*args, **kwargs):
    return asyncio.run(_background_analysis_task_async(*args, **kwargs))


async def _background_analysis_task_async(
    run_id: int,
    repo_id: int,
    repo_url: str,
    repo_name: str,
    branch: str,
    full_name: str,
    token: str,
    is_private: bool,
    current_user_id: int,
    user_role: str,
    analysis_scope: str = "repository",
    contributor_login: str | None = None,
    touched_files: list[str] | None = None,
    manager_contributors: list[dict] | None = None,
    finalize_run: bool = True,
    generate_ai_insights: bool | None = None,
):
    is_recruiter_scoring_mode = user_role == "recruiter"
    if user_role == "manager":
        return await _background_manager_team_analysis_task_async(
            run_id=run_id,
            repo_id=repo_id,
            repo_url=repo_url,
            repo_name=repo_name,
            branch=branch,
            full_name=full_name,
            token=token,
            is_private=is_private,
            manager_user_id=current_user_id,
            manager_contributors=manager_contributors or [],
        )

    skip_insights = is_recruiter_scoring_mode or generate_ai_insights is False
    logger.info(
        "[run=%s] Background analysis started repo=%s full_name=%s role=%s scope=%s mode=%s",
        run_id,
        repo_name,
        full_name,
        user_role,
        analysis_scope,
        "recruiter_scoring" if is_recruiter_scoring_mode else "developer_full",
    )
    db = SessionLocal()
    try:
        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if not run:
            logger.warning("[run=%s] Background analysis aborted: run not found", run_id)
            return

        clone_path = ""
        repo_context: tempfile.TemporaryDirectory | None = None
        architecture_metrics_result: dict = {}
        try:
            logger.info("[run=%s] Git checkout started branch=%s private=%s", run_id, branch, is_private)
            clone_path, repo_context = _prepare_repo_checkout(
                repo_url=repo_url,
                branch=branch,
                token=token,
                is_private=is_private,
                repo_name=repo_name,
                full_name=full_name,
            )
            logger.info("[run=%s] Git checkout finished", run_id)

            python_files = read_local_repo_files(clone_path)
            touched_set = {p.replace("\\", "/") for p in (touched_files or [])}
            if analysis_scope == "contribution":
                python_files = [
                    f for f in python_files
                    if f.get("path", "").replace("\\", "/") in touched_set
                ]
                if not python_files:
                    raise Exception("No Python files were found in your contributions for this repository.")

            total_source_chars = sum(len(file_obj.get("content", "") or "") for file_obj in python_files)
            llm_payload_chars = sum(
                len("\n".join((file_obj.get("content", "") or "").splitlines()[:300]))
                for file_obj in python_files
            )
            logger.info(
                "[run=%s] Files selected for analysis count=%d source_chars=%d llm_input_chars_approx=%d",
                run_id,
                len(python_files),
                total_source_chars,
                llm_payload_chars,
            )
            if not python_files:
                raise Exception("No Python files were found for analysis.")

            logger.info("[run=%s] Security analysis started", run_id)
            pipeline_result = run_security_analysis(clone_path)
            logger.info(
                "[run=%s] Security analysis finished findings=%d failed_tools=%s",
                run_id,
                len(pipeline_result.get("findings", [])),
                pipeline_result.get("failed_tools", []),
            )

            llm_problem_solving_score = 0.0
            llm_result = {}
            llm_skill_scores = {}
            llm_adjustment_guidance = {}
            try:
                logger.info(
                    "[run=%s] LLM problem solving started files=%d chars_approx=%d",
                    run_id,
                    len(python_files),
                    llm_payload_chars,
                )
                llm_result = analyze_problem_solving(python_files, run.commit_sha)
                logger.info("[run=%s] LLM problem solving finished", run_id)
                logger.debug("[run=%s] Raw LLM problem solving result: %s", run_id, llm_result)
                if llm_result.get("_llm_valid"):
                    component_scores = [
                        float((llm_result.get(key) or {}).get("score", 0.0) or 0.0)
                        for key in ("algorithms", "data_structures", "balanced_complexity", "edge_cases")
                    ]
                    logger.info("[run=%s] LLM problem solving component_scores=%s", run_id, component_scores)
                    if component_scores:
                        avg_score = sum(component_scores) / len(component_scores)
                        llm_problem_solving_score = avg_score / 100.0
                        logger.info(
                            "[run=%s] llm_problem_solving_score set to: %.3f",
                            run_id,
                            llm_problem_solving_score,
                        )
                else:
                    logger.warning(
                        "[run=%s] LLM problem solving returned no valid batch; using rule-based fallback",
                        run_id,
                    )
            except LLMError as exc:
                logger.exception("[run=%s] LLM problem solving failed: %s", run_id, exc)
            except Exception as exc:
                logger.exception("[run=%s] Unexpected error in LLM problem solving: %s", run_id, exc)

            logger.info("[run=%s] Static code analysis started", run_id)
            analysis_result = analyze_python_files(
                python_files,
                problem_solving_score=llm_problem_solving_score,
            )
            logger.info(
                "[run=%s] Scores after analyze_python_files: %s",
                run_id,
                analysis_result.get("scores", {}),
            )
            code_intelligence_result = analysis_result
            final_scores = analysis_result.get("scores", {})

            aggregate = code_intelligence_result.get("aggregate_metrics", {})
            file_reports = code_intelligence_result.get("files", [])
            architecture_metrics_result = {}

            try:
                logger.info("[run=%s] Architecture scoring started", run_id)
                static_arch = compute_static_architecture_metrics(
                    file_reports,
                    aggregate,
                    clone_path or None,
                    python_files,
                )
                static_evidence = {
                    "signals": static_arch.get("signals", {}),
                    "structural_indices": {
                        metric_key: (index_entry or {}).get("structural_index")
                        for metric_key, index_entry in (
                            static_arch.get("structural_indices") or {}
                        ).items()
                    },
                    "circular_imports": (static_arch.get("circular_imports_signal") or {}).get(
                        "details", {}
                    ),
                }
                llm_arch = {}
                try:
                    llm_arch = analyze_architecture_metrics(
                        python_files,
                        static_evidence,
                        run.commit_sha,
                    )
                except LLMError as exc:
                    logger.warning("[run=%s] Architecture LLM metrics failed: %s", run_id, exc)
                except Exception as exc:
                    logger.exception("[run=%s] Unexpected architecture LLM error: %s", run_id, exc)

                architecture_metrics_result = aggregate_architecture_score(static_arch, llm_arch)
                final_scores["architecture"] = architecture_metrics_result["overall"]
                final_scores["overall_score"] = compute_overall_score(final_scores)
                code_intelligence_result["architecture_metrics"] = architecture_metrics_result
                logger.info(
                    "[run=%s] Architecture scoring finished overall=%.2f",
                    run_id,
                    architecture_metrics_result["overall"],
                )
            except Exception as exc:
                logger.exception("[run=%s] Architecture scoring failed: %s", run_id, exc)

            base_scores = dict(final_scores)
            logger.info("[run=%s] Base scores before LLM calibration: %s", run_id, base_scores)
            base_overall = float(base_scores.get("overall_score") or compute_overall_score(base_scores))

            def _collect_adjustment_evidence(skill: str, metrics: dict) -> list[str]:
                entries: list[str] = []

                def _add(label: str, value, decimals: int | None = None) -> None:
                    if value is None:
                        return
                    if isinstance(value, float):
                        entries.append(f"{label}={value:.{decimals or 2}f}")
                    else:
                        entries.append(f"{label}={value}")

                if skill == "code_quality":
                    _add("avg_duplication_score", metrics.get("avg_duplication_score"))
                    _add("style_violations", metrics.get("style_violations"))
                    _add("unused_variables", metrics.get("unused_variables"))
                    _add("avg_cyclomatic_complexity", metrics.get("avg_cyclomatic_complexity"))
                    _add("avg_type_annotation_coverage", metrics.get("avg_type_annotation_coverage"))
                    _add("magic_numbers", metrics.get("magic_numbers"))
                    _add("dead_code_symbols", metrics.get("dead_code_symbols"))
                elif skill == "maintainability":
                    _add("avg_docstring_coverage", metrics.get("avg_docstring_coverage"))
                    _add("avg_comment_ratio", metrics.get("avg_comment_ratio"))
                    _add("long_functions", metrics.get("long_functions"))
                    _add("too_many_params", metrics.get("too_many_params"))
                    _add("avg_maintainability_index", metrics.get("avg_maintainability_index"))
                    _add("avg_official_maintainability_index", metrics.get("avg_official_maintainability_index"))
                    _add("avg_halstead_volume", metrics.get("avg_halstead_volume"))
                    _add("mutable_globals", metrics.get("mutable_globals"))
                    _add("broad_exceptions", metrics.get("broad_exceptions"))
                    _add("swallowed_exceptions", metrics.get("swallowed_exceptions"))
                elif skill == "architecture":
                    arch = code_intelligence_result.get("architecture_metrics", {})
                    for metric_key, metric_entry in (arch.get("metrics") or {}).items():
                        if isinstance(metric_entry, dict):
                            _add(metric_key, metric_entry.get("score"))

                return entries

            try:
                logger.info(
                    "[run=%s] LLM skill calibration started files=%d chars_approx=%d",
                    run_id,
                    len(python_files),
                    llm_payload_chars,
                )
                llm_skill_scores = analyze_skill_scores(
                    python_files,
                    base_scores=final_scores,
                    aggregate_metrics=code_intelligence_result.get("aggregate_metrics", {}),
                    commit_sha=run.commit_sha,
                )
                logger.info("[run=%s] LLM skill calibration finished", run_id)
                if not llm_skill_scores:
                    logger.warning("[run=%s] LLM skill calibration returned no scores", run_id)
                if llm_skill_scores:
                    for skill in ("code_quality", "maintainability"):
                        base = float(final_scores.get(skill, 0.0) or 0.0)
                        entry = llm_skill_scores.get(skill, {})
                        adjustment = float(entry.get("adjustment", 0.0) or 0.0)
                        confidence = float(entry.get("confidence", 0.0) or 0.0)

                        logger.info("[run=%s] LLM %s before base=%.2f", run_id, skill, base)
                        logger.info(
                            "[run=%s] LLM %s adjustment=%.2f confidence=%.2f",
                            run_id,
                            skill,
                            adjustment,
                            confidence,
                        )

                        if confidence < 0.4:
                            logger.info(
                                "[run=%s] LLM %s adjustment ignored due to low confidence %.2f",
                                run_id,
                                skill,
                                confidence,
                            )
                            adjustment = 0.0

                        adjustment = max(-20.0, min(20.0, adjustment))
                        new_score = apply_adjustment(base, adjustment, confidence)
                        logger.info("[run=%s] LLM %s after new_score=%.2f", run_id, skill, new_score)
                        final_scores[skill] = max(0.0, min(100.0, new_score))

                    final_scores["overall_score"] = compute_overall_score(final_scores)
                    logger.info("[run=%s] Final scores after LLM calibration: %s", run_id, final_scores)
            except LLMError as exc:
                logger.exception("[run=%s] LLM skill score calibration failed: %s", run_id, exc)
            except Exception as exc:
                logger.exception(
                    "[run=%s] Unexpected error during LLM skill score calibration: %s",
                    run_id,
                    exc,
                )

            final_overall = float(final_scores.get("overall_score") or compute_overall_score(final_scores))
            overall_delta = round(final_overall - base_overall, 2)

            if llm_skill_scores:
                metrics = code_intelligence_result.get("aggregate_metrics", {})
                for skill in ("code_quality", "maintainability"):
                    entry = llm_skill_scores.get(skill, {})
                    confidence = float(entry.get("confidence", 0.0) or 0.0)
                    reason = entry.get("reason", "")
                    requested_adjustment = float(entry.get("adjustment", 0.0) or 0.0)
                    base = float(base_scores.get(skill, 0.0) or 0.0)
                    final = float(final_scores.get(skill, 0.0) or 0.0)
                    applied_delta = round(final - base, 2)
                    overall_impact = round(applied_delta / 4.0, 2)
                    evidence = _collect_adjustment_evidence(skill, metrics)

                    llm_adjustment_guidance[skill] = {
                        "requested_adjustment": round(requested_adjustment, 2),
                        "applied_delta": applied_delta,
                        "confidence": round(max(0.0, min(1.0, confidence)), 3),
                        "reason": reason,
                        "evidence": evidence,
                        "overall_impact": overall_impact,
                        "overall_delta": overall_delta,
                        "ignored": confidence < 0.4,
                    }

            if architecture_metrics_result:
                arch_metrics = architecture_metrics_result.get("metrics", {})
                llm_reasons = [
                    f"{key}: {entry.get('reason')}"
                    for key, entry in arch_metrics.items()
                    if isinstance(entry, dict) and entry.get("reason") and entry.get("method") == "LLM"
                ]
                llm_adjustment_guidance["architecture"] = {
                    "requested_adjustment": 0.0,
                    "applied_delta": round(
                        float(final_scores.get("architecture", 0.0)) - float(base_scores.get("architecture", 0.0)),
                        2,
                    ),
                    "confidence": round(
                        sum(
                            float((arch_metrics.get(k) or {}).get("confidence", 0.0) or 0.0)
                            for k in ("layer_count_srp", "repository_pattern", "dependency_injection",
                                      "open_closed_readiness", "swappable_components", "god_class_function")
                        ) / 6.0,
                        3,
                    ),
                    "reason": " | ".join(llm_reasons[:3]) if llm_reasons else "Architecture scored via dedicated metric pipeline.",
                    "evidence": _collect_adjustment_evidence(
                        "architecture",
                        code_intelligence_result.get("aggregate_metrics", {}),
                    ),
                    "overall_impact": 0.0,
                    "overall_delta": overall_delta,
                    "ignored": False,
                }

            if (final_scores.get("problem_solving") or 0.0) <= 0.0:
                calibrated = float((llm_skill_scores.get("problem_solving") or {}).get("score", 0.0) or 0.0)
                if calibrated > 0.0:
                    final_scores["problem_solving"] = calibrated if calibrated > 1.0 else calibrated * 100.0
                    final_scores["overall_score"] = compute_overall_score(final_scores)

            code_intelligence_result.setdefault("llm", {})
            code_intelligence_result["llm"]["skill_scores"] = llm_skill_scores
            code_intelligence_result["llm"]["problem_solving"] = llm_result
            code_intelligence_result["debug"] = {
                "base_scores": base_scores,
                "llm_adjustments": llm_skill_scores,
                "final_scores": final_scores,
            }

            try:
                unified = build_unified_schema(code_intelligence_result, llm_result, run.commit_sha)
                code_intelligence_result.setdefault("unified_metrics", {})
                code_intelligence_result["unified_metrics"] = unified
            except Exception:
                logger.exception("[run=%s] Failed to build unified metrics schema", run_id)

            findings = pipeline_result.get("findings", [])
            failed_tools = pipeline_result.get("failed_tools", [])
        finally:
            if repo_context:
                repo_context.cleanup()

        ignored = ["venv", ".venv", "__pycache__", "migrations"]
        findings = [
            f for f in findings
            if not any(p in f.get("file_path", "") for p in ignored)
        ]
        if analysis_scope == "contribution":
            touched_set = {p.replace("\\", "/") for p in (touched_files or [])}
            findings = [
                f for f in findings
                if f.get("file_path", "").replace("\\", "/") in touched_set
            ]

        for finding in findings:
            try:
                validated = FindingModel(**finding)
            except Exception:
                continue

            db.add(SecurityFinding(
                analysis_run_id=run.id,
                user_id=current_user_id,
                tool=validated.tool,
                rule=validated.rule,
                cwe=validated.cwe,
                file_path=validated.file_path,
                severity=validated.severity,
                description=validated.description,
                line_number=validated.line_number,
                owasp_category=validated.owasp_category,
            ))

        for file_report in code_intelligence_result.get("files", []):
            metrics = file_report.get("metrics", {})
            maintainability_index = max(
                0.0,
                min(100.0, float(metrics.get("maintainability_index", 0.0) or 0.0)),
            )

            db.add(CodeMetrics(
                analysis_run_id=run.id,
                user_id=current_user_id,
                file_path=file_report.get("path"),
                cyclomatic_complexity=float(metrics.get("cyclomatic_complexity", 0.0) or 0.0),
                lines_of_code=int(metrics.get("loc", 0) or 0),
                duplication_score=float(metrics.get("duplication_score", 0.0) or 0.0),
                maintainability_index=maintainability_index,
                raw_metrics=metrics,
            ))

        total_loc = code_intelligence_result.get("aggregate_metrics", {}).get("total_loc")
        if total_loc is None:
            total_loc = code_intelligence_result.get("aggregate_metrics", {}).get("loc", 1000)
        security_score_breakdown = compute_security_score_breakdown(findings, int(total_loc or 0))
        security_score = security_score_breakdown["overall"]

        logger.info(
            "[run=%s] Final scores before DB save role=%s scope=%s scores=%s security_score=%.2f",
            run_id,
            user_role,
            analysis_scope,
            final_scores,
            security_score,
        )
        db.add(SkillScore(
            analysis_run_id=run.id,
            user_id=current_user_id,
            code_quality_score=final_scores.get("code_quality", 0.0),
            maintainability_score=final_scores.get("maintainability", 0.0),
            architecture_score=final_scores.get("architecture", 0.0),
            security_awareness_score=security_score,
            problem_solving_score=final_scores.get("problem_solving", 0.0),
            overall_score=final_scores.get("overall_score", 0.0),
        ))
        db.commit()
        logger.info("[run=%s] SkillScore DB save successful", run_id)

        if is_recruiter_scoring_mode:
            ai_insights = {
                "score_only": True,
                "failed_tools": failed_tools,
                "llm_skill_scores": llm_skill_scores,
                "llm_adjustment_guidance": llm_adjustment_guidance,
                "architecture_metrics": architecture_metrics_result,
            }
        else:
            ai_insights = {
                "llm_problem_solving": llm_result,
                "llm_skill_scores": llm_skill_scores,
                "llm_adjustment_guidance": llm_adjustment_guidance,
                "architecture_metrics": architecture_metrics_result,
                "failed_tools": failed_tools,
            }

        if not skip_insights:
            logger.info("[run=%s] Developer insight generation started", run_id)
            try:
                score_row = (
                    db.query(SkillScore)
                    .filter(
                        SkillScore.analysis_run_id == run.id,
                        SkillScore.user_id == current_user_id,
                    )
                    .first()
                )
                metric_rows = db.query(CodeMetrics).filter(CodeMetrics.analysis_run_id == run.id).all()
                findings_rows = db.query(SecurityFinding).filter(SecurityFinding.analysis_run_id == run.id).all()
                if score_row:
                    ai_insights["learning_recommendations"] = build_learning_recommendations(
                        run,
                        score_row,
                        metric_rows,
                        findings_rows,
                    )
            except Exception:
                logger.exception("[run=%s] Learning recommendations generation failed", run_id)
            try:
                security_report = {
                    "total_findings": len(findings),
                    "severity_distribution": {},
                    "owasp_distribution": {},
                    "top_vulnerable_files": {},
                }
                file_counts = {}
                for finding in findings:
                    sev = finding.get("severity") or "UNKNOWN"
                    security_report["severity_distribution"][sev] = security_report["severity_distribution"].get(sev, 0) + 1
                    cat = finding.get("owasp_category") or "Unknown"
                    security_report["owasp_distribution"][cat] = security_report["owasp_distribution"].get(cat, 0) + 1
                    fp = finding.get("file_path") or "unknown"
                    file_counts[fp] = file_counts.get(fp, 0) + 1

                security_report["top_vulnerable_files"] = dict(sorted(file_counts.items(), key=lambda x: x[1], reverse=True)[:5])
                security_report["categorized_findings"] = group_findings_by_severity_and_file(findings)
                security_report["security_score"] = security_score
                security_report["security_score_breakdown"] = security_score_breakdown
                security_report["failed_tools"] = failed_tools
                ai_insights["security_report"] = security_report

                analysis_payload = {
                    "scores": final_scores,
                    "aggregate_metrics": code_intelligence_result.get("aggregate_metrics", {}),
                }

                guidance = await generate_insights(
                    role=user_role,
                    analysis_result=analysis_payload,
                    security_report=security_report,
                    doc_id=STANDARDS_DOC_ID,
                )
                if isinstance(guidance, dict):
                    ai_insights.update(guidance)
            except Exception:
                logger.exception("[run=%s] AI insights generation failed", run_id)

            skills_insights = ai_insights.get("skills_insights") or {}
            if not isinstance(skills_insights, dict):
                skills_insights = {}
            for skill in ("code_quality", "maintainability", "architecture"):
                entry = llm_adjustment_guidance.get(skill, {})
                if not entry:
                    continue
                lines = []

                confidence = entry.get("confidence", 0.0) or 0.0
                delta = entry.get("applied_delta", 0.0)

                # AI Adjustment Section
                lines.append("AI Adjustment:")
                if entry.get("ignored"):
                    lines.append(f"- Ignored due to low confidence ({confidence:.2f})")
                else:
                    direction = "increased" if delta > 0 else "decreased"
                    lines.append(f"- Score {direction} by {abs(delta):.2f}")
                    lines.append(f"- Confidence: {confidence:.0%}")

                if entry.get("reason"):
                    lines.append(f"- Reason: {entry.get('reason')}")

                # Static Analysis Section
                base = base_scores.get(skill, 0.0)

                lines.append("")
                lines.append("Static Analysis Summary:")
                lines.append(f"- Base score: {base:.1f}")

                evidence = entry.get("evidence") or []
                if evidence:
                    for e in evidence:
                        lines.append(f"- {e}")
                existing = skills_insights.get(skill) or []
                if not isinstance(existing, list):
                    existing = []
                skills_insights[skill] = lines + existing
            ai_insights["skills_insights"] = skills_insights
            logger.info("[run=%s] Developer insight generation finished", run_id)
        else:
            logger.info(
                "[run=%s] Insight generation skipped role=%s finalize_run=%s",
                run_id,
                user_role,
                finalize_run,
            )

        if finalize_run:
            run.ai_insights = ai_insights
            run.status = "completed"
            run.completed_at = datetime.now(timezone.utc)
            repo_analysis = (
                db.query(RepositoryAnalysis)
                .filter(RepositoryAnalysis.last_run_id == run.id)
                .first()
            )
            if repo_analysis:
                repo_analysis.analysis_status = "completed"
                repo_analysis.analyzed_at = run.completed_at
            db.commit()
            logger.info("[run=%s] Background analysis completed successfully", run_id)
        else:
            logger.info(
                "[run=%s] Contributor score completed user_id=%s without finalizing run",
                run_id,
                current_user_id,
            )
        return {
            "status": "completed",
            "run_id": run_id,
            "score_user_id": current_user_id,
        }

    except LLMError as exc:
        error_text = str(exc)
        logger.exception("[run=%s] LLM error in background task", run_id)

        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if run and finalize_run:
            run.status = "failed"
            run.completed_at = datetime.now(timezone.utc)
            run.ai_insights = {
                "error_reason": "llm_failed",
                "error_message": error_text,
            }
            repo_analysis = (
                db.query(RepositoryAnalysis)
                .filter(RepositoryAnalysis.last_run_id == run.id)
                .first()
            )
            if repo_analysis:
                repo_analysis.analysis_status = "failed"
                repo_analysis.analyzed_at = run.completed_at
            db.commit()
            logger.info("[run=%s] Failure status persisted after LLM error", run_id)
        return {
            "status": "failed",
            "run_id": run_id,
            "score_user_id": current_user_id,
            "error_reason": "llm_failed",
            "error_message": error_text,
        }
    except Exception as exc:
        error_text = str(exc)
        logger.exception("[run=%s] Background task error", run_id)

        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        error_reason = "unknown"
        if run and finalize_run:
            run.status = "failed"
            run.completed_at = datetime.now(timezone.utc)
            if "rate" in error_text.lower():
                error_reason = "rate_limit"
                run.ai_insights = {"error_reason": "rate_limit", "error_message": error_text}
            elif "not found" in error_text.lower():
                error_reason = "not_found"
                run.ai_insights = {"error_reason": "not_found", "error_message": error_text}
            else:
                run.ai_insights = {"error_reason": "unknown", "error_message": error_text}
            repo_analysis = (
                db.query(RepositoryAnalysis)
                .filter(RepositoryAnalysis.last_run_id == run.id)
                .first()
            )
            if repo_analysis:
                repo_analysis.analysis_status = "failed"
                repo_analysis.analyzed_at = run.completed_at
            db.commit()
            logger.info("[run=%s] Failure status persisted after background task error", run_id)
        elif "rate" in error_text.lower():
            error_reason = "rate_limit"
        elif "not found" in error_text.lower():
            error_reason = "not_found"
        return {
            "status": "failed",
            "run_id": run_id,
            "score_user_id": current_user_id,
            "error_reason": error_reason,
            "error_message": error_text,
        }
    finally:
        db.close()


def background_manager_team_analysis_task(*args, **kwargs):
    return asyncio.run(_background_manager_team_analysis_task_async(*args, **kwargs))


async def _background_manager_team_analysis_task_async(
    run_id: int,
    repo_id: int,
    repo_url: str,
    repo_name: str,
    branch: str,
    full_name: str,
    token: str,
    is_private: bool,
    manager_user_id: int,
    manager_contributors: list[dict],
):
    logger.info(
        "[run=%s] Manager team analysis started contributors=%d",
        run_id,
        len(manager_contributors),
    )
    completed: list[dict] = []
    failed: list[dict] = []

    for contributor in manager_contributors:
        try:
            developer_id = int(contributor.get("user_id"))
        except (TypeError, ValueError):
            failed.append({
                "user_id": contributor.get("user_id"),
                "error_reason": "invalid_contributor",
                "error_message": "Contributor payload did not include a valid user_id.",
            })
            continue

        contributor_files = contributor.get("touched_files") or []
        if not contributor_files:
            failed.append({
                "user_id": developer_id,
                "error_reason": "no_touched_files",
                "error_message": "Contributor payload did not include touched files.",
            })
            continue

        result = await _background_analysis_task_async(
            run_id=run_id,
            repo_id=repo_id,
            repo_url=repo_url,
            repo_name=repo_name,
            branch=branch,
            full_name=full_name,
            token=token,
            is_private=is_private,
            current_user_id=developer_id,
            user_role="developer",
            analysis_scope="contribution",
            contributor_login=contributor.get("contributor_login"),
            touched_files=contributor_files,
            finalize_run=False,
            generate_ai_insights=False,
        )

        result = result or {}
        if result.get("status") == "completed":
            completed.append({
                "user_id": developer_id,
                "contributor_login": contributor.get("contributor_login"),
                "touched_file_count": len(contributor_files),
            })
        else:
            failed.append({
                "user_id": developer_id,
                "contributor_login": contributor.get("contributor_login"),
                "error_reason": result.get("error_reason") or "analysis_failed",
                "error_message": result.get("error_message") or "Contributor analysis failed.",
            })

    db = SessionLocal()
    try:
        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if not run:
            logger.warning("[run=%s] Manager team analysis could not finalize: run not found", run_id)
            return {
                "status": "failed",
                "run_id": run_id,
                "error_reason": "run_not_found",
            }

        score_count = (
            db.query(SkillScore)
            .filter(SkillScore.analysis_run_id == run_id)
            .count()
        )
        run.completed_at = datetime.now(timezone.utc)
        run.status = "completed" if score_count else "failed"
        db.flush()
        if run.status == "completed":
            manager_user = db.query(User).filter(User.id == manager_user_id).first()
            repo_score_rows = (
                db.query(SkillScore, AnalysisRun, Repository, User)
                .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
                .join(Repository, AnalysisRun.repository_id == Repository.id)
                .join(User, SkillScore.user_id == User.id)
                .filter(
                    SkillScore.analysis_run_id == run_id,
                    User.role == UserRole.developer,
                )
                .all()
            )

            try:
                repo_insights = await _generate_manager_dashboard_insights_from_rows(
                    repo_score_rows,
                    db,
                    manager_user_id,
                    f"run:{run_id}",
                )
                if repo_insights is not None:
                    run.ai_insights = repo_insights
                    logger.info(
                        "[run=%s] Saved repo-specific manager team insights manager_user_id=%s",
                        run_id,
                        manager_user_id,
                    )
            except Exception:
                logger.exception(
                    "[run=%s] Repo-specific manager team insight generation failed manager_user_id=%s",
                    run_id,
                    manager_user_id,
                )

            try:
                if manager_user:
                    global_rows = _query_manager_score_rows(db, manager_user_id)
                    global_insights = await _generate_manager_dashboard_insights_from_rows(
                        global_rows,
                        db,
                        manager_user_id,
                        "global",
                    )
                    if global_insights is not None:
                        manager_user.global_team_insights = _merge_preserved_member_details(
                            manager_user.global_team_insights,
                            global_insights,
                        )
                        flag_modified(manager_user, "global_team_insights")
                        logger.info(
                            "[run=%s] Saved global manager team insights manager_user_id=%s",
                            run_id,
                            manager_user_id,
                        )

                    if global_rows:
                        rows_by_member: dict[int, list] = {}
                        for row in global_rows:
                            rows_by_member.setdefault(row[3].id, []).append(row)
                        for member_rows in rows_by_member.values():
                            try:
                                await _generate_and_store_member_detail_insights_from_rows(
                                    db,
                                    manager_user,
                                    member_rows,
                                )
                            except Exception:
                                logger.exception(
                                    "[run=%s] Manager member detail insight generation failed manager_user_id=%s member_user_id=%s",
                                    run_id,
                                    manager_user_id,
                                    member_rows[0][3].id if member_rows else None,
                                )
            except Exception:
                logger.exception(
                    "[run=%s] Global manager team insight generation failed manager_user_id=%s",
                    run_id,
                    manager_user_id,
                )
        logger.info(
            "[run=%s] Manager team execution summary manager_user_id=%s requested=%d analyzed=%d failed=%d completed=%s failed_details=%s",
            run_id,
            manager_user_id,
            len(manager_contributors),
            len(completed),
            len(failed),
            completed,
            failed,
        )

        repo_analysis = (
            db.query(RepositoryAnalysis)
            .filter(RepositoryAnalysis.last_run_id == run.id)
            .first()
        )
        if repo_analysis:
            repo_analysis.analysis_status = run.status
            repo_analysis.analyzed_at = run.completed_at

        db.commit()
        logger.info(
            "[run=%s] Manager team analysis finalized status=%s scores=%d completed=%d failed=%d",
            run_id,
            run.status,
            score_count,
            len(completed),
            len(failed),
        )
        return {
            "status": run.status,
            "run_id": run_id,
            "contributors_analyzed": len(completed),
            "contributors_failed": len(failed),
        }
    finally:
        db.close()
