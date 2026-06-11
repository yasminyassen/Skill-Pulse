import os
import json
import re
import httpx
import logging
import time
from typing import List, Dict, Any, Tuple

logger = logging.getLogger(__name__)


class LLMError(Exception):
    pass


# ---------------------------------------------------------------------------
# Config helpers
# ---------------------------------------------------------------------------

def _get_env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def _openrouter_config():
    url = _get_env("OPENROUTER_API_URL", "OPENROUTER_API", "openrouter_api_url") or "https://api.openrouter.ai/v1"
    key = _get_env("OPENROUTER_API_KEY", "openrouter_api_key", "OPENROUTER_KEY")
    model = _get_env("OPENROUTER_MODEL", "openrouter_model")
    if not key or not model:
        raise LLMError("OPENROUTER_API_KEY and OPENROUTER_MODEL must be set to use OpenRouter")
    return url, key, model


def _ollama_config():
    url = _get_env("OLLAMA_BASE_URL", "ollama_base_url")
    model = _get_env("OLLAMA_MODEL", "ollama_model")
    if not url or not model:
        raise LLMError("OLLAMA_BASE_URL and OLLAMA_MODEL must be set to use Ollama")
    return url, model


def _llm_timeout() -> httpx.Timeout:
    raw = _get_env("LLM_TIMEOUT_SECONDS", "llm_timeout_seconds")
    try:
        seconds = float(raw) if raw else 60.0
    except ValueError:
        seconds = 60.0
    return httpx.Timeout(max(5.0, min(300.0, seconds)))


def _max_retries() -> int:
    raw = _get_env("LLM_MAX_RETRIES", "llm_max_retries")
    if raw:
        try:
            return max(1, min(5, int(raw)))
        except ValueError:
            pass
    try:
        from app.core.config import settings
        return max(1, min(5, int(settings.llm_max_retries)))
    except Exception:
        return 3


def _model_context_limit() -> int:
    """Token limit for the model. Set LLM_CONTEXT_LIMIT in env to match your model."""
    raw = _get_env("LLM_CONTEXT_LIMIT", "llm_context_limit")
    try:
        return max(4_000, int(raw)) if raw else 26_000
    except ValueError:
        return 26_000


# Rough chars-per-token ratio for code/JSON (conservative)
_CHARS_PER_TOKEN = 3
# Tokens reserved for system prompt + instruction text + JSON response
_PROMPT_OVERHEAD_TOKENS = 4_000


def _payload_char_budget() -> int:
    """Total chars we can spend on file content (across all files in one call)."""
    available_tokens = _model_context_limit() - _PROMPT_OVERHEAD_TOKENS
    return max(2_000, available_tokens * _CHARS_PER_TOKEN)


# ---------------------------------------------------------------------------
# File prioritization and smart payload building
# ---------------------------------------------------------------------------

# Extensions that are pure boilerplate / not worth full content
_LOW_VALUE_EXTENSIONS = {
    ".md", ".txt", ".rst", ".json", ".yaml", ".yml", ".toml", ".cfg",
    ".ini", ".env", ".lock", ".sum", ".mod", ".gitignore", ".dockerignore",
    ".csv", ".xml", ".html", ".css", ".scss", ".svg", ".png", ".jpg",
    ".jpeg", ".gif", ".ico", ".woff", ".woff2", ".ttf", ".eot",
}

# Path fragments that strongly indicate generated/vendor/boilerplate
_LOW_VALUE_PATH_FRAGMENTS = (
    "node_modules/", "vendor/", ".git/", "dist/", "build/", "__pycache__/",
    "migrations/", "static/", "assets/", "fixtures/", "generated/",
    "setup.py", "setup.cfg", "conftest.py", "manage.py", "wsgi.py", "asgi.py",
    "requirements", "package.json", "package-lock", "yarn.lock",
)


def _file_priority_score(path: str, content: str) -> int:
    """
    Higher score = more important to include with full content.
    Combines file type, path signals, and content complexity signals.
    """
    path_lower = (path or "").lower()
    ext = "." + path_lower.rsplit(".", 1)[-1] if "." in path_lower else ""

    # Immediate deprioritize: boilerplate extensions
    if ext in _LOW_VALUE_EXTENSIONS:
        return 0

    # Deprioritize by path patterns
    if any(frag in path_lower for frag in _LOW_VALUE_PATH_FRAGMENTS):
        return 5

    score = 50  # base

    # Boost for main source extensions
    if ext in {".py", ".js", ".ts", ".go", ".java", ".cs", ".cpp", ".c", ".rs", ".rb", ".php", ".kt", ".swift"}:
        score += 30

    lines = content.splitlines() if content else []
    loc = len(lines)

    # Boost for files with meaningful size
    if 20 <= loc <= 500:
        score += 20
    elif loc > 500:
        score += 10

    # Boost for complexity signals in content
    complexity_keywords = (
        "class ", "def ", "function ", "async ", "await ",
        "algorithm", "cache", "queue", "stack", "tree", "graph",
        "sort", "search", "parse", "validate", "compute", "process",
        "raise ", "except ", "try:", "finally:",
    )
    keyword_hits = sum(1 for kw in complexity_keywords if kw in content)
    score += min(keyword_hits * 3, 30)

    # Slight deprioritize for test files (still useful but not primary logic)
    if any(t in path_lower for t in ("test", "spec", "mock", "fixture")):
        score -= 15

    return max(0, score)


def _make_structural_summary(path: str, content: str) -> str:
    """
    For files that don't fit as full snippets, extract a compact structural
    summary: class names, function signatures, key imports.
    Much smaller than the full file but preserves architectural signal.
    """
    lines = (content or "").splitlines()
    summary_lines = []

    for line in lines:
        stripped = line.strip()
        if any(stripped.startswith(kw) for kw in (
            "class ", "def ", "async def ", "function ", "const ", "let ", "var ",
            "import ", "from ", "export ", "module ", "interface ", "type ",
            "struct ", "enum ", "fn ", "pub fn ", "pub struct ", "pub enum ",
            "@", "//", "#!",
        )):
            summary_lines.append(line)

    if not summary_lines:
        return f"[{path}: {len(lines)} lines, no extractable structure]"

    summary = "\n".join(summary_lines[:60])  # cap at 60 structural lines
    return f"[SUMMARY of {path} ({len(lines)} lines total)]\n{summary}"


def _build_smart_payload(
    raw_files: List[Dict[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Given all files, returns (primary_batch, overflow_batch).

    primary_batch: files that fit within the token budget.
      - High-priority files included with full content.
      - Files that don't fit get structural summaries (signatures only).
      - Boilerplate (configs, lockfiles, assets) dropped entirely.

    overflow_batch: high-priority files deferred because even their summary
      didn't fit. A second LLM call is made for these and results are merged.

    This ensures we NEVER blindly truncate mid-file. Every file is either:
      - Included fully           (high priority, fits in budget)
      - Included as a summary    (medium/high priority, full didn't fit)
      - Deferred to batch 2      (high priority, summary also didn't fit)
      - Dropped entirely         (low priority boilerplate)
    """
    budget = _payload_char_budget()

    # Score and sort all files highest-priority first
    scored = []
    for f in raw_files:
        content = f.get("snippet", "")
        priority = _file_priority_score(f.get("path", ""), content)
        scored.append((priority, f, content))
    scored.sort(key=lambda x: x[0], reverse=True)

    primary: List[Dict[str, Any]] = []
    overflow: List[Dict[str, Any]] = []
    used_chars = 0

    for priority, f, content in scored:
        if priority == 0:
            continue  # drop boilerplate entirely

        path = f.get("path", "")

        if used_chars + len(content) <= budget:
            # Full content fits — include as-is
            primary.append({"path": path, "snippet": content, "_included": "full"})
            used_chars += len(content)
        else:
            # Full doesn't fit — try a structural summary
            summary = _make_structural_summary(path, content)
            if used_chars + len(summary) <= budget:
                primary.append({"path": path, "snippet": summary, "_included": "summary"})
                used_chars += len(summary)
            elif priority >= 50:
                # High-priority file that can't even fit a summary — defer
                overflow.append({"path": path, "snippet": content, "_included": "full"})

    included_full = sum(1 for f in primary if f.get("_included") == "full")
    included_summary = sum(1 for f in primary if f.get("_included") == "summary")
    logger.info(
        "Payload built: %d full + %d summaries in primary batch, %d deferred to overflow. "
        "Budget used: %d/%d chars (~%d/%d tokens)",
        included_full, included_summary, len(overflow),
        used_chars, budget,
        used_chars // _CHARS_PER_TOKEN, budget // _CHARS_PER_TOKEN,
    )

    # Strip internal metadata key before sending to LLM
    clean_primary = [{"path": f["path"], "snippet": f["snippet"]} for f in primary]
    clean_overflow = [{"path": f["path"], "snippet": f["snippet"]} for f in overflow]
    return clean_primary, clean_overflow


# ---------------------------------------------------------------------------
# Problem-solving response normalization
# ---------------------------------------------------------------------------

PROBLEM_SOLVING_KEYS = ("algorithms", "data_structures", "balanced_complexity", "edge_cases")

_PROBLEM_SOLVING_KEY_ALIASES = {
    "edgeCases": "edge_cases",
    "balancedComplexity": "balanced_complexity",
    "dataStructures": "data_structures",
}


def _canonicalize_problem_solving_keys(resp: dict) -> dict:
    """Map common camelCase aliases to the expected snake_case keys."""
    if not isinstance(resp, dict):
        return {}
    out = dict(resp)
    for alias, canonical in _PROBLEM_SOLVING_KEY_ALIASES.items():
        if alias in out and canonical not in out:
            out[canonical] = out[alias]
    return out


def _coerce_problem_solving_response(resp: dict) -> Tuple[dict, bool, set[str]]:
    """
    Normalize LLM output to all required keys.

    Missing keys are inferred from the average score of present keys with
    reduced confidence so a truncated or partial JSON payload can still be used.
    Returns (normalized_dict, had_any_valid_score, inferred_keys).
    """
    resp = _canonicalize_problem_solving_keys(resp)
    if not resp:
        return {}, False, set()

    present_scores: list[float] = []
    normalized: dict[str, dict] = {}
    inferred_keys: set[str] = set()

    for key in PROBLEM_SOLVING_KEYS:
        entry = resp.get(key)
        if not isinstance(entry, dict):
            continue
        score = entry.get("score")
        if not isinstance(score, (int, float)):
            continue
        present_scores.append(float(score))
        try:
            confidence = float(entry.get("confidence", 0.5) or 0.5)
        except (TypeError, ValueError):
            confidence = 0.5
        evidence = entry.get("evidence")
        normalized[key] = {
            "score": round(max(0.0, min(100.0, float(score))), 2),
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "evidence": evidence if isinstance(evidence, list) else [],
        }

    if not present_scores:
        return {}, False, set()

    fallback_score = sum(present_scores) / len(present_scores)
    for key in PROBLEM_SOLVING_KEYS:
        if key in normalized:
            continue
        normalized[key] = {
            "score": round(fallback_score, 2),
            "confidence": 0.25,
            "evidence": [],
        }
        inferred_keys.add(key)
        logger.info(
            "problem_solving: inferred missing key=%s from avg=%.2f",
            key,
            fallback_score,
        )

    return normalized, True, inferred_keys


# ---------------------------------------------------------------------------
# Score merging for multi-batch calls
# ---------------------------------------------------------------------------

def _merge_problem_solving(results: List[dict]) -> dict:
    """
    Merge multiple problem_solving result dicts from batched calls.
    Uses confidence-weighted average so higher-confidence results dominate.
    """
    merged = {}
    for key in PROBLEM_SOLVING_KEYS:
        total_weight = 0.0
        weighted_score = 0.0
        all_evidence = []
        for r in results:
            entry = (r or {}).get(key) or {}
            score = float(entry.get("score", 0.0) or 0.0)
            confidence = float(entry.get("confidence", 0.0) or 0.0)
            evidence = entry.get("evidence", [])
            weight = max(confidence, 0.01)  # avoid zero-weight
            weighted_score += score * weight
            total_weight += weight
            all_evidence.extend(evidence)
        merged[key] = {
            "score": round(max(0.0, min(100.0, weighted_score / total_weight)), 2),
            "confidence": round(min(1.0, total_weight / len(results)), 3),
            "evidence": list(dict.fromkeys(all_evidence)),  # deduplicate, preserve order
        }
    return merged


def _merge_skill_scores(results: List[dict]) -> dict:
    """
    Merge multiple skill_score adjustment dicts from batched calls.
    Uses confidence-weighted average.
    """
    SKILLS = ("code_quality", "maintainability")
    merged = {}
    for skill in SKILLS:
        total_weight = 0.0
        weighted_adj = 0.0
        reasons = []
        for r in results:
            entry = (r or {}).get(skill) or {}
            adj = float(entry.get("adjustment", 0.0) or 0.0)
            confidence = float(entry.get("confidence", 0.0) or 0.0)
            reason = entry.get("reason", "")
            weight = max(confidence, 0.01)
            weighted_adj += adj * weight
            total_weight += weight
            if reason:
                reasons.append(reason)
        merged[skill] = {
            "adjustment": round(max(-20.0, min(20.0, weighted_adj / total_weight)), 2),
            "confidence": round(min(1.0, total_weight / len(results)), 3),
            "reason": " | ".join(reasons) if reasons else "",
        }
    return merged


# ---------------------------------------------------------------------------
# JSON extraction
# ---------------------------------------------------------------------------

def try_repair_truncated_json(text: str) -> dict:
    import re, json
    partial = {}
    for key in ("algorithms", "data_structures", "balanced_complexity", "edge_cases"):
        block_match = re.search(
            rf'"{key}"\s*:\s*(\{{[^{{}}]*\}})', text, re.DOTALL
        )
        if block_match:
            try:
                partial[key] = json.loads(block_match.group(1))
            except Exception:
                pass
    return partial

def _extract_json_payload(text: str) -> dict:
    if not text or not text.strip():
        logger.warning("LLM returned empty text, nothing to parse")
        return {}

    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except Exception:
        pass

    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence_match:
        try:
            result = json.loads(fence_match.group(1).strip())
            if isinstance(result, dict):
                return result
        except Exception:
            pass

    # Balanced-brace extraction
    start = text.find("{")
    if start != -1:
        depth = 0
        for i, ch in enumerate(text[start:], start=start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        result = json.loads(text[start: i + 1])
                        if isinstance(result, dict):
                            return result
                    except Exception:
                        break

    # Before giving up, attempt repair
    repaired = try_repair_truncated_json(text)
    if repaired:
        logging.info("Repaired partial JSON, recovered keys: %s", list(repaired.keys()))
        return repaired  # use whatever keys were complete
    logging.warning("JSON repair failed, returning empty dict")
    return {}


# ---------------------------------------------------------------------------
# HTTP helpers with retry
# ---------------------------------------------------------------------------

def _post_with_retry(
    url: str,
    body: dict,
    headers: dict | None = None,
    max_retries: int = 3,
) -> dict:
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            with httpx.Client(timeout=_llm_timeout()) as client:
                r = client.post(url, json=body, headers=headers or {})
                r.raise_for_status()
                return r.json()
        except (httpx.TimeoutException, httpx.NetworkError) as e:
            last_exc = e
            wait = 2 ** (attempt - 1)
            logger.warning("LLM request attempt %d/%d failed (%s), retrying in %ds", attempt, max_retries, e, wait)
            time.sleep(wait)
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (429, 502, 503):
                last_exc = e
                wait = 2 ** (attempt - 1)
                logger.warning("LLM HTTP %d attempt %d/%d, retrying in %ds", e.response.status_code, attempt, max_retries, wait)
                time.sleep(wait)
            else:
                raise LLMError(f"HTTP {e.response.status_code}: {e.response.text[:200]}") from e
        except Exception as e:
            raise LLMError(f"Unexpected error: {e}") from e

    raise LLMError(f"All {max_retries} attempts failed. Last error: {last_exc}")


def _extract_openrouter_resp(jr: dict) -> dict:
    if not isinstance(jr, dict):
        logger.warning("OpenRouter response is not a dict: %r", jr)
        return {}

    if "error" in jr and "choices" not in jr:
        err = jr["error"]
        msg = err.get("message", "") if isinstance(err, dict) else str(err)
        code = err.get("code", "") if isinstance(err, dict) else ""
        msg_lower = msg.lower()
        if any(kw in msg_lower for kw in ("context length", "maximum context", "input tokens", "too long")):
            logger.warning("Context-length error from provider: %s", msg[:300])
        else:
            logger.warning("Provider error (code=%s): %s", code, msg[:200])
        return {}

    choices = jr.get("choices")
    if not choices:
        logger.warning("OpenRouter response has no choices: %r", jr)
        return {}

    message = choices[0].get("message", {})
    text = message.get("content") or choices[0].get("text") or ""

    if not text:
        logger.warning("OpenRouter choice has empty content. Full response: %r", jr)
        return {}

    logger.debug("LLM raw response: %s", text[:500])
    parsed = _extract_json_payload(text)
    if not parsed:
        logger.warning("JSON extraction returned empty dict from text: %r", text[:300])
    return parsed


# ---------------------------------------------------------------------------
# Single-batch LLM call helpers
# ---------------------------------------------------------------------------

def _call_problem_solving_once(
    payload_files: List[Dict[str, Any]],
    ai_mode: str,
    commit_sha: str | None,
) -> dict:
    if ai_mode == "ollama":
        url, model = _ollama_config()
        body = {"model": model, "files": payload_files, "task": "problem_solving_analysis", "commit": commit_sha}
        jr = _post_with_retry(f"{url.rstrip('/')}/llm", body, max_retries=2)
        return jr if isinstance(jr, dict) else {}

    url, key, model = _openrouter_config()
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Return only strict JSON. No markdown. No extra keys."},
            {
                "role": "user",
                "content": (
                    "CRITICAL OUTPUT RULES:\n"
                    "- Return ONLY raw valid JSON. No markdown, no code blocks, no text outside the JSON.\n"
                    "- Each \"evidence\" array must have EXACTLY 2 short strings, each UNDER 15 WORDS.\n"
                    "- Do not elaborate on security issues inside evidence. One short phrase only.\n"
                    "- The JSON object MUST be fully closed and valid before you finish responding.\n\n"
                    "You are evaluating the problem-solving ability demonstrated in code.\n\n"
                    "Analyze the following files and return ONLY a JSON object with this exact structure:\n\n"
                    "{\n"
                    "  \"algorithms\": {\"score\": 0-100, \"confidence\": 0-1, \"evidence\": []},\n"
                    "  \"data_structures\": {\"score\": 0-100, \"confidence\": 0-1, \"evidence\": []},\n"
                    "  \"balanced_complexity\": {\"score\": 0-100, \"confidence\": 0-1, \"evidence\": []},\n"
                    "  \"edge_cases\": {\"score\": 0-100, \"confidence\": 0-1, \"evidence\": []}\n"
                    "}\n\n"
                    "Files marked [SUMMARY of ...] are structural outlines of files that didn't fit fully.\n"
                    "Use them for architectural/pattern signals even though full code is absent.\n\n"
                    "Evaluation criteria:\n"
                    "- Algorithms: non-trivial logic or algorithmic thinking\n"
                    "- Data Structures: proper usage of data structures\n"
                    "- Balanced Complexity: avoids over- or under-engineering\n"
                    "- Edge Cases: handles boundary/unusual cases\n\n"
                    "IMPORTANT:\n"
                    "- Do NOT perform security analysis\n"
                    "- Do NOT list issues\n"
                    "- Do NOT return any keys other than the required JSON\n"
                    "- If evidence is weak, give a LOW score (not zero)\n\n"
                    "Here are the files:\n"
                    f"{json.dumps(payload_files)}"
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 2000,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    jr = _post_with_retry(f"{url.rstrip('/')}/chat/completions", body, headers=headers, max_retries=2)
    return _extract_openrouter_resp(jr)


def _call_skill_scores_once(
    payload_files: List[Dict[str, Any]],
    base_scores: Dict[str, Any],
    aggregate_metrics: Dict[str, Any],
    ai_mode: str,
    commit_sha: str | None,
) -> dict:
    if ai_mode == "ollama":
        url, model = _ollama_config()
        body = {
            "model": model,
            "files": payload_files,
            "task": "skill_score_adjustment",
            "commit": commit_sha,
            "base_scores": base_scores,
            "aggregate_metrics": aggregate_metrics,
            "response_format": "json",
            "instructions": (
                "Return JSON with keys: code_quality, maintainability. "
                "Each value must be an object with: adjustment (-20 to 20), confidence (0-1), reason (string). "
                "Do NOT return full scores. Adjustments must be small; if unsure return 0."
            ),
        }
        jr = _post_with_retry(f"{url.rstrip('/')}/llm", body, max_retries=2)
        return jr if isinstance(jr, dict) else {}

    url, key, model = _openrouter_config()
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Return only strict JSON. No markdown. No extra keys."},
            {
                "role": "user",
                "content": (
                    "CRITICAL OUTPUT RULES:\n"
                    "- Return ONLY raw valid JSON. No markdown, no code blocks, no text outside the JSON.\n"
                    "- Each \"reason\" value must be UNDER 20 WORDS. No long explanations.\n"
                    "- The JSON object MUST be fully closed and valid before you finish responding.\n\n"
                    "You are a code reviewer calibrating existing rule-based scores.\n\n"
                    "Inputs:\n"
                    "- base_scores: deterministic metric-based scores.\n"
                    "- aggregate_metrics: objective signals.\n"
                    "- files: actual code snippets. Files marked [SUMMARY of ...] are structural outlines.\n\n"
                    "Read ALL provided files. Base reasoning only on visible code patterns.\n\n"
                    "Return ONLY valid JSON with this exact structure:\n\n"
                    "{\n"
                    "  \"code_quality\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"},\n"
                    "  \"maintainability\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"}\n"
                    "}\n\n"
                    "Adjustment rules:\n"
                    "- Small and conservative. Minor: -2 to -5; moderate: -5 to -10; major: -10 to -20.\n"
                    "- If unsure, adjustment = 0.\n"
                    "- If base score < 50, avoid large negatives unless critical.\n"
                    "- If base score >= 90 but implementation is trivial, apply -5 to -12.\n\n"
                    "Confidence rules:\n"
                    "- High (>=0.7): clear evidence in multiple files.\n"
                    "- Medium (0.4-0.7): some evidence.\n"
                    "- Low (<0.4): unclear; use adjustment = 0.\n\n"
                    "Skill guidelines (static metrics already computed — judge semantics only):\n"
                    "Code Quality: naming clarity beyond snake_case, duplication severity, dead-code risk, magic numbers.\n"
                    "Maintainability: docstring usefulness, exception hierarchy quality, config isolation, global state risk.\n"
                    "STRICT: Do NOT evaluate security or architecture issues at all.\n\n"
                    "Reason: 1-2 sentences with concrete code patterns. No generic statements.\n\n"
                    "Base scores:\n"
                    f"{json.dumps(base_scores)}\n\n"
                    "Aggregate metrics:\n"
                    f"{json.dumps(aggregate_metrics)}\n\n"
                    "Files:\n"
                    f"{json.dumps(payload_files)}"
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 2000,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    jr = _post_with_retry(f"{url.rstrip('/')}/chat/completions", body, headers=headers, max_retries=2)
    return _extract_openrouter_resp(jr)


def _is_valid_problem_solving(resp: dict) -> bool:
    _, had_valid, _ = _coerce_problem_solving_response(resp)
    return had_valid


def _is_valid_skill_scores(resp: dict) -> bool:
    SKILLS = {"code_quality", "maintainability"}
    if not resp or not SKILLS.issubset(resp.keys()):
        return False
    return all(isinstance((resp[k] or {}).get("adjustment"), (int, float)) for k in SKILLS)


def _is_valid_learning_rank(resp: dict) -> bool:
    if not resp or "ranked" not in resp:
        return False
    ranked = resp.get("ranked")
    if not isinstance(ranked, list):
        return False
    return all(isinstance(item, dict) and item.get("id") for item in ranked)


def _deterministic_learning_rank(payload: dict) -> dict:
    resources = payload.get("resources") if isinstance(payload, dict) else []
    if not isinstance(resources, list):
        resources = []

    def _score(item: dict) -> float:
        try:
            return float(item.get("score", 0.0) or 0.0)
        except Exception:
            return 0.0

    ordered = sorted(
        (r for r in resources if isinstance(r, dict) and r.get("id")),
        key=lambda r: (_score(r), str(r.get("id"))),
        reverse=True,
    )

    return {
        "ranked": [
            {
                "id": r.get("id"),
                "explanation": "Ranked by semantic relevance, quality, and fit.",
            }
            for r in ordered
        ]
    }


def _call_learning_rank_once(payload: dict, ai_mode: str) -> dict:
    if ai_mode == "ollama":
        url, model = _ollama_config()
        body = {
            "model": model,
            "task": "learning_resource_ranking",
            "payload": payload,
            "response_format": "json",
            "instructions": (
                "Return JSON with key 'ranked' containing a list of objects with: "
                "id (string), explanation (string), expected_gain (optional int). "
                "Rank by relevance to issues, quality, and difficulty fit."
            ),
        }
        jr = _post_with_retry(f"{url.rstrip('/')}/llm", body, max_retries=2)
        return jr if isinstance(jr, dict) else {}

    url, key, model = _openrouter_config()
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Return only strict JSON. No markdown. No extra keys."},
            {
                "role": "user",
                "content": (
                    "You are ranking learning resources for a developer based on analysis results.\n\n"
                    "Return ONLY a JSON object with this exact structure:\n\n"
                    "{\n"
                    "  \"ranked\": [\n"
                    "    {\"id\": \"...\", \"explanation\": \"...\", \"expected_gain\": 0-20}\n"
                    "  ]\n"
                    "}\n\n"
                    "Rules:\n"
                    "- Use only resource IDs provided in the input.\n"
                    "- Sort most relevant first.\n"
                    "- Explanation: 1 sentence, concrete, no fluff.\n"
                    "- expected_gain is optional; omit if unsure.\n\n"
                    "Input:\n"
                    f"{json.dumps(payload)}"
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    jr = _post_with_retry(f"{url.rstrip('/')}/chat/completions", body, headers=headers, max_retries=2)
    return _extract_openrouter_resp(jr)


# ---------------------------------------------------------------------------
# Public analysis functions
# ---------------------------------------------------------------------------

def analyze_problem_solving(
    files: List[Dict[str, Any]],
    commit_sha: str | None = None,
) -> Dict[str, Any]:
    """
    Extract problem-solving signals using the configured LLM provider.

    Strategy:
    1. Score and rank all files by relevance (language, size, complexity signals).
    2. Fill primary batch within the token budget:
       - High-priority files get full content first.
       - Files that don't fit get a structural summary (class/def signatures).
       - Boilerplate (configs, lockfiles, assets) is dropped entirely.
    3. High-priority files that couldn't even fit a summary go to an overflow batch.
       A second LLM call is made on the overflow batch and results are merged
       using confidence-weighted averaging.
    4. Each call is retried up to LLM_MAX_RETRIES times on transient errors.
    """
    ai_mode = (os.environ.get("AI_MODE") or "openrouter").lower()
    max_retries = _max_retries()

    # Build raw snippets (300 lines — full content, not pre-truncated)
    raw_files = []
    for f in files:
        snippet = "\n".join((f.get("content", "") or "").splitlines()[:300])
        raw_files.append({"path": f.get("path"), "snippet": snippet})

    primary_batch, overflow_batch = _build_smart_payload(raw_files)

    batch_results = []

    for batch_label, batch in [("primary", primary_batch), ("overflow", overflow_batch)]:
        if not batch:
            continue

        logger.info(
            "Running problem_solving LLM call on %s batch (%d files, ~%d chars)",
            batch_label, len(batch), sum(len(f["snippet"]) for f in batch),
        )
        resp = {}

        for attempt in range(1, max_retries + 1):
            try:
                resp = _call_problem_solving_once(batch, ai_mode, commit_sha)
            except LLMError as e:
                logger.warning("problem_solving %s attempt %d/%d failed: %s", batch_label, attempt, max_retries, e)
                resp = {}

            coerced, valid, inferred_keys = _coerce_problem_solving_response(resp)
            if valid:
                resp = coerced
                if inferred_keys:
                    logger.info(
                        "problem_solving %s batch succeeded on attempt %d with inferred keys=%s",
                        batch_label,
                        attempt,
                        sorted(inferred_keys),
                    )
                else:
                    logger.info("problem_solving %s batch succeeded on attempt %d", batch_label, attempt)
                break

            raw = _canonicalize_problem_solving_keys(resp if isinstance(resp, dict) else {})
            missing = set(PROBLEM_SOLVING_KEYS) - set(raw.keys())
            logger.warning(
                "problem_solving %s attempt %d/%d: invalid response, missing=%s keys=%s",
                batch_label,
                attempt,
                max_retries,
                missing,
                list(raw.keys()),
            )
            resp = {}
            if attempt < max_retries:
                time.sleep(2 ** (attempt - 1))

        if resp:
            batch_results.append(resp)

    merged = _merge_problem_solving(batch_results) if batch_results else {}

    out: Dict[str, Any] = {
        "generated_at": int(time.time()),
        "_llm_valid": bool(batch_results),
    }
    for key_sig in PROBLEM_SOLVING_KEYS:
        val = merged.get(key_sig) or {}
        out[key_sig] = {
            "score": round(max(0.0, min(100.0, float(val.get("score", 0.0) or 0.0))), 2),
            "confidence": round(max(0.0, min(1.0, float(val.get("confidence", 0.0) or 0.0))), 3),
            "evidence": val.get("evidence", []),
        }
    return out


def analyze_skill_scores(
    files: List[Dict[str, Any]],
    base_scores: Dict[str, Any],
    aggregate_metrics: Dict[str, Any],
    commit_sha: str | None = None,
) -> Dict[str, Any]:
    """
    Calibrate AST/rule-based scores using LLM context from code snippets.

    Same smart batching strategy as analyze_problem_solving: file prioritization,
    structural summaries for files that don't fit, optional second call for
    high-priority overflow files, confidence-weighted result merging.
    """
    ai_mode = (os.environ.get("AI_MODE") or "openrouter").lower()
    max_retries = _max_retries()

    raw_files = []
    for f in files:
        snippet = "\n".join((f.get("content", "") or "").splitlines()[:300])
        raw_files.append({"path": f.get("path"), "snippet": snippet})

    primary_batch, overflow_batch = _build_smart_payload(raw_files)

    batch_results = []

    for batch_label, batch in [("primary", primary_batch), ("overflow", overflow_batch)]:
        if not batch:
            continue

        logger.info(
            "Running skill_scores LLM call on %s batch (%d files, ~%d chars)",
            batch_label, len(batch), sum(len(f["snippet"]) for f in batch),
        )
        resp = {}

        for attempt in range(1, max_retries + 1):
            try:
                resp = _call_skill_scores_once(batch, base_scores, aggregate_metrics, ai_mode, commit_sha)
            except LLMError as e:
                logger.warning("skill_scores %s attempt %d/%d failed: %s", batch_label, attempt, max_retries, e)
                resp = {}

            if _is_valid_skill_scores(resp):
                logger.info("skill_scores %s batch succeeded on attempt %d", batch_label, attempt)
                break

            missing = {"code_quality", "maintainability"} - set(resp.keys())
            logger.warning(
                "skill_scores %s attempt %d/%d: invalid response, missing=%s",
                batch_label, attempt, max_retries, missing,
            )
            resp = {}
            if attempt < max_retries:
                time.sleep(2 ** (attempt - 1))

        if resp:
            batch_results.append(resp)

    merged = _merge_skill_scores(batch_results) if batch_results else {}

    out: Dict[str, Any] = {"generated_at": int(time.time())}
    for skill in ("code_quality", "maintainability"):
        entry = merged.get(skill) or {}
        try:
            adjustment = float(entry.get("adjustment", 0.0) or 0.0)
        except Exception:
            adjustment = 0.0
        out[skill] = {
            "adjustment": round(max(-20.0, min(20.0, adjustment)), 2),
            "confidence": round(max(0.0, min(1.0, float(entry.get("confidence", 0.0) or 0.0))), 3),
            "reason": entry.get("reason", ""),
        }
    return out


ARCHITECTURE_LLM_KEYS = (
    "layer_count_srp",
    "repository_pattern",
    "dependency_injection",
    "open_closed_readiness",
    "swappable_components",
    "cohesion",
    "coupling",
    "module_decomposition",
    "god_class_function",
)

_ARCHITECTURE_SCORING_RULES = (
    "SEVERITY-DRIVEN RAW SCORING (you output raw scores only; aggregator decides final):\n"
    "VALID BANDS:\n"
    "- 85-100: Strong architecture with clear evidence\n"
    "- 70-84: Good with minor gaps\n"
    "- 55-69: Partial implementation (score freely in this band)\n"
    "- 35-54: Weak implementation\n"
    "- ≤35: Absent or severely missing\n\n"
    "CAP RULES (aggregator enforces; reflect in your raw score):\n"
    "- CAP1 (≤18): ONLY when ALL THREE: (A) direct instantiation in business logic, "
    "(B) no interfaces/abstractions, (C) no dependency injection\n"
    "- CAP2 (soft ≤35, up to 45 with indirect structural evidence): ONLY when ZERO pattern evidence in codebase\n"
    "- Partial implementation: score 55-80 freely; strong partial up to 85; weak partial 40-60\n\n"
    "FORBIDDEN:\n"
    "- NEVER output 48-52 as neutral/uncertainty\n"
    "- NEVER use 50 as fallback\n"
    "- NEVER let confidence affect your score\n"
    "- Composition roots (container.py, di.py, bootstrap.py, app_factory.py) are valid wiring — NOT violations\n"
    "- If uncertain, score 30 and state missing evidence explicitly\n\n"
)

_ARCHITECTURE_METRIC_INSTRUCTIONS = (
    _ARCHITECTURE_SCORING_RULES +
    "Score each metric 0-100 with confidence 0-1, a brief reason, and evidence (short strings).\n"
    "Focus on design intent and semantic relationships — not syntax counts alone.\n\n"
    "Pure semantic metrics:\n"
    "- layer_count_srp: logical layering, separation of concerns, single-responsibility adherence\n"
    "- repository_pattern: whether data access is abstracted behind repositories/ports, not raw SQL/ORM calls everywhere\n"
    "- dependency_injection: dependencies passed in (constructor/params/protocols) vs constructed inline or imported as globals\n"
    "- open_closed_readiness: can behavior extend via new types/plugins without editing core modules\n"
    "- swappable_components: abstractions (interfaces/protocols) that allow replacing implementations\n"
    "- cohesion: whether code in a module/class/function shares a clear purpose; penalize coincidental grouping "
    "(unrelated helpers, mixed domains, shared globals without logical unity)\n\n"
    "Hybrid metrics (use static_evidence as hints, judge semantics yourself):\n"
    "- coupling: semantic coupling, missing abstractions, cross-layer calls; penalize mixing DB/network/business in one unit\n"
    "- module_decomposition: whether file/package boundaries reflect real domain boundaries, not just file count\n"
    "- god_class_function: classes/functions spanning multiple domains (DB + network + business + formatting); "
    "penalize high complexity that serves unrelated responsibilities\n"
)


def _coerce_architecture_response(resp: dict) -> tuple[dict, bool, set[str]]:
    """Normalize structure only. Missing keys are flagged — aggregator assigns final scores."""
    if not isinstance(resp, dict):
        return {}, False, set()

    present_scores: list[float] = []
    normalized: dict[str, dict] = {}
    for key in ARCHITECTURE_LLM_KEYS:
        entry = resp.get(key)
        if not isinstance(entry, dict):
            continue
        score = entry.get("score")
        if not isinstance(score, (int, float)):
            continue
        try:
            confidence = float(entry.get("confidence", 0.5) or 0.5)
        except (TypeError, ValueError):
            confidence = 0.5
        evidence = entry.get("evidence")
        present_scores.append(float(score))
        normalized[key] = {
            "score": round(max(0.0, min(100.0, float(score))), 2),
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "reason": entry.get("reason", ""),
            "evidence": evidence if isinstance(evidence, list) else [],
        }

    if not present_scores:
        return {}, False, set()

    inferred: set[str] = set()
    for key in ARCHITECTURE_LLM_KEYS:
        if key in normalized:
            continue
        normalized[key] = {
            "score": None,
            "confidence": 0.0,
            "reason": "Missing from LLM response — aggregator will apply uncertain default",
            "evidence": [],
            "_aggregator_missing": True,
        }
        inferred.add(key)
    return normalized, True, inferred


def _is_valid_architecture_metrics(resp: dict) -> bool:
    _, had_valid, _ = _coerce_architecture_response(resp)
    return had_valid


def _call_architecture_metrics_once(
    payload_files: List[Dict[str, Any]],
    static_evidence: Dict[str, Any],
    ai_mode: str,
    commit_sha: str | None,
) -> dict:
    keys_csv = ", ".join(ARCHITECTURE_LLM_KEYS)
    if ai_mode == "ollama":
        url, model = _ollama_config()
        body = {
            "model": model,
            "files": payload_files,
            "task": "architecture_metrics",
            "commit": commit_sha,
            "static_evidence": static_evidence,
            "response_format": "json",
            "instructions": _ARCHITECTURE_METRIC_INSTRUCTIONS,
        }
        jr = _post_with_retry(f"{url.rstrip('/')}/llm", body, max_retries=2)
        return jr if isinstance(jr, dict) else {}

    url, key, model = _openrouter_config()
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Return only strict JSON. No markdown. No extra keys."},
            {
                "role": "user",
                "content": (
                    "You are a senior software architect reviewing Python code for real design quality.\n\n"
                    "CRITICAL RULES:\n"
                    "- Return ONLY raw valid JSON with ALL required keys.\n"
                    "- Each key maps to an object: score (0-100), confidence (0-1), reason (string), evidence (string array).\n"
                    "- Judge semantic design intent, not superficial structure.\n"
                    "- Do NOT reward coincidental cohesion (unrelated code grouped together).\n"
                    "- Do NOT rely only on import counts or class counts.\n"
                    "- NEVER use score 50 as a default or uncertainty value.\n"
                    "- Missing pattern = low score (≤40). Severe violation = very low score (≤20).\n"
                    "- Score and confidence are independent: low confidence still requires low score when pattern is absent.\n\n"
                    f"{_ARCHITECTURE_SCORING_RULES}\n"
                    f"Required keys: {keys_csv}\n\n"
                    f"{_ARCHITECTURE_METRIC_INSTRUCTIONS}\n\n"
                    "Static evidence (AST/tools — contextual hints only, verify against code):\n"
                    f"{json.dumps(static_evidence)}\n\n"
                    "Files:\n"
                    f"{json.dumps(payload_files)}"
                ),
            },
        ],
        "response_format": {"type": "json_object"},
        "max_tokens": 4500,
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    jr = _post_with_retry(f"{url.rstrip('/')}/chat/completions", body, headers=headers, max_retries=2)
    return _extract_openrouter_resp(jr)


def analyze_architecture_metrics(
    files: List[Dict[str, Any]],
    static_evidence: Dict[str, Any],
    commit_sha: str | None = None,
) -> Dict[str, Any]:
    """LLM evaluation for architecture metrics designated as LLM-only."""
    ai_mode = (os.environ.get("AI_MODE") or "openrouter").lower()
    max_retries = _max_retries()

    raw_files = []
    for f in files:
        snippet = "\n".join((f.get("content", "") or "").splitlines()[:300])
        raw_files.append({"path": f.get("path"), "snippet": snippet})

    primary_batch, overflow_batch = _build_smart_payload(raw_files)
    batch_results: list[dict] = []

    for batch_label, batch in [("primary", primary_batch), ("overflow", overflow_batch)]:
        if not batch:
            continue
        resp = {}
        for attempt in range(1, max_retries + 1):
            try:
                resp = _call_architecture_metrics_once(batch, static_evidence, ai_mode, commit_sha)
            except LLMError as exc:
                logger.warning("architecture_metrics %s attempt %d failed: %s", batch_label, attempt, exc)
                resp = {}
            coerced, valid, inferred = _coerce_architecture_response(resp)
            if valid:
                resp = coerced
                if inferred:
                    logger.info(
                        "architecture_metrics %s succeeded with inferred keys=%s",
                        batch_label,
                        sorted(inferred),
                    )
                break
            resp = {}
            if attempt < max_retries:
                time.sleep(2 ** (attempt - 1))
        if resp:
            batch_results.append(resp)

    merged: dict[str, dict] = {}
    for key in ARCHITECTURE_LLM_KEYS:
        batch_scores: list[float] = []
        reasons: list[str] = []
        evidence: list[str] = []
        confidences: list[float] = []
        for resp in batch_results:
            entry = (resp or {}).get(key) or {}
            raw_score = entry.get("score")
            if not isinstance(raw_score, (int, float)):
                continue
            batch_scores.append(float(raw_score))
            confidences.append(float(entry.get("confidence", 0.0) or 0.0))
            if entry.get("reason"):
                reasons.append(str(entry.get("reason")))
            if isinstance(entry.get("evidence"), list):
                evidence.extend(str(item) for item in entry["evidence"])
        if batch_scores:
            merged_score = round(max(0.0, min(100.0, sum(batch_scores) / len(batch_scores))), 2)
            merged_confidence = round(
                max(0.0, min(1.0, sum(confidences) / len(confidences))), 3
            ) if confidences else 0.0
            merged_reason = " | ".join(reasons) if reasons else ""
        else:
            merged_score = None
            merged_confidence = 0.0
            merged_reason = "LLM batch missing metric — aggregator applies uncertain default"
        merged[key] = {
            "score": merged_score,
            "confidence": merged_confidence,
            "reason": merged_reason,
            "evidence": list(dict.fromkeys(evidence)),
        }

    merged["generated_at"] = int(time.time())
    return merged


def rank_learning_resources(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Rank learning resources with LLM guidance and a deterministic fallback.
    """
    if not isinstance(payload, dict):
        return {"ranked": []}

    fallback = _deterministic_learning_rank(payload)
    resources = payload.get("resources")
    if not isinstance(resources, list) or not resources:
        return fallback

    ai_mode = (os.environ.get("AI_MODE") or "openrouter").lower()
    max_retries = _max_retries()

    resp = {}
    for attempt in range(1, max_retries + 1):
        try:
            resp = _call_learning_rank_once(payload, ai_mode)
        except LLMError as exc:
            logger.warning("learning_rank attempt %d/%d failed: %s", attempt, max_retries, exc)
            resp = {}

        if _is_valid_learning_rank(resp):
            return resp

        logger.warning("learning_rank attempt %d/%d returned invalid payload", attempt, max_retries)
        resp = {}
        if attempt < max_retries:
            time.sleep(2 ** (attempt - 1))

    return fallback
