import os
import re
import subprocess
from typing import Any

from app.db.models import User


_NOREPLY_LOGIN_RE = re.compile(r"(?:\d+\+)?([^@]+)@users\.noreply\.github\.com", re.I)


def normalize_path(path: str | None) -> str:
    return (path or "").replace("\\", "/").strip()


def positive_int(value: Any) -> int | None:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _login_from_email(email: str | None) -> str | None:
    if not email:
        return None
    match = _NOREPLY_LOGIN_RE.search(email)
    return match.group(1) if match else None


def _parse_blame_porcelain(output: str) -> list[dict]:
    contributors: dict[tuple[str | None, str | None], dict] = {}
    current: dict[str, str | None] = {"name": None, "email": None, "commit": None}

    for line in output.splitlines():
        if not line:
            continue
        if re.match(r"^\^?[0-9a-f]{40}\s", line):
            current = {"name": None, "email": None, "commit": line.split()[0].lstrip("^")}
            continue
        if line.startswith("author "):
            current["name"] = line[len("author ") :].strip()
        elif line.startswith("author-mail "):
            email = line[len("author-mail ") :].strip().strip("<>")
            current["email"] = email
            key = (current.get("name"), email)
            contributors[key] = {
                "name": current.get("name"),
                "email": email,
                "login": _login_from_email(email),
                "commit": current.get("commit"),
            }

    return list(contributors.values())


def git_blame(repo_path: str, file_path: str, start_line: int, end_line: int) -> list[dict]:
    normalized_path = normalize_path(file_path)
    abs_path = os.path.join(repo_path, normalized_path.replace("/", os.sep))
    if not os.path.isfile(abs_path):
        return []

    try:
        result = subprocess.run(
            [
                "git",
                "blame",
                "--line-porcelain",
                "-L",
                f"{start_line},{end_line}",
                "--",
                normalized_path,
            ],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except Exception:
        return []

    if result.returncode != 0:
        return []
    return _parse_blame_porcelain(result.stdout or "")


def attribute_location(
    repo_path: str,
    file_path: str | None,
    line_number: Any = None,
    start_line: Any = None,
    end_line: Any = None,
) -> dict:
    normalized_path = normalize_path(file_path)
    if not normalized_path or normalized_path == "unknown":
        return {"source": "none", "contributors": []}

    parsed_start = positive_int(start_line)
    parsed_end = positive_int(end_line)
    parsed_line = positive_int(line_number)

    if parsed_start and parsed_end:
        return {
            "source": "range",
            "contributors": git_blame(repo_path, normalized_path, parsed_start, parsed_end),
        }

    if parsed_line:
        return {
            "source": "line",
            "contributors": git_blame(repo_path, normalized_path, parsed_line, parsed_line),
        }

    return {"source": "file", "contributors": []}


def contributor_matches_user(contributor: dict, user: User, contributor_login: str | None = None) -> bool:
    candidates = {
        (contributor_login or "").lower(),
        (user.username or "").lower(),
        (user.work_email or "").lower(),
        (user.full_name or "").lower(),
    }
    observed = {
        str(contributor.get("login") or "").lower(),
        str(contributor.get("email") or "").lower(),
        str(contributor.get("name") or "").lower(),
    }
    return bool(candidates - {""}) and bool((candidates - {""}) & (observed - {""}))


def result_matches_contributor(
    file_path: str | None,
    attribution: dict,
    user: User,
    contributor_login: str | None,
    touched_files: set[str],
) -> bool:
    contributors = attribution.get("contributors") or []
    source = attribution.get("source")

    if source in {"range", "line"} and contributors:
        return any(contributor_matches_user(item, user, contributor_login) for item in contributors)

    return normalize_path(file_path) in touched_files
