import sys
import os
import subprocess
import uuid
import tempfile
import logging
import re
from collections import Counter
from datetime import datetime, timezone
from fastapi import Request, APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from app.db.database import get_db, SessionLocal 
from app.db.models import Repository, AnalysisRun, SecurityFinding, CodeMetrics, SkillScore, User
from app.core.auth_utils import get_current_user, decrypt_github_token
from app.core.rate_limiter import limiter

from app.services.security.pipeline import run_security_analysis
from app.services.github_client import (
    verify_repo_access,
    fetch_repo_python_files,
    read_local_repo_files,
    refresh_github_access_token_for_user,
    get_branch_head_sha,
)
from app.services.code_intelligence import analyze_python_files
from ai_services.insights.ai_insights import generate_insights
from ai_services.rag.rag_seeder import STANDARDS_DOC_ID


router = APIRouter(prefix="/analysis", tags=["analysis"])


def _normalize_severity(severity: str | None) -> str:
    s = (severity or "MEDIUM").upper()
    if s == "CRITICAL":
        return "HIGH"
    if s in {"HIGH", "MEDIUM", "LOW"}:
        return s
    return "MEDIUM"


def _group_findings_by_severity_and_file(findings: list[dict]) -> dict:
    grouped: dict[str, dict[str, list[dict]]] = {
        "HIGH": {},
        "MEDIUM": {},
        "LOW": {},
    }

    for finding in findings:
        sev = _normalize_severity(finding.get("severity"))
        file_path = finding.get("file_path") or "unknown"
        entry = {
            "tool": finding.get("tool"),
            "rule": finding.get("rule"),
            "owasp_category": finding.get("owasp_category") or "Unknown",
            "line_number": finding.get("line_number", 0),
            "description": finding.get("description"),
        }
        grouped[sev].setdefault(file_path, []).append(entry)

    return grouped


def _compute_security_score(findings, total_loc: int = 1000):
    #  PATCH: DevSecOps-level scoring

    if not findings:
        return 100.0

    SEVERITY_WEIGHT = {
        "HIGH": 10,
        "MEDIUM": 5,
        "LOW": 2
    }

    CWE_WEIGHT = {
        "CWE-79": 1.5,
        "CWE-89": 1.8,
        "CWE-94": 2.2,
    }

    penalty = 0.0

    # STEP 1: base score
    for f in findings:
        sev = _normalize_severity(f.get("severity"))
        sev_score = SEVERITY_WEIGHT.get(sev, 5)

        cwe_weight = CWE_WEIGHT.get(f.get("cwe"), 1.0)

        penalty += sev_score * cwe_weight

    # STEP 2: density
    density = len(findings) / max(total_loc, 1)
    density_factor = min(2.0, 1 + density * 50)

    # STEP 3: repetition
    unique_files = len(set(f.get("file_path") for f in findings))
    repetition_factor = 1 + (len(findings) - unique_files) * 0.05

    final_penalty = penalty * density_factor * repetition_factor

    return round(max(0.0, 100.0 - final_penalty), 2)


def _compute_overall_score(scores: dict) -> float:
    code_quality = float(scores.get("code_quality", 0.0) or 0.0)
    maintainability = float(scores.get("maintainability", 0.0) or 0.0)
    architecture = float(scores.get("architecture", 0.0) or 0.0)
    problem_solving = float(scores.get("problem_solving", 0.0) or 0.0)
    security_score = float(scores.get("security_score", 0.0) or 0.0)
    return round((code_quality + maintainability + architecture + problem_solving + security_score) / 5.0, 2)


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _safe_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
    
class FindingModel(BaseModel):
    tool: str
    rule: str
    file_path: str
    severity: str
    description: str
    line_number: int
    cwe: str
    owasp_category: str
    
class RepoRequest(BaseModel):
    repo_url: str
    branch: str = "main"


def _build_github_connect_payload(request: Request, current_user: User) -> dict:
    auth_header = request.headers.get("authorization")
    if not auth_header or " " not in auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    jwt_token = auth_header.split(" ", 1)[1]
    base_url = str(request.base_url).rstrip("/")
    return {
        "requires_github_auth": True,
        "auth_url": f"{base_url}/auth/github?action=connect&token={jwt_token}",
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
    user_role: str
):
    db = SessionLocal() 
    try:
        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if not run:
            return
        
        # 1. Clone Repository & Run Security Analysis
        # 2. Clone & Analyze Python Files
        with tempfile.TemporaryDirectory(prefix="repo_") as repo_path:
            clone_path = os.path.join(repo_path, f"{repo_name}_{uuid.uuid4().hex}")
            
            clone_cmd = [
                "git", "clone", "--depth", "1", "--no-tags", "--filter=blob:none",
                "--branch", branch, "--single-branch", repo_url, clone_path
            ]

            if is_private and token:
                auth_repo_url = repo_url.replace("https://", f"https://x-access-token:{token}@")
                clone_cmd[-2] = auth_repo_url # Update URL in command

            subprocess.run(clone_cmd, check=True, timeout=300)
            
            python_files = read_local_repo_files(clone_path)
            code_intelligence_result = analyze_python_files(python_files)

            #  PATCH: handle structured pipeline output
            pipeline_result = run_security_analysis(clone_path)

            findings = pipeline_result.get("findings", [])
            failed_tools = pipeline_result.get("failed_tools", [])
            #  REASON: pipeline now returns structured data
        
        # 2. Fetch & Analyze Python Files
        # try:
        #     # python_files = await fetch_repo_python_files(
        #     #     github_token=token,
        #     #     full_name=full_name,
        #     #     branch=branch,
        #     # )
        #     code_intelligence_result = analyze_python_files(python_files)
        # except Exception as e:
        #     logging.exception(f"Code intelligence fetch failed for {full_name}: {str(e)}")
        #     raise Exception("Failed to retrieve repository file tree or Python file contents.")       
        
        # 3. Store Findings
        
        IGNORED = ["venv", ".venv", "__pycache__", "migrations"]

        findings = [
            f for f in findings
            if not any(p in f.get("file_path", "") for p in IGNORED)
        ]
        
        for f in findings:
            try:
                validated = FindingModel(**f)  #  PATCH
            except ValidationError:
                continue  #  REASON: skip corrupted scanner output
            
            finding = SecurityFinding(
                analysis_run_id=run.id,
                tool=validated.tool,
                rule=validated.rule,
                cwe=validated.cwe,
                file_path=validated.file_path,
                severity=validated.severity,
                description=validated.description,
                line_number=validated.line_number,
                owasp_category=validated.owasp_category
            )
            db.add(finding)

        # 4. Store Code Metrics
        for file_report in code_intelligence_result.get("files", []):
            metrics = file_report.get("metrics", {})
            maintainability_index = max(
                0.0,
                min(
                    100.0,
                    (metrics.get("docstring_coverage", 0.0) * 100)
                    - (metrics.get("duplication_score", 0.0) * 50)
                    - (metrics.get("style_violations", 0.0) * 2)
                    - (metrics.get("avg_nesting_depth", 0.0) * 2),
                ),
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

        # 5. Store Skill Scores
        scores = code_intelligence_result.get("scores", {})
        # PATCH: pass LOC for better scoring
        total_loc = code_intelligence_result.get("aggregate_metrics", {}).get("total_loc", 1000)
        
        security_score = _compute_security_score(
            [
                {
                    "severity": f.get("severity"),
                    "cwe": f.get("cwe"),
                    "file_path": f.get("file_path")
                }
                for f in findings
            ],
            total_loc
        )
        scores["security_score"] = security_score
        scores["overall"] = _compute_overall_score(scores)

        new_skill_score = SkillScore(
            analysis_run_id=run.id,
            user_id=current_user_id,
            code_quality_score=float(scores.get("code_quality", 0.0) or 0.0),
            maintainability_score=float(scores.get("maintainability", 0.0) or 0.0),
            architecture_score=float(scores.get("architecture", 0.0) or 0.0),
            security_awareness_score=float(scores.get("security_score", 0.0) or 0.0),
            problem_solving_score=float(scores.get("problem_solving", 0.0) or 0.0),
            overall_score=float(scores.get("overall", 0.0) or 0.0),
        )
        db.add(new_skill_score)
        db.commit()

        # 6. Generate AI Insights
        ai_insights = {}
        try:
            print(">>> AI Engine: starting...")
            security_report = {"total_findings": len(findings), "severity_distribution": {}, "owasp_distribution": {}, "top_vulnerable_files": {}}
            file_counts = {}
            for f in findings:
                sev = f.get("severity") or "UNKNOWN"
                security_report["severity_distribution"][sev] = security_report["severity_distribution"].get(sev, 0) + 1
                cat = f.get("owasp_category") or "Unknown"
                security_report["owasp_distribution"][cat] = security_report["owasp_distribution"].get(cat, 0) + 1
                fp = f.get("file_path") or "unknown"
                file_counts[fp] = file_counts.get(fp, 0) + 1
                
            security_report["top_vulnerable_files"] = dict(sorted(file_counts.items(), key=lambda x: x[1], reverse=True)[:5])
            security_report["categorized_findings"] = _group_findings_by_severity_and_file(findings)
            security_report["security_score"] = security_score
            security_report["failed_tools"] = failed_tools
            #  REASON: user must know scan was incomplete
            
            analysis_payload = {
                "scores": scores,
                "aggregate_metrics": code_intelligence_result.get("aggregate_metrics", {}),
            }
            
            ai_insights = await generate_insights(
                role=user_role,
                analysis_result=analysis_payload,
                security_report=security_report,
                 doc_id=STANDARDS_DOC_ID,
            )
            print(f">>> AI Engine: done!")
        except Exception as e:
            import traceback
            print(f">>> AI ENGINE ERROR: {traceback.format_exc()}")
            ai_insights = {}

        # 7. Finalize Run Status
        run.ai_insights = ai_insights
        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)
        db.commit()

    except Exception as e:
        import traceback
        error_text = str(e)

        logging.error(f">>> BACKGROUND TASK ERROR: {traceback.format_exc()}")

        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if run:
            run.status = "failed"
            run.completed_at = datetime.now(timezone.utc)

            if "rate" in error_text.lower():
                run.ai_insights = {"error_reason": "rate_limit"}
            elif "not found" in error_text.lower():
                run.ai_insights = {"error_reason": "not_found"}
            else:
                run.ai_insights = {"error_reason": "unknown"}

            db.commit()
    finally:
        db.close() 



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
                    payload = _build_github_connect_payload(request, current_user)
                    payload["reason"] = "github_token_expired"
                    raise HTTPException(status_code=403, detail=payload)
            else:
                raise
    else:
        try:
            repo_data = await verify_repo_access(None, full_name)
        except HTTPException as e:
            if e.status_code == 404:
                if current_user.role.value == "recruiter":
                    raise HTTPException(
                        status_code=403,
                        detail={"recruiter_private_repo": True}
                    )

                raise HTTPException(
                    status_code=403,
                    detail=_build_github_connect_payload(request, current_user)
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

    if is_private and current_user.role.value == "recruiter":
        raise HTTPException(
            status_code=403,
            detail={"recruiter_private_repo": True}
        )

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

    # ── Incremental analysis: skip re-analysis if commit hasn't changed ──
    head_sha = await get_branch_head_sha(token, full_name, data.branch)
    if not head_sha:
        logging.warning("Could not fetch commit SHA — caching disabled")
    if head_sha:
        existing_run = (
            db.query(AnalysisRun)
            .filter(
                AnalysisRun.repository_id == repo.id,
                AnalysisRun.branch == data.branch,
                AnalysisRun.commit_sha == head_sha,
                AnalysisRun.status == "completed",
                AnalysisRun.user_id == current_user.id,
            )
            .order_by(AnalysisRun.triggered_at.desc())
            .first()
        )
        if existing_run:
            return {
                "message": "Repository unchanged since last analysis. Returning cached results.",
                "analysis_run_id": existing_run.id,
                "status": "completed",
                "cached": True,
            }

    # Create Analysis Run (Pending/Running)
    run = AnalysisRun(
        repository_id=repo.id,
        branch=data.branch,
        status="running",
        user_id=current_user.id,
        commit_sha=head_sha,
        triggered_at=datetime.now(timezone.utc)
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    # Trigger Background Task
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
        user_role=current_user.role.value
    )

    # Return Immediately
    return {
        "message": "Analysis started successfully. Running in the background.",
        "analysis_run_id": run.id,
        "status": "running"
    }
    
@router.get("/history")
async def get_analysis_history(
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    past_runs = (
        db.query(AnalysisRun)
        .filter(AnalysisRun.user_id == current_user.id)
        .order_by(AnalysisRun.triggered_at.desc())
        .limit(limit)
        .all()
    )

    result = []

    for run in past_runs:
        score = db.query(SkillScore).filter(
            SkillScore.analysis_run_id == run.id
        ).first()

        result.append({
            "analysis_id": run.id,
            "repo_name": run.repository.name,
            "branch": run.branch,
            "status": run.status,
            "triggered_at": run.triggered_at,
            "completed_at": run.completed_at,
            "score": score.overall_score if score else None
        })

    return {"history": result}


@router.get("/{analysis_run_id}/detailed-metrics")
async def get_detailed_metrics_breakdown(
    analysis_run_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    run = (
        db.query(AnalysisRun)
        .filter(AnalysisRun.id == analysis_run_id)
        .filter(AnalysisRun.user_id == current_user.id)
        .first()
    )

    if not run:
        raise HTTPException(status_code=404, detail="Analysis run not found")

    if run.status != "completed":
        raise HTTPException(status_code=400, detail="Analysis run is not completed")

    score_row = (
        db.query(SkillScore)
        .filter(SkillScore.analysis_run_id == run.id)
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

        loc = row.lines_of_code if row.lines_of_code is not None else _safe_int(raw.get("loc"), 0)
        total_loc += loc

        cyclomatic = (
            row.cyclomatic_complexity
            if row.cyclomatic_complexity is not None
            else _safe_float(raw.get("cyclomatic_complexity"), 0.0)
        )
        cyclomatic_values.append(cyclomatic)

        duplication = (
            row.duplication_score
            if row.duplication_score is not None
            else _safe_float(raw.get("duplication_score"), 0.0)
        )
        duplication_values.append(duplication)

        if row.maintainability_index is not None:
            maintainability_index_values.append(_safe_float(row.maintainability_index, 0.0))

        if raw.get("docstring_coverage") is not None:
            docstring_coverage_values.append(_safe_float(raw.get("docstring_coverage"), 0.0))
        if raw.get("test_function_ratio") is not None:
            test_ratio_values.append(_safe_float(raw.get("test_function_ratio"), 0.0))
        if raw.get("avg_nesting_depth") is not None:
            avg_nesting_values.append(_safe_float(raw.get("avg_nesting_depth"), 0.0))
        if raw.get("avg_function_size") is not None:
            function_size_values.append(_safe_float(raw.get("avg_function_size"), 0.0))
        if raw.get("comment_ratio") is not None:
            comment_ratio_values.append(_safe_float(raw.get("comment_ratio"), 0.0))

        style_violations_total += _safe_int(raw.get("style_violations"), 0)
        missing_docstrings_total += _safe_int(raw.get("missing_docstrings"), 0)
        long_functions_total += _safe_int(raw.get("long_functions"), 0)
        deep_nesting_total += _safe_int(raw.get("deep_nesting"), 0)
        too_many_params_total += _safe_int(raw.get("too_many_params"), 0)
        unused_variables_total += _safe_int(raw.get("unused_variables"), 0)
        import_coupling_total += _safe_int(raw.get("import_coupling"), 0)

        if bool(raw.get("is_test_file")):
            test_files_total += 1

        max_inheritance_depth = max(
            max_inheritance_depth,
            _safe_int(raw.get("max_inheritance_depth"), 0),
        )

    findings_by_severity = Counter(_normalize_severity(f.severity) for f in findings)
    findings_by_owasp = Counter((f.owasp_category or "Unknown") for f in findings)
    findings_by_file = Counter(
        (os.path.basename((f.file_path or "unknown").replace("\\", "/")) or "unknown")
        for f in findings
    )

    def _avg(values: list[float]) -> float:
        return round(sum(values) / len(values), 4) if values else 0.0
    
    total_loc = sum(row.lines_of_code or 0 for row in metric_rows)
    
    code_quality_score = _safe_float(score_row.code_quality_score, 0.0) if score_row else 0.0
    maintainability_score = _safe_float(score_row.maintainability_score, 0.0) if score_row else 0.0
    architecture_score = _safe_float(score_row.architecture_score, 0.0) if score_row else 0.0
    problem_solving_score = _safe_float(score_row.problem_solving_score, 0.0) if score_row else 0.0
    security_score = _safe_float(score_row.security_awareness_score, 0.0) if score_row else _compute_security_score(
        [
            {
                "severity": f.severity,
                "cwe": f.cwe,
                "file_path": f.file_path
            }
            for f in findings
        ],
        total_loc
    )
    overall_score = _safe_float(score_row.overall_score, 0.0) if score_row else _compute_overall_score(
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
    return {
        "analysis_run_id": run.id,
        "repo": run.repository.full_name,
        "branch": run.branch,
        "status": run.status,
        "scores": {
            "code_quality": round(code_quality_score, 2),
            "maintainability": round(maintainability_score, 2),
            "architecture": round(architecture_score, 2),
            "security_score": round(security_score, 2),
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
            "architecture": {
                "import_coupling_total": import_coupling_total,
                "max_inheritance_depth": max_inheritance_depth,
                "avg_nesting_depth": _avg(avg_nesting_values),
                "avg_function_size": _avg(function_size_values),
                "deep_nesting": deep_nesting_total,
            },
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


@router.get("/{analysis_id}")
async def get_analysis_result(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    run = (
        db.query(AnalysisRun)
        .filter(AnalysisRun.id == analysis_id)
        .filter(AnalysisRun.user_id == current_user.id)
        .first()
    )

    if not run:
        return {
            "analysis_id": analysis_id,
            "status": "pending",
        }

    if run.status != "completed":
        return {
            "analysis_id": run.id,
            "status": run.status,
            "error_reason": (run.ai_insights or {}).get("error_reason"),
            "message": "Analysis is still processing or failed."
        }

    scores = db.query(SkillScore).filter(SkillScore.analysis_run_id == run.id).first()
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
    score_rows = (
        db.query(SkillScore, AnalysisRun, Repository)
        .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
        .join(Repository,  AnalysisRun.repository_id == Repository.id)
        .filter(
            SkillScore.user_id    == current_user.id,
            AnalysisRun.status    == "completed",
        )
        .order_by(AnalysisRun.triggered_at.desc())
        .all()
    )

    if not score_rows:
        return {
            "overall":  0.0,
            "delta":    0.0,
            "scores":   {"code_quality": 0.0, "maintainability": 0.0, "architecture": 0.0, "problem_solving": 0.0},
            "deltas":   {"code_quality": 0.0, "maintainability": 0.0, "architecture": 0.0, "problem_solving": 0.0},
            "repos":    [],
        }

    # 2. Build repo list (de-duplicate: keep only the latest run per repo)
    seen_repos: set[tuple] = set()
    repos_list: list[dict] = []
    for skill_score, run, repo in score_rows:
        key = (repo.id, run.branch)  
        if key not in seen_repos:
            seen_repos.add(key)
            repos_list.append({
                "analysis_id":  run.id,
                "repo_name":    repo.name,
                "full_name":    repo.full_name,
                "branch":       run.branch,
                "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            })

    # 3. Aggregate scores across ALL completed runs (average)
    def _avg_scores(rows):
        if not rows:
            return {"code_quality": 0.0, "maintainability": 0.0, "architecture": 0.0, "problem_solving": 0.0, "overall": 0.0}
        n = len(rows)
        return {
            "code_quality":    round(sum(_safe_float(r.SkillScore.code_quality_score)    for r in rows) / n, 2),
            "maintainability": round(sum(_safe_float(r.SkillScore.maintainability_score) for r in rows) / n, 2),
            "architecture":    round(sum(_safe_float(r.SkillScore.architecture_score)    for r in rows) / n, 2),
            "problem_solving": round(sum(_safe_float(r.SkillScore.problem_solving_score) for r in rows) / n, 2),
            "overall":         round(sum(_safe_float(r.SkillScore.overall_score)         for r in rows) / n, 2),
        }

    # Latest run vs previous run for deltas
    latest_run_id  = score_rows[0].AnalysisRun.id
    previous_run_id = score_rows[1].AnalysisRun.id if len(score_rows) > 1 else None

    latest_row   = score_rows[0].SkillScore
    previous_row = score_rows[1].SkillScore if previous_run_id else None

    def _delta(latest_val, prev_val):
        if prev_val is None:
            return 0.0
        return round(_safe_float(latest_val) - _safe_float(prev_val), 2)

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
    }