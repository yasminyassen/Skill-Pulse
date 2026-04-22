import sys
import os
import subprocess
import uuid
import tempfile
import logging
import re
from datetime import datetime, timezone
from fastapi import Request, APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from app.db.database import get_db, SessionLocal 
from app.db.models import Repository, AnalysisRun, SecurityFinding, CodeMetrics, SkillScore, User
from app.core.auth_utils import get_current_user, decrypt_github_token
from app.core.rate_limiter import limiter

from app.services.security.pipeline import run_security_analysis
from app.services.github_client import verify_repo_access, fetch_repo_python_files
from app.services.code_intelligence import analyze_python_files
from ai_services.insights.ai_insights import generate_insights


router = APIRouter(prefix="/analysis", tags=["analysis"])

class RepoRequest(BaseModel):
    repo_url: str
    branch: str = "main"


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

        # 1. Fetch & Analyze Python Files
        try:
            python_files = await fetch_repo_python_files(
                github_token=token,
                full_name=full_name,
                branch=branch,
            )
            code_intelligence_result = analyze_python_files(python_files)
        except Exception as e:
            logging.exception(f"Code intelligence fetch failed for {full_name}: {str(e)}")
            raise Exception("Failed to retrieve repository file tree or Python file contents.")

        # 2. Clone Repository & Run Security Analysis
        with tempfile.TemporaryDirectory(prefix="repo_") as repo_path:
            clone_path = os.path.join(repo_path, f"{repo_name}_{uuid.uuid4().hex}")
            
            clone_cmd = [
                "git", "clone", "--depth", "1", "--no-tags", "--filter=blob:none",
                "--branch", branch, "--single-branch", repo_url, clone_path
            ]

            if is_private and token:
                auth_repo_url = repo_url.replace("https://", f"https://x-access-token:{token}@")
                clone_cmd[-2] = auth_repo_url # Update URL in command

            subprocess.run(clone_cmd, check=True, timeout=120)

            findings = run_security_analysis(clone_path)

        # 3. Store Findings
        for f in findings:
            finding = SecurityFinding(
                analysis_run_id=run.id,
                tool=f.get("tool"),
                rule=f.get("rule"),
                cwe=f.get("cwe"),
                file_path=f.get("file_path"),
                severity=f.get("severity", "MEDIUM"),
                description=f.get("description"),
                line_number=f.get("line_number", 0),
                owasp_category=f.get("owasp_category")
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
        new_skill_score = SkillScore(
            analysis_run_id=run.id,
            user_id=current_user_id,
            code_quality_score=float(scores.get("code_quality", 0.0) or 0.0),
            maintainability_score=float(scores.get("maintainability", 0.0) or 0.0),
            architecture_score=float(scores.get("architecture", 0.0) or 0.0),
            security_awareness_score=float(scores.get("architecture", 0.0) or 0.0),
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
            
            analysis_payload = {
                "scores": scores,
                "aggregate_metrics": code_intelligence_result.get("aggregate_metrics", {}),
            }
            
            ai_insights = await generate_insights(
                role=user_role,
                analysis_result=analysis_payload,
                security_report=security_report,
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
        logging.error(f">>> BACKGROUND TASK ERROR: {traceback.format_exc()}")
        run = db.query(AnalysisRun).filter(AnalysisRun.id == run_id).first()
        if run:
            run.status = "failed"
            run.completed_at = datetime.now(timezone.utc)
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

    try:
        repo_data = await verify_repo_access(token, full_name)
    except Exception:
        if not token:
            return {
                "requires_github_auth": True,
                "auth_url": f"http://127.0.0.1:8000/auth/github?action=connect&token={request.headers.get('authorization').split()[1]}"
            }
        raise HTTPException(status_code=404, detail="Repository not found or not accessible")

    is_private = repo_data.get("private", False)
    
    if is_private and current_user.role.value == "recruiter":
        raise HTTPException(status_code=403, detail="Recruiters cannot analyze private repositories.")

    # Get or Create Repo
    repo = db.query(Repository).filter(Repository.github_repo_id == str(repo_data["id"])).first()
    if not repo:
        repo = Repository(
            name=repo_name,
            full_name=full_name,
            url=data.repo_url,
            github_repo_id=str(repo_data["id"]) if repo_data else None,
            is_private=is_private,
            owner_id=current_user.id
        )
        db.add(repo)
        db.commit()
        db.refresh(repo)

    # Create Analysis Run (Pending/Running)
    run = AnalysisRun(
        repository_id=repo.id,
        branch=data.branch,
        status="running",
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
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .filter(Repository.owner_id == current_user.id)
        .order_by(AnalysisRun.triggered_at.desc())
        .limit(limit)
        .all()
    )

    return {
        "history": [
            {
                "analysis_id": run.id,
                "repo_name": run.repository.name,
                "branch": run.branch,
                "status": run.status,
                "triggered_at": run.triggered_at,
                "completed_at": run.completed_at
            }
            for run in past_runs
        ]
    }


@router.get("/{analysis_id}")
async def get_analysis_result(
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    run = (
        db.query(AnalysisRun)
        .join(Repository, AnalysisRun.repository_id == Repository.id)
        .filter(AnalysisRun.id == analysis_id)
        .filter(Repository.owner_id == current_user.id)
        .first()
    )

    if not run:
        raise HTTPException(status_code=404, detail="Analysis not found")

    if run.status != "completed":
        return {
            "analysis_id": run.id,
            "status": run.status,
            "message": "Analysis is still processing or failed."
        }

    scores = db.query(SkillScore).filter(SkillScore.analysis_run_id == run.id).first()
    findings_count = db.query(SecurityFinding).filter(SecurityFinding.analysis_run_id == run.id).count()

    return {
        "analysis_run_id": run.id,
        "repo": run.repository.full_name,
        "branch": run.branch,
        "status": run.status,
        "scores": {
            "code_quality": scores.code_quality_score if scores else 0,
            "maintainability": scores.maintainability_score if scores else 0,
            "architecture": scores.architecture_score if scores else 0,
            "problem_solving": scores.problem_solving_score if scores else 0,
            "overall": scores.overall_score if scores else 0,
        },
        "security_findings_count": findings_count,
        "ai_insights": run.ai_insights,
        "completed_at": run.completed_at
    }    