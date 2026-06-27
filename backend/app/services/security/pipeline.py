import json
import multiprocessing
import os
import shutil
import subprocess
import tempfile
import time

from app.services.security.bandit_scan import run_bandit
from app.services.security.gitleaks_scan import run_gitleaks
from app.services.security.post_processing import deduplicate_findings
from app.services.security.safety_scan import run_safety
from app.services.security.semgrep_scan import run_semgrep


SCANNER_TIMEOUT_SECONDS = {
    "bandit": 180,
    "semgrep": 360,
    "safety": 240,
    "gitleaks": 180,
}

ALWAYS_GENERATED_SECURITY_ARTIFACTS = {
    "gitleaks-report.json",
}


def _normalize_generated_artifacts(generated_artifacts: list[str] | None = None) -> set[str]:
    return {
        str(path or "").replace("\\", "/").strip().lstrip("/")
        for path in (generated_artifacts or [])
        if str(path or "").strip()
    }


def _is_generated_security_artifact(
    path: str | None,
    generated_artifacts: list[str] | set[str] | None = None,
) -> bool:
    normalized = (path or "").replace("\\", "/").strip().lstrip("/")
    if not normalized:
        return False
    explicit_artifacts = (
        generated_artifacts
        if isinstance(generated_artifacts, set)
        else _normalize_generated_artifacts(generated_artifacts)
    )
    return (
        normalized in ALWAYS_GENERATED_SECURITY_ARTIFACTS
        or normalized in explicit_artifacts
        or normalized.startswith(".scannerwork/")
    )


def _scanner_worker(scanner, repo_path, result_path):
    try:
        payload = {"status": "ok", "results": scanner(repo_path), "error": None}
    except BaseException as exc:
        payload = {"status": "error", "results": None, "error": f"{type(exc).__name__}: {exc}"}

    with open(result_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh)


def _terminate_process_tree(process: multiprocessing.Process) -> None:
    if not process.is_alive():
        return

    pid = process.pid
    if pid and os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            capture_output=True,
            text=True,
            timeout=20,
        )
        process.join(timeout=2)
    else:
        process.terminate()
        process.join(timeout=5)

    if process.is_alive():
        process.kill()
        process.join(timeout=5)


def _normalize_finding(f: dict) -> dict:
    line_number = f.get("line_number")
    start_line = f.get("start_line")
    end_line = f.get("end_line")
    if line_number is None and start_line is not None and start_line == end_line:
        line_number = start_line

    start_column = f.get("start_column")
    end_column = f.get("end_column")

    return {
        "tool": str(f.get("tool") or "unknown"),
        "rule": str(f.get("rule") or "unknown"),
        "file_path": (f.get("file_path") or "unknown").replace("\\", "/"),
        "severity": (f.get("severity") or "MEDIUM").upper(),
        "description": str(f.get("description") or ""),
        "line_number": int(line_number or 0),
        "start_line": int(start_line) if start_line is not None else None,
        "end_line": int(end_line) if end_line is not None else None,
        "start_column": int(start_column) if start_column is not None else None,
        "end_column": int(end_column) if end_column is not None else None,
        "cwe": f.get("cwe") or "CWE-703",
        "owasp_category": f.get("owasp_category") or "A10",
        "package_name": f.get("package_name"),
        "package_version": f.get("package_version"),
        "manifest_file": (f.get("manifest_file") or "").replace("\\", "/") or None,
        "vulnerability_id": f.get("vulnerability_id"),
        "advisory_id": f.get("advisory_id"),
        "raw_metadata": f.get("raw_metadata"),
    }


def _safe_relative_file(path: str) -> str | None:
    normalized = (path or "").replace("\\", "/").lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized:
        return None
    return normalized


def _build_scoped_scan_root(
    repo_path: str,
    include_files: list[str] | None,
    generated_artifacts: set[str] | None = None,
):
    if include_files is None:
        return repo_path, None, None

    temp_dir = tempfile.TemporaryDirectory(prefix="security_scope_")
    scan_root = temp_dir.name
    copied_files: list[str] = []

    for item in include_files:
        rel_path = _safe_relative_file(item)
        if not rel_path:
            continue
        if _is_generated_security_artifact(rel_path, generated_artifacts):
            continue
        source = os.path.join(repo_path, rel_path.replace("/", os.sep))
        if not os.path.isfile(source):
            continue
        destination = os.path.join(scan_root, rel_path.replace("/", os.sep))
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        shutil.copy2(source, destination)
        copied_files.append(rel_path)

    return scan_root, temp_dir, copied_files


def run_security_analysis(
    repo_path,
    include_files: list[str] | None = None,
    generated_artifacts: list[str] | None = None,
):
    generated_artifact_set = _normalize_generated_artifacts(generated_artifacts)
    scan_root, scoped_context, copied_files = _build_scoped_scan_root(
        repo_path,
        include_files,
        generated_artifact_set,
    )
    if copied_files is not None:
        print(
            "security pipeline scoped scan: "
            f"requested_files={len(include_files or [])}, copied_files={len(copied_files)}"
        )
        if not copied_files:
            scoped_context.cleanup()
            return {"findings": [], "failed_tools": []}

    scanners = {
        "bandit": run_bandit,
        "semgrep": run_semgrep,
        "safety": run_safety,
        "gitleaks": run_gitleaks,
    }

    findings = []
    failed_tools = []
    raw_counts = {}
    running = {}

    for name, scanner in scanners.items():
        result_file = tempfile.NamedTemporaryFile(
            mode="w",
            suffix=f".{name}.json",
            delete=False,
            encoding="utf-8",
        )
        result_path = result_file.name
        result_file.close()
        process = multiprocessing.Process(
            target=_scanner_worker,
            args=(scanner, scan_root, result_path),
            name=f"security-scanner-{name}",
        )
        process.start()
        running[name] = {
            "process": process,
            "result_path": result_path,
            "started_at": time.monotonic(),
            "timeout": SCANNER_TIMEOUT_SECONDS.get(name, 300),
        }

    while running:
        for tool_name, state in list(running.items()):
            process = state["process"]
            result_path = state["result_path"]
            elapsed = time.monotonic() - state["started_at"]

            if not process.is_alive():
                process.join(timeout=1)
                try:
                    with open(result_path, "r", encoding="utf-8") as fh:
                        payload = json.load(fh)
                    status = payload.get("status")
                    results = payload.get("results")
                    error = payload.get("error")
                except Exception:
                    status, results, error = "error", None, f"{tool_name} exited without returning results"
                finally:
                    try:
                        os.unlink(result_path)
                    except Exception:
                        pass

                if status == "ok":
                    raw_counts[tool_name] = len(results or [])
                    if results:
                        normalized = [_normalize_finding(f) for f in results]
                        findings.extend(normalized)
                        print(
                            f"{tool_name} completed with {len(results)} raw findings, "
                            f"{len(normalized)} normalized findings"
                        )
                    else:
                        print(f"{tool_name} completed with 0 findings")
                else:
                    print(f"{tool_name} failed: {error}")
                    failed_tools.append(tool_name)
                    raw_counts[tool_name] = None

                running.pop(tool_name)
                continue

            if elapsed > state["timeout"]:
                print(f"{tool_name} timed out after {state['timeout']} seconds; terminating scanner")
                _terminate_process_tree(process)
                try:
                    os.unlink(result_path)
                except Exception:
                    pass
                failed_tools.append(tool_name)
                raw_counts[tool_name] = None
                running.pop(tool_name)

        if running:
            time.sleep(0.5)

    before_artifact_filter = len(findings)
    findings = [
        finding for finding in findings
        if not _is_generated_security_artifact(finding.get("file_path"), generated_artifact_set)
        and not _is_generated_security_artifact(finding.get("manifest_file"), generated_artifact_set)
    ]
    filtered_artifacts = before_artifact_filter - len(findings)
    before_dedup = len(findings)
    findings = deduplicate_findings(findings)
    print(
        "security pipeline summary: "
        f"raw_counts={raw_counts}, normalized_total={before_dedup}, "
        f"generated_artifacts_filtered={filtered_artifacts}, "
        f"deduped_total={len(findings)}, failed_tools={failed_tools}"
    )

    if scoped_context is not None:
        scoped_context.cleanup()

    return {"findings": findings, "failed_tools": failed_tools}
