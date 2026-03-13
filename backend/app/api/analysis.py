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
from app.db.models import Repository, AnalysisRun, SecurityFinding
from app.core.auth_utils import get_current_user
from app.db.models import User

from app.services.security.pipeline import run_security_analysis
from app.services.github_client import verify_repo_access
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
    
    if repo:
        last_run = db.query(AnalysisRun).filter(
            AnalysisRun.repository_id == repo.id,
            AnalysisRun.branch == data.branch
        ).order_by(AnalysisRun.triggered_at.desc()).first()

        if last_run and last_run.status == "completed":
            return {
                "message": "Repository already analyzed for this branch",
                "analysis_run_id": last_run.id,
                "status": last_run.status
            }
    
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

        return {
            "analysis_run_id": run.id,
            "repository": repo_name,
            "findings_count": len(findings)
        }