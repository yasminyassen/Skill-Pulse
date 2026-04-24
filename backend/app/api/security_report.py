from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.database import get_db
from app.db.models import SecurityFinding
from app.core.auth_utils import get_current_user
from app.db.models import User
from fastapi import Request
from app.core.rate_limiter import limiter


router = APIRouter(prefix="/security-report", tags=["security"])


def _severity_bucket(severity: str | None) -> str:
    s = (severity or "MEDIUM").upper()
    if s == "CRITICAL":
        return "HIGH"
    if s in {"HIGH", "MEDIUM", "LOW"}:
        return s
    return "MEDIUM"


@router.get("/{analysis_id}")
@limiter.limit("20/minute")
def get_security_report(
    request: Request,
    analysis_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):

    findings = db.query(SecurityFinding).filter(
        SecurityFinding.analysis_run_id == analysis_id
    ).all()

    if not findings:
        return {
            "analysis_id": analysis_id,
            "total_findings": 0,
            "severity_distribution": {},
            "tool_distribution": {},
            "owasp_distribution": {},
            "categorized_findings": {
                "HIGH": {},
                "MEDIUM": {},
                "LOW": {},
            },
        }

    total = len(findings)

    severity_stats = (
        db.query(SecurityFinding.severity, func.count())
        .filter(SecurityFinding.analysis_run_id == analysis_id)
        .group_by(SecurityFinding.severity)
        .all()
    )

    tool_stats = (
        db.query(SecurityFinding.tool, func.count())
        .filter(SecurityFinding.analysis_run_id == analysis_id)
        .group_by(SecurityFinding.tool)
        .all()
    )

    owasp_stats = (
        db.query(SecurityFinding.owasp_category, func.count())
        .filter(SecurityFinding.analysis_run_id == analysis_id)
        .group_by(SecurityFinding.owasp_category)
        .all()
    )
    
    file_stats = (
    db.query(SecurityFinding.file_path, func.count())
    .filter(SecurityFinding.analysis_run_id == analysis_id)
    .group_by(SecurityFinding.file_path)
    .order_by(func.count().desc())
    .limit(5)
    .all()
    )

    categorized_findings = {
        "HIGH": {},
        "MEDIUM": {},
        "LOW": {},
    }

    for f in findings:
        severity = _severity_bucket(f.severity)
        file_path = f.file_path or "unknown"
        categorized_findings[severity].setdefault(file_path, []).append(
            {
                "tool": f.tool,
                "rule": f.rule,
                "owasp_category": f.owasp_category or "Unknown",
                "line_number": f.line_number or 0,
                "description": f.description,
            }
        )

    return {

        "analysis_id": analysis_id,

        "total_findings": total,

        "severity_distribution": {
            k: v for k, v in severity_stats
        },

        "tool_distribution": {
            k: v for k, v in tool_stats
        },

        "owasp_distribution": {
            (k or "Unknown"): v for k, v in owasp_stats
        },
        
        "top_vulnerable_files": {
            k: v for k, v in file_stats
        },
        "categorized_findings": categorized_findings,

    }