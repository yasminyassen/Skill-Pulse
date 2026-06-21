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

from app.db.database import SessionLocal
from app.db.models import AnalysisRun, RepositoryAnalysis, SecurityFinding, CodeMetrics, SkillScore, User
from app.services.security.pipeline import run_security_analysis
from app.services.github_client import (
    read_local_repo_files,
    refresh_github_access_token_for_user,
    fetch_authenticated_github_user,
)
from app.services.code_intelligence import analyze_python_files
from app.services.llm_client import analyze_problem_solving, analyze_skill_scores, LLMError
from app.services.metrics import build_unified_schema
from app.services.learning_recommendations import build_learning_recommendations
from ai_services.insights.ai_insights import generate_insights
from ai_services.rag.rag_seeder import STANDARDS_DOC_ID
from app.core.auth_utils import decrypt_github_token
from app.services.security_service import compute_security_score_breakdown, group_findings_by_severity_and_file
from app.services.code_analysis_service import apply_adjustment, compute_overall_score


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


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


async def background_analysis_task(
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
):
    is_recruiter_scoring_mode = user_role == "recruiter"
    skip_insights = is_recruiter_scoring_mode
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
                    _add("import_coupling_total", metrics.get("import_coupling_total"))
                    _add("efferent_coupling_total", metrics.get("efferent_coupling_total"))
                    _add("circular_import_count", metrics.get("circular_import_count"))
                    _add("max_inheritance_depth", metrics.get("max_inheritance_depth"))
                    _add("avg_nesting_depth", metrics.get("avg_nesting_depth"))
                    _add("avg_function_size", metrics.get("avg_function_size"))
                    _add("avg_class_lcom", metrics.get("avg_class_lcom"))
                    _add("god_classes", metrics.get("god_classes"))
                    _add("class_count", metrics.get("class_count"))

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
                    for skill in ("code_quality", "maintainability", "architecture"):
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
                for skill in ("code_quality", "maintainability", "architecture"):
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
            }
        else:
            ai_insights = {
                "llm_problem_solving": llm_result,
                "llm_skill_scores": llm_skill_scores,
                "llm_adjustment_guidance": llm_adjustment_guidance,
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
            logger.info("[run=%s] Recruiter mode: skipped AI insights and learning recommendations", run_id)

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

    except LLMError as exc:
        error_text = str(exc)
        logger.exception("[run=%s] LLM error in background task", run_id)

        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if run:
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
    except Exception as exc:
        error_text = str(exc)
        logger.exception("[run=%s] Background task error", run_id)

        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if run:
            run.status = "failed"
            run.completed_at = datetime.now(timezone.utc)
            if "rate" in error_text.lower():
                run.ai_insights = {"error_reason": "rate_limit", "error_message": error_text}
            elif "not found" in error_text.lower():
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
    finally:
        db.close()


def run_background_analysis_task(*args, **kwargs):
    asyncio.run(background_analysis_task(*args, **kwargs))
