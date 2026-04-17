import sys
import os
import subprocess
import uuid
import tempfile
import logging
import re
from datetime import datetime,timezone
from fastapi import Request
from app.core.rate_limiter import limiter

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.database import get_db
from app.db.models import Repository, AnalysisRun, SecurityFinding, CodeMetrics, SkillScore
from app.core.auth_utils import get_current_user
from app.db.models import User

from app.services.security.pipeline import run_security_analysis
from app.services.github_client import verify_repo_access, fetch_repo_python_files
from app.services.code_intelligence import analyze_python_files
from app.core.auth_utils import decrypt_github_token


router = APIRouter(prefix="/analysis", tags=["analysis"])


class RepoRequest(BaseModel):
    repo_url: str
    branch: str = "main"


@router.post("/run")
@limiter.limit("2/minute")
async def run_analysis(
    request: Request,
    data: RepoRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # -----------------------------
    # Validate repo URL
    # -----------------------------

    if not re.match(r"^https://github\.com/[^/]+/[^/]+", data.repo_url):
        raise HTTPException(
            status_code=400,
            detail="Invalid GitHub repository URL"
        )
    
    full_name = data.repo_url.replace("https://github.com/", "").replace(".git", "")
    repo_name = full_name.split("/")[-1]
    
    repo_url = data.repo_url
    is_private = False
    repo_data = None
    token = None

    if current_user.github_access_token:
        token = decrypt_github_token(current_user.github_access_token)

    try:
        repo_data = await verify_repo_access(token, full_name)

    except Exception as e:
        if not token:
            return {
                "requires_github_auth": True,
                "auth_url": f"http://127.0.0.1:8000/auth/github?action=connect&token={request.headers.get('authorization').split()[1]}"
            }

        raise HTTPException(
            status_code=404,
            detail="Repository not found or not accessible"
        )

    is_private = repo_data.get("private", False)
    # -----------------------------
    # Check if repo exists
    # -----------------------------

    repo = db.query(Repository).filter(
        Repository.github_repo_id == str(repo_data["id"])
    ).first()
    
    code_intelligence_result = {
        "files": [],
        "aggregate_metrics": {},
        "scores": {
            "code_quality": 0,
            "maintainability": 0,
            "architecture": 0,
            "problem_solving": 0,
            "overall": 0,
        },
    }

    try:
        python_files = await fetch_repo_python_files(
            github_token=token,
            full_name=full_name,
            branch=data.branch,
        )
        code_intelligence_result = analyze_python_files(python_files)
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"Code intelligence fetch failed for {full_name}: {str(e)}")
        raise HTTPException(
            status_code=502,
            detail="Failed to retrieve repository file tree or Python file contents.",
        )
    
    # -----------------------------
    # Create temp directory
    # -----------------------------

    with tempfile.TemporaryDirectory(prefix="repo_") as repo_path:

        try: 
            if is_private and current_user.role.value == "recruiter":
                raise HTTPException(
                    status_code=403,
                    detail="Recruiters cannot analyze private repositories."
                )
                
            # -----------------------------
            # Clone repository
            # -----------------------------
            
            clone_path = os.path.join(repo_path, f"{repo_name}_{uuid.uuid4().hex}")
            clone_cmd = [
                "git",
                "clone",
                "--depth",
                "1",
                "--no-tags",
                "--filter=blob:none",
                "--branch", data.branch,
                "--single-branch",
                repo_url,
                clone_path
            ]

            if is_private and token:
                auth_repo_url = repo_url.replace(
                    "https://",
                    f"https://x-access-token:{token}@"
                )

                clone_cmd = [
                    "git",
                    "clone",
                    "--depth", "1",
                    "--no-tags",
                    "--filter=blob:none",
                    "--branch", data.branch,
                    "--single-branch",
                    auth_repo_url,
                    clone_path
                ]
            # clone repository
            subprocess.run(clone_cmd, check=True, timeout=120)
            if is_private:
                auth_repo_url = None
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
            
        except Exception as e:

            logging.exception(f"Clone failed for {full_name}")

            raise HTTPException(
                status_code=400,
                detail="Repository clone failed. Branch may not exist or repository is inaccessible."
            )
            
        # -----------------------------
        # Create analysis run
        # -----------------------------

        run = AnalysisRun(
            repository_id=repo.id,
            branch=data.branch,
            status="running",
            triggered_at=datetime.now(timezone.utc)
        )

        db.add(run)
        db.commit()
        db.refresh(run)

        try:

            # -----------------------------
            # Run security analysis
            # -----------------------------

            findings = run_security_analysis(clone_path)

        except Exception as e:

            logging.error(f"Analysis failed: {str(e)}")

            run.status = "failed"
            run.completed_at = datetime.now(timezone.utc)
            db.commit()

            raise HTTPException(
                status_code=500,
                detail="Security analysis failed"
            )

        # -----------------------------
        # Store findings
        # -----------------------------

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

            db.add(
                CodeMetrics(
                    analysis_run_id=run.id,
                    file_path=file_report.get("path"),
                    cyclomatic_complexity=float(metrics.get("cyclomatic_complexity", 0.0) or 0.0),
                    lines_of_code=int(metrics.get("loc", 0) or 0),
                    duplication_score=float(metrics.get("duplication_score", 0.0) or 0.0),
                    maintainability_index=maintainability_index,
                    raw_metrics=metrics,
                )
            )

        scores = code_intelligence_result.get("scores", {})
        new_skill_score = SkillScore(
            analysis_run_id=run.id,
            user_id=current_user.id,
            code_quality_score=float(scores.get("code_quality", 0.0) or 0.0),
            maintainability_score=float(scores.get("maintainability", 0.0) or 0.0),
            architecture_score=float(scores.get("architecture", 0.0) or 0.0),
            security_awareness_score=float(scores.get("architecture", 0.0) or 0.0),
            problem_solving_score=float(scores.get("problem_solving", 0.0) or 0.0),
            overall_score=float(scores.get("overall", 0.0) or 0.0),
        )
        db.add(new_skill_score)

        db.commit()

        # -----------------------------
        # Update run status
        # -----------------------------

        run.status = "completed"
        run.completed_at = datetime.now(timezone.utc)

        db.commit()

        # -----------------------------
        # Response
        # -----------------------------

        previous = (
            db.query(SkillScore)
            .join(AnalysisRun, SkillScore.analysis_run_id == AnalysisRun.id)
            .filter(
                AnalysisRun.repository_id == repo.id,
                AnalysisRun.id != run.id,
            )
            .order_by(AnalysisRun.triggered_at.desc())
            .first()
        )

        current_overall = float(code_intelligence_result.get("scores", {}).get("overall", 0.0) or 0.0)
        previous_overall = float(previous.overall_score) if previous else None
        if previous_overall is None:
            delta = {"previous_score": None, "change": "+0.00"}
        else:
            change = current_overall - previous_overall
            delta = {
                "previous_score": round(previous_overall, 2),
                "change": f"{change:+.2f}",
            }

        return {
            "analysis_run_id": run.id,
            "repo": full_name,
            "files": [
                {
                    "path": f.get("path"),
                    "metrics": f.get("metrics", {}),
                }
                for f in code_intelligence_result.get("files", [])
            ],
            "aggregate_metrics": code_intelligence_result.get("aggregate_metrics", {}),
            "scores": code_intelligence_result.get("scores", {}),
            "delta": delta,
            "security_findings_count": len(findings),
        }