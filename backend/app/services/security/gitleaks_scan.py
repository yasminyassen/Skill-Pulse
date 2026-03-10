import subprocess
import json
import os

from app.core.security_mapping import CWE_TO_OWASP
from app.core.config import settings


def run_gitleaks(repo_path):

    report_path = os.path.join(repo_path, "gitleaks-report.json")

    subprocess.run(
        [
            settings.GITLEAKS_PATH,
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