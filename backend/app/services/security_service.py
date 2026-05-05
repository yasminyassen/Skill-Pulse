from __future__ import annotations

from collections import Counter


def normalize_severity(severity: str | None) -> str:
    value = (severity or "MEDIUM").upper()
    if value == "CRITICAL":
        return "HIGH"
    if value in {"HIGH", "MEDIUM", "LOW"}:
        return value
    return "MEDIUM"


def group_findings_by_severity_and_file(findings: list[dict]) -> dict:
    grouped: dict[str, dict[str, list[dict]]] = {
        "HIGH": {},
        "MEDIUM": {},
        "LOW": {},
    }

    for finding in findings:
        sev = normalize_severity(finding.get("severity"))
        file_path = finding.get("file_path") or "unknown"
        entry = {
            "tool": finding.get("tool"),
            "rule": finding.get("rule"),
            "owasp_category": finding.get("owasp_category") or "Unknown",
            "line_number": finding.get("line_number", 0),
            "description": finding.get("description"),
        }
        grouped[sev].setdefault(file_path, []).append(entry)

    return grouped


def compute_security_score(findings: list[dict], total_loc: int = 1000) -> float:
    if not findings:
        return 100.0

    severity_weight = {
        "HIGH": 10,
        "MEDIUM": 5,
        "LOW": 2,
    }

    cwe_weight = {
        "CWE-79": 1.5,
        "CWE-89": 1.8,
        "CWE-94": 2.2,
    }

    penalty = 0.0

    for finding in findings:
        sev = normalize_severity(finding.get("severity"))
        sev_score = severity_weight.get(sev, 5)
        penalty += sev_score * cwe_weight.get(finding.get("cwe"), 1.0)

    density = len(findings) / max(total_loc, 1)
    density_factor = min(2.0, 1 + density * 50)

    unique_files = len(set(finding.get("file_path") for finding in findings))
    repetition_factor = 1 + (len(findings) - unique_files) * 0.05

    final_penalty = penalty * density_factor * repetition_factor
    return round(max(0.0, 100.0 - final_penalty), 2)
