import subprocess
import json

from app.core.security_mapping import CWE_TO_OWASP


def run_semgrep(repo_path):

    result = subprocess.run(
    [
        "semgrep",
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

        if isinstance(cwe, list) and cwe:
            cwe = cwe[0]

        if isinstance(cwe, str) and ":" in cwe:
            cwe = cwe.split(":")[0]

        owasp = CWE_TO_OWASP.get(cwe, "A02")

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