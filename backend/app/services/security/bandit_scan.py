import subprocess
import json
import os

from app.core.bandit_cwe_mapping import BANDIT_TO_CWE
from app.core.security_mapping import CWE_TO_OWASP


def _relative_path(file_path: str, repo_path: str) -> str:
    """
    Convert absolute file path from bandit output to a path
    relative to the repo root. This keeps file paths consistent
    with gitleaks and semgrep which both return relative paths.

    Example:
        /tmp/repo_abc/myproject/auth.py  →  myproject/auth.py
    """
    try:
        rel = os.path.relpath(file_path, repo_path)
        # os.path.relpath uses OS separator — normalize to forward slashes
        return rel.replace("\\", "/")
    except ValueError:
        # relpath can fail on Windows if paths are on different drives
        return file_path


def run_bandit(repo_path):

    result = subprocess.run(
        [
            "bandit", "-r", repo_path,
            "-f", "json",
            "-x", f"{repo_path}/tests,{repo_path}/venv,{repo_path}/.venv",
        ],
        capture_output=True,
        text=True,
        timeout=120
    )

    findings = []

    try:
        data = json.loads(result.stdout)
    except Exception:
        return findings

    for issue in data.get("results", []):

        rule = issue.get("test_id")

        # 1) native CWE from bandit
        cwe = None
        cwe_data = issue.get("issue_cwe")

        if isinstance(cwe_data, dict):
            cwe_id = cwe_data.get("id")
            if cwe_id:
                cwe = f"CWE-{cwe_id}"

        # 2) fallback to mapping
        if not cwe:
            cwe = BANDIT_TO_CWE.get(rule)

        # 3) last fallback (avoid nulls)
        if not cwe:
            cwe = "CWE-703"  # generic / unknown

        owasp = CWE_TO_OWASP.get(cwe, "A10")  # default OWASP

        raw_path = issue.get("filename") or ""
        file_path = _relative_path(raw_path, repo_path) if raw_path else "unknown"

        findings.append({
            "tool": "bandit",
            "rule": rule,
            "file_path": file_path,
            "severity": issue.get("issue_severity"),
            "description": issue.get("issue_text"),
            "line_number": issue.get("line_number"),
            "cwe": cwe,
            "owasp_category": owasp,
        })

    return findings