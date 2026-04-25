import subprocess
import json
import shutil

from app.core.security_mapping import CWE_TO_OWASP
from app.core.config import settings


SEMGREP_TO_CWE = {
    "python.lang.security.audit.eval": "CWE-94",
    "python.lang.security.audit.exec": "CWE-94",
    "python.lang.security.audit.subprocess": "CWE-78",
}

def run_semgrep(repo_path):
    semgrep_cmd = (settings.SEMGREP_PATH or "semgrep").strip()
    if not shutil.which(semgrep_cmd):
        raise FileNotFoundError(
            "semgrep executable not found. Install semgrep or set SEMGREP_PATH to the semgrep executable."
        )

    result = subprocess.run(
    [
        semgrep_cmd,
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
    except:
        return findings

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

        findings.append({

            "tool": "semgrep",
            "rule": issue["check_id"],
            "file_path": issue["path"],
            "severity": issue["extra"]["severity"],
            "description": issue["extra"]["message"],
            "line_number": issue["start"]["line"],
            "cwe": cwe,
            "owasp_category": owasp
        })

    return findings