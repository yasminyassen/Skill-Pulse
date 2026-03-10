import subprocess
import json

from app.core.bandit_cwe_mapping import BANDIT_TO_CWE
from app.core.security_mapping import CWE_TO_OWASP


def run_bandit(repo_path):

    result = subprocess.run(
        ["bandit", "-r", repo_path, "-f", "json", "-x", f"{repo_path}/tests,{repo_path}/venv,{repo_path}/.venv"],
        capture_output=True,
        text=True,
        timeout=120
    )

    findings = []

    try:
        data = json.loads(result.stdout)
    except:
        return findings

    for issue in data.get("results", []):

        rule = issue.get("test_id")

        cwe = BANDIT_TO_CWE.get(rule)

        owasp = CWE_TO_OWASP.get(cwe)

        findings.append({
            "tool": "bandit",
            "rule": rule,
            "file_path": issue.get("filename"),
            "severity": issue.get("issue_severity"),
            "description": issue.get("issue_text"),
            "line_number": issue.get("line_number"),
            "cwe": cwe,
            "owasp_category": owasp
        })

    return findings