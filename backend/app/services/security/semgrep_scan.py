import subprocess
import json
import os
import shutil

from app.core.security_mapping import CWE_TO_OWASP
from app.core.config import settings


SEMGREP_TO_CWE = {
    "python.lang.security.audit.eval": "CWE-94",
    "python.lang.security.audit.exec": "CWE-94",
    "python.lang.security.audit.subprocess": "CWE-78",
}


def _relative_path(file_path: str, repo_path: str) -> str:
    normalized = (file_path or "").replace("\\", "/")
    if not normalized or not os.path.isabs(file_path):
        return normalized or "unknown"

    try:
        rel = os.path.relpath(file_path, repo_path)
        return rel.replace("\\", "/")
    except ValueError:
        return normalized


def run_semgrep(repo_path):
    semgrep_cmd = (settings.SEMGREP_PATH or "semgrep").strip()
    semgrep_path = semgrep_cmd if os.path.exists(semgrep_cmd) else shutil.which(semgrep_cmd)
    if not semgrep_path:
        raise FileNotFoundError(
            "semgrep executable not found. Install semgrep or set SEMGREP_PATH to the semgrep executable."
        )

    result = subprocess.run(
        [
            semgrep_path,
            "--config",
            "p/security-audit",
            "--json",
            "--exclude",
            "tests",
            "--include",
            "*.py",
            repo_path
        ],
        capture_output=True,
        text=True,
        timeout=300
    )

    findings = []

    try:
        data = json.loads(result.stdout)
    except Exception as exc:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(
            f"semgrep did not return valid JSON (exit={result.returncode}): {stderr[:500]}"
        ) from exc

    if result.returncode not in {0, 1} and not data.get("results"):
        stderr = (result.stderr or "").strip()
        raise RuntimeError(f"semgrep failed (exit={result.returncode}): {stderr[:500]}")

    for issue in data.get("results", []):

        metadata = issue.get("extra", {}).get("metadata", {}) or {}

        cwe = metadata.get("cwe")

        # normalize
        if isinstance(cwe, list) and cwe:
            cwe = cwe[0]

        if isinstance(cwe, str) and ":" in cwe:
            cwe = cwe.split(":")[0]

        # fallback if missing
        if not cwe:
            # fallback by rule (optional dict)
            cwe = SEMGREP_TO_CWE.get(issue["check_id"])

        # final fallback
        if not cwe:
            cwe = "CWE-703"

        owasp = CWE_TO_OWASP.get(cwe, "A10")
        file_path = _relative_path(issue.get("path") or "", repo_path)

        findings.append({

            "tool": "semgrep",
            "rule": issue["check_id"],
            "file_path": file_path,
            "severity": issue["extra"]["severity"],
            "description": issue["extra"]["message"],
            "line_number": issue["start"]["line"],
            "cwe": cwe,
            "owasp_category": owasp
        })

    return findings
