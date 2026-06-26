import subprocess
import json
import os
import shutil
import tempfile

from app.core.security_mapping import CWE_TO_OWASP

CWE = "CWE-1104"


def _requirement_line(file_path: str, package_name: str | None) -> int | None:
    if not package_name:
        return None
    normalized_package = package_name.lower().replace("_", "-")
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
            for idx, line in enumerate(fh, start=1):
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                candidate = stripped.split("#", 1)[0].strip()
                for separator in ("==", ">=", "<=", "~=", "!=", ">", "<", "["):
                    candidate = candidate.split(separator, 1)[0].strip()
                if candidate.lower().replace("_", "-") == normalized_package:
                    return idx
    except OSError:
        return None
    return None


def _first_present(data: dict, keys: tuple[str, ...]):
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


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


def _parse_v2(output: str, file_path: str, abs_file_path: str) -> list:
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
                            package_name = str(vuln[0]) if len(vuln) > 0 and vuln[0] else None
                            package_version = str(vuln[2]) if len(vuln) > 2 and vuln[2] else None
                            vulnerability_id = str(vuln[4]) if len(vuln) > 4 and vuln[4] else ""
                            line_number = _requirement_line(abs_file_path, package_name)
                            findings.append({
                                "tool": "safety",
                                "rule": vulnerability_id,
                                "file_path": file_path,
                                "severity": "HIGH",
                                "description": vuln[3],
                                "line_number": line_number or 0,
                                "cwe": CWE,
                                "owasp_category": CWE_TO_OWASP.get(CWE),
                                "package_name": package_name,
                                "package_version": package_version,
                                "manifest_file": file_path,
                                "vulnerability_id": vulnerability_id,
                                "raw_metadata": {"safety_entry": vuln},
                            })

                idx += end
            except Exception:
                idx += 1

    except Exception as e:
        print(f"safety parse v2 failed (final): {e}")

    return findings


def _parse_v3(output: str, file_path: str, abs_file_path: str) -> list:
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
            package_name = _first_present(
                vuln,
                ("package_name", "package", "name", "dependency_name"),
            )
            package_version = _first_present(
                vuln,
                ("analyzed_version", "installed_version", "package_version", "version"),
            )
            vulnerability_id = str(vuln.get("vulnerability_id") or vuln.get("id") or "")
            advisory_id = _first_present(vuln, ("advisory_id", "CVE", "cve", "cve_id"))
            line_number = _requirement_line(abs_file_path, str(package_name) if package_name else None)
            findings.append({
                "tool": "safety",
                "rule": vulnerability_id,
                "file_path": file_path,
                "severity": "HIGH",
                "description": vuln.get("advisory") or vuln.get("description") or "",
                "line_number": line_number or 0,
                "cwe": CWE,
                "owasp_category": CWE_TO_OWASP.get(CWE),
                "package_name": str(package_name) if package_name else None,
                "package_version": str(package_version) if package_version else None,
                "manifest_file": file_path,
                "vulnerability_id": vulnerability_id,
                "advisory_id": str(advisory_id) if advisory_id else None,
                "raw_metadata": vuln,
            })

    except Exception as e:
        print(f"safety parse v3 failed (robust): {e}")

    return findings


def _find_requirement_files(repo_path: str) -> list[tuple[str, str]]:
    ignored_dirs = {"venv", ".venv", "__pycache__", "node_modules", ".git"}
    requirement_files: list[tuple[str, str]] = []

    for root, dirs, files in os.walk(repo_path):
        dirs[:] = [d for d in dirs if d not in ignored_dirs]

        for name in files:
            lower_name = name.lower()
            if lower_name == "requirements.txt" or (
                lower_name.startswith("requirements-") and lower_name.endswith(".txt")
            ):
                abs_path = os.path.join(root, name)
                rel_path = os.path.relpath(abs_path, repo_path).replace("\\", "/")
                requirement_files.append((abs_path, rel_path))

    return sorted(requirement_files, key=lambda item: item[1])


def run_safety(repo_path: str) -> list:
    # Ensure safety binary exists
    if not shutil.which("safety"):
        print("safety: executable not found, skipping")
        return []

    requirement_files = _find_requirement_files(repo_path)
    if not requirement_files:
        print("safety: no requirements.txt found, skipping")
        return []

    version = _get_safety_version()
    print(f"safety: detected version major={version}")
    print(
        "safety: requirement files found => "
        + ", ".join(rel_path for _, rel_path in requirement_files)
    )

    env = os.environ.copy()
    env["PYTHONWARNINGS"] = "ignore::DeprecationWarning"

    all_findings = []

    for req_file, rel_path in requirement_files:
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

        parsed_for_file = []

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
                print(f"safety: scan timed out for {rel_path}")
                break
            except Exception as e:
                print(f"safety: execution failed for {rel_path} — {e}")
                break
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
                return all_findings

            # Detect known crash (typer conflict)
            if "typer" in stderr_lower and "rich_utils" in stderr_lower:
                print("safety: dependency crash detected (typer conflict)")
                break

            # Detect generic crash (no stdout + non-zero exit)
            if result.returncode != 0 and not output.strip():
                print("safety: command failed with no output — likely crash")
                continue

            # Parse valid output
            if output.strip():
                print(f"safety: parsing output (v{version}) for {rel_path}")
                # try v3 first, fallback to v2
                parsed_for_file = _parse_v3(output, rel_path, req_file)
                if not parsed_for_file:
                    parsed_for_file = _parse_v2(output, rel_path, req_file)
                break

            print("safety: no stdout, trying next command...")

        all_findings.extend(parsed_for_file)
        print(f"safety: parsed findings for {rel_path} => {len(parsed_for_file)}")

    if not all_findings:
        print("safety: all commands failed or returned no usable output")
    else:
        print(f"safety: total parsed findings={len(all_findings)}")

    return all_findings
