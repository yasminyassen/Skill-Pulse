import subprocess
import json
import os

from app.core.security_mapping import CWE_TO_OWASP


def run_safety(repo_path):

    req_file = os.path.join(repo_path, "requirements.txt")

    if not os.path.exists(req_file):
        return []

    result = subprocess.run(
        ["safety", "check", "-r", req_file, "--json"],
        capture_output=True,
        text=True,
        timeout=120
    )

    findings = []

    output = result.stdout

    start = output.find("{")
    end = output.rfind("}")

    if start == -1 or end == -1:
        return findings

    json_text = output[start:end+1]

    try:
        data = json.loads(json_text)
    except:
        return findings

    vulnerabilities = data.get("vulnerabilities", [])

    for vuln in vulnerabilities:

        cwe = "CWE-1104"

        findings.append({
            "tool": "safety",
            "rule": vuln.get("vulnerability_id"),
            "file_path": "requirements.txt",
            "severity": "HIGH",
            "description": vuln.get("advisory"),
            "line_number": 0,
            "cwe": cwe,
            "owasp_category": CWE_TO_OWASP.get(cwe)
        })

    return findings