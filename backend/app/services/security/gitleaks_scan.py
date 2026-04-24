import subprocess
import json
import os
import shutil
from pathlib import Path

from app.core.security_mapping import CWE_TO_OWASP
from app.core.config import settings


def run_gitleaks(repo_path):
    configured = (settings.GITLEAKS_PATH or "").strip()
    exe_path = configured

    # If a directory was configured, run the binary inside it.
    configured_path = Path(configured) if configured else None
    if configured_path and configured_path.exists() and configured_path.is_dir():
        exe_path = str(configured_path / "gitleaks.exe")

    # Fallback to PATH lookup when config path is missing/invalid.
    if not exe_path or (not os.path.exists(exe_path) and not shutil.which(exe_path)):
        resolved = shutil.which("gitleaks")
        if not resolved:
            raise FileNotFoundError(
                "gitleaks executable not found. Set GITLEAKS_PATH to gitleaks.exe or install gitleaks in PATH."
            )
        exe_path = resolved

    report_path = os.path.join(repo_path, "gitleaks-report.json")

    subprocess.run(
        [
            exe_path,
            "detect",
            "--source",
            repo_path,
            "--no-git",
            "--report-format",
            "json",
            "--report-path",
            report_path,
            "--no-banner"
        ],
        capture_output=True,
        text=True,
        timeout=120
    )

    findings = []

    if not os.path.exists(report_path):
        return findings

    try:
        with open(report_path, "r") as f:
            data = json.load(f)
    except:
        return findings

    for issue in data:
        findings.append({
            "tool": "gitleaks",
            "rule": issue.get("RuleID"),
            "file_path": issue.get("File"),
            "severity": "HIGH",
            "description": issue.get("Description"),
            "line_number": issue.get("StartLine"),
            "cwe": "CWE-798",
            "owasp_category": CWE_TO_OWASP.get("CWE-798")
        })

    return findings