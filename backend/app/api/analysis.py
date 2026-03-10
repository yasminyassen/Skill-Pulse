import sys
import os
import subprocess
import uuid
import shutil
import tempfile
import logging
from datetime import datetime
from fastapi import Request
from app.core.rate_limiter import limiter

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../"))
if ROOT_DIR not in sys.path:
    sys.path.append(ROOT_DIR)

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.db.database import get_db
from app.db.models import Repository, AnalysisRun, SecurityFinding
from app.core.auth_utils import get_current_user
from app.db.models import User

from app.services.security.pipeline import run_security_analysis


router = APIRouter(prefix="/analysis", tags=["analysis"])


class RepoRequest(BaseModel):
    repo_url: str


@router.post("/run")
@limiter.limit("2/minute")
def run_analysis(
    request: Request,
    data: RepoRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    # -----------------------------
    # Validate repo URL
    # -----------------------------

    if not data.repo_url.startswith("https://github.com/"):
        raise HTTPException(
            status_code=400,
            detail="Only GitHub repositories are allowed"
        )

    repo_name = data.repo_url.split("/")[-1]
    full_name = data.repo_url.replace("https://github.com/", "")

    # -----------------------------
    # Check if repo exists
    # -----------------------------

    repo = db.query(Repository).filter(
        Repository.url == data.repo_url
    ).first()

    if not repo:

        repo = Repository(
            name=repo_name,
            full_name=full_name,
            url=data.repo_url,
            github_repo_id=None,
            is_private=False,
            owner_id=current_user.id
        )

        db.add(repo)
        db.commit()
        db.refresh(repo)

    # -----------------------------
    # Create analysis run
    # -----------------------------

    run = AnalysisRun(
        repository_id=repo.id,
        status="running",
        triggered_at=datetime.utcnow()
    )

    db.add(run)
    db.commit()
    db.refresh(run)

    # -----------------------------
    # Create temp directory
    # -----------------------------

    repo_path = tempfile.mkdtemp(prefix="repo_")

    try:

        # -----------------------------
        # Clone repository
        # -----------------------------

        subprocess.run(
            ["git", "clone", "--depth", "1", data.repo_url, repo_path],
            check=True,
            timeout=60
        )
        
    except Exception as e:

        logging.error(f"Clone failed: {str(e)}")

        run.status = "failed"
        run.completed_at = datetime.utcnow()
        db.commit()

        shutil.rmtree(repo_path, ignore_errors=True)

        raise HTTPException(
            status_code=400,
            detail="Failed to clone repository"
        )

    try:

        # -----------------------------
        # Run security analysis
        # -----------------------------

        findings = run_security_analysis(repo_path)

    except Exception as e:

        logging.error(f"Analysis failed: {str(e)}")

        run.status = "failed"
        run.completed_at = datetime.utcnow()
        db.commit()

        shutil.rmtree(repo_path, ignore_errors=True)

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

    db.commit()

    # -----------------------------
    # Update run status
    # -----------------------------

    run.status = "completed"
    run.completed_at = datetime.utcnow()

    db.commit()

    # -----------------------------
    # Cleanup
    # -----------------------------

    shutil.rmtree(repo_path, ignore_errors=True)

    # -----------------------------
    # Response
    # -----------------------------

    return {
        "analysis_run_id": run.id,
        "repository": repo_name,
        "findings_count": len(findings)
    }