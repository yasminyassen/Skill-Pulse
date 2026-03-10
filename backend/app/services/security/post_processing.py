from collections import defaultdict


SEVERITY_MAP = {
    "LOW": 1,
    "MEDIUM": 2,
    "HIGH": 3,
    "CRITICAL": 4
}


def normalize_severity(severity):

    if not severity:
        return "MEDIUM"

    s = severity.upper()

    if s in SEVERITY_MAP:
        return s

    if "ERROR" in s:
        return "HIGH"

    return "MEDIUM"


def deduplicate_findings(findings):

    grouped = defaultdict(list)

    for f in findings:

        key = (
            f.get("file_path"),
            f.get("line_number") or 0,
            f.get("rule")
        )

        grouped[key].append(f)

    deduped = []

    for key, group in grouped.items():

        base = group[0]

        tools = [g["tool"] for g in group]

        severities = [normalize_severity(g["severity"]) for g in group]

        highest = max(severities, key=lambda x: SEVERITY_MAP[x])

        base["severity"] = highest
        base["tools_detected"] = tools
        base["confidence"] = "HIGH" if len(tools) > 1 else "MEDIUM"

        deduped.append(base)

    return deduped