import subprocess
import json
import os
import shutil
import tempfile

from app.core.security_mapping import CWE_TO_OWASP

CWE = "CWE-1104"


def _get_safety_version() -> int:
    # Detect installed safety major version
    try:
        result = subprocess.run(
            ["safety", "--version"],
            capture_output=True,
            text=True,
            timeout=10
        )
        output = (result.stdout + result.stderr).lower()
        for token in output.split():
            token = token.strip("safety,: ")
            if token and token[0].isdigit():
                return int(token.split(".")[0])
    except Exception:
        pass
    return 3  # default fallback


def _parse_v2(output: str) -> list:
    findings = []

    try:
        decoder = json.JSONDecoder()
        idx = 0

        while idx < len(output):
            try:
                obj, end = decoder.raw_decode(output[idx:])

                if isinstance(obj, list):
                    for vuln in obj:
                        if isinstance(vuln, list) and len(vuln) >= 5:
                            findings.append({
                                "tool": "safety",
                                "rule": str(vuln[4]),
                                "file_path": "requirements.txt",
                                "severity": "HIGH",
                                "description": vuln[3],
                                "line_number": 0,
                                "cwe": CWE,
                                "owasp_category": CWE_TO_OWASP.get(CWE),
                            })

                idx += end
            except Exception:
                idx += 1

    except Exception as e:
        print(f"safety parse v2 failed (final): {e}")

    return findings


def _parse_v3(output: str) -> list:
    findings = []

    try:
        decoder = json.JSONDecoder()

        for i in range(len(output)):
            try:
                obj, _ = decoder.raw_decode(output[i:])
                if isinstance(obj, dict):
                    data = obj
                    break
            except Exception:
                continue
        else:
            print("safety: no valid JSON object found")
            return findings

        vulns = (
            data.get("vulnerabilities")
            or data.get("report", {}).get("vulnerabilities")
            or []
        )

        for vuln in vulns:
            findings.append({
                "tool": "safety",
                "rule": str(vuln.get("vulnerability_id") or vuln.get("id") or ""),
                "file_path": "requirements.txt",
                "severity": "HIGH",
                "description": vuln.get("advisory") or vuln.get("description") or "",
                "line_number": 0,
                "cwe": CWE,
                "owasp_category": CWE_TO_OWASP.get(CWE),
            })

    except Exception as e:
        print(f"safety parse v3 failed (robust): {e}")

    return findings


def run_safety(repo_path: str) -> list:
    # Ensure safety binary exists
    if not shutil.which("safety"):
        print("safety: executable not found, skipping")
        return []

    # Ensure requirements.txt exists
    req_file = os.path.join(repo_path, "requirements.txt")
    if not os.path.exists(req_file):
        print("safety: no requirements.txt found, skipping")
        return []

    version = _get_safety_version()
    print(f"safety: detected version major={version}")

    env = os.environ.copy()
    env["PYTHONWARNINGS"] = "ignore::DeprecationWarning"

    # Prepare command list based on version
    if version >= 3:
        commands_to_try = [
            ["safety", "scan", "-r", req_file, "--json"],
            ["safety", "check", "-r", req_file, "--json"],
        ]
    else:
        commands_to_try = [
            ["safety", "check", "-r", req_file, "--json"],
        ]

    for cmd in commands_to_try:
        print(f"safety: trying — {' '.join(cmd)}")

        stderr_file = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".txt",
            delete=False,
            encoding="utf-8"
        )
        stderr_path = stderr_file.name
        stderr_file.close()

        try:
            with open(stderr_path, "w", encoding="utf-8") as err_fh:
                result = subprocess.run(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=err_fh,
                    text=True,
                    timeout=120,
                    env=env,
                )

            output = result.stdout or ""

            with open(stderr_path, "r", encoding="utf-8", errors="replace") as f:
                stderr = f.read()

        except subprocess.TimeoutExpired:
            print("safety: scan timed out")
            return []
        except Exception as e:
            print(f"safety: execution failed — {e}")
            return []
        finally:
            try:
                os.unlink(stderr_path)
            except Exception:
                pass

        # Always log stderr for debugging
        if stderr.strip():
            print(f"safety: stderr =>\n{stderr}")

        print(f"safety: exit={result.returncode}, stdout_len={len(output)}")

        stderr_lower = stderr.lower()

        # Detect authentication requirement
        if "safety auth login" in stderr_lower or (
            "api key" in stderr_lower and "authentication" in stderr_lower
        ):
            print("safety: authentication required")
            return []

        # Detect known crash (typer conflict)
        if "typer" in stderr_lower and "rich_utils" in stderr_lower:
            print("safety: dependency crash detected (typer conflict)")
            return []

        # Detect generic crash (no stdout + non-zero exit)
        if result.returncode != 0 and not output.strip():
            print("safety: command failed with no output — likely crash")
            continue

        # Parse valid output
        if output.strip():
            print(f"safety: parsing output (v{version})")
            # try v3 first, fallback to v2
            parsed = _parse_v3(output)
            if parsed:
                return parsed

            return _parse_v2(output)

        print("safety: no stdout, trying next command...")

    print("safety: all commands failed or returned no usable output")
    return []