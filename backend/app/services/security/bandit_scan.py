import subprocess
import json
import os
import shutil

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
        return file_path.replace("\\", "/")


def run_bandit(repo_path):
    if not shutil.which("bandit"):
        print("bandit: executable not found, skipping")
        return []

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
    stdout = result.stdout or ""
    stderr = result.stderr or ""

    print(
        f"bandit: exit={result.returncode}, stdout_len={len(stdout)}, stderr_len={len(stderr)}"
    )

    try:
        data = json.loads(stdout)
    except Exception:
        data = None
        decoder = json.JSONDecoder()
        for idx, char in enumerate(stdout):
            if char != "{":
                continue
            try:
                data, _ = decoder.raw_decode(stdout[idx:])
                print("bandit: recovered JSON after non-JSON stdout prefix")
                break
            except Exception:
                continue

    if data is None:
        if stderr.strip():
            print(f"bandit: stderr =>\n{stderr.strip()[:1000]}")
        if stdout.strip():
            print(f"bandit: invalid JSON stdout preview =>\n{stdout.strip()[:1000]}")
        print("bandit: failed to parse JSON output")
        return findings

    if result.returncode not in {0, 1} and not data.get("results"):
        if stderr.strip():
            print(f"bandit: failed stderr =>\n{stderr.strip()[:1000]}")
        print("bandit: non-standard exit with no results")

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
        line_range = issue.get("line_range")
        start_line = None
        end_line = None
        if isinstance(line_range, list) and len(line_range) >= 2:
            start_line = line_range[0]
            end_line = line_range[-1]

        findings.append({
            "tool": "bandit",
            "rule": rule,
            "file_path": file_path,
            "severity": issue.get("issue_severity"),
            "description": issue.get("issue_text"),
            "line_number": issue.get("line_number"),
            "start_line": start_line,
            "end_line": end_line,
            "start_column": issue.get("col_offset"),
            "end_column": issue.get("end_col_offset"),
            "cwe": cwe,
            "owasp_category": owasp,
            "raw_metadata": {
                "test_name": issue.get("test_name"),
                "issue_confidence": issue.get("issue_confidence"),
                "code": issue.get("code"),
                "more_info": issue.get("more_info"),
                "line_range": issue.get("line_range"),
                "col_offset": issue.get("col_offset"),
                "end_col_offset": issue.get("end_col_offset"),
            },
        })

    return findings
