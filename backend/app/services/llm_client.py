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
    try:
        return max(1, min(5, int(raw))) if raw else 3
    except ValueError:
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
# Score merging for multi-batch calls
# ---------------------------------------------------------------------------

def _merge_problem_solving(results: List[dict]) -> dict:
    """
    Merge multiple problem_solving result dicts from batched calls.
    Uses confidence-weighted average so higher-confidence results dominate.
    """
    KEYS = ("algorithms", "data_structures", "balanced_complexity", "edge_cases")
    merged = {}
    for key in KEYS:
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
    SKILLS = ("code_quality", "maintainability", "architecture")
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

    logger.warning("Could not extract JSON from LLM response: %r", text[:300])
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
                "Return JSON with keys: code_quality, maintainability, architecture. "
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
                    "You are a code reviewer calibrating existing rule-based scores.\n\n"
                    "Inputs:\n"
                    "- base_scores: deterministic metric-based scores.\n"
                    "- aggregate_metrics: objective signals.\n"
                    "- files: actual code snippets. Files marked [SUMMARY of ...] are structural outlines.\n\n"
                    "Read ALL provided files. Base reasoning only on visible code patterns.\n\n"
                    "Return ONLY valid JSON with this exact structure:\n\n"
                    "{\n"
                    "  \"code_quality\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"},\n"
                    "  \"maintainability\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"},\n"
                    "  \"architecture\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"}\n"
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
                    "Skill guidelines:\n"
                    "Code Quality: code smells, duplication, naming/style only. NO security.\n"
                    "Maintainability: docstrings, test signals, readability, function size.\n"
                    "Architecture: separation of concerns, coupling, layering.\n\n"
                    "STRICT: Do NOT evaluate security issues at all.\n\n"
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
        "temperature": 0.2,
    }
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    jr = _post_with_retry(f"{url.rstrip('/')}/chat/completions", body, headers=headers, max_retries=2)
    return _extract_openrouter_resp(jr)


def _is_valid_problem_solving(resp: dict) -> bool:
    KEYS = {"algorithms", "data_structures", "balanced_complexity", "edge_cases"}
    if not resp or not KEYS.issubset(resp.keys()):
        return False
    return all(isinstance((resp[k] or {}).get("score"), (int, float)) for k in KEYS)


def _is_valid_skill_scores(resp: dict) -> bool:
    SKILLS = {"code_quality", "maintainability", "architecture"}
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

            if _is_valid_problem_solving(resp):
                logger.info("problem_solving %s batch succeeded on attempt %d", batch_label, attempt)
                break

            missing = {"algorithms", "data_structures", "balanced_complexity", "edge_cases"} - set(resp.keys())
            logger.warning(
                "problem_solving %s attempt %d/%d: invalid response, missing=%s",
                batch_label, attempt, max_retries, missing,
            )
            resp = {}
            if attempt < max_retries:
                time.sleep(2 ** (attempt - 1))

        if resp:
            batch_results.append(resp)

    merged = _merge_problem_solving(batch_results) if batch_results else {}

    out: Dict[str, Any] = {"generated_at": int(time.time())}
    for key_sig in ("algorithms", "data_structures", "balanced_complexity", "edge_cases"):
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

            missing = {"code_quality", "maintainability", "architecture"} - set(resp.keys())
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
    for skill in ("code_quality", "maintainability", "architecture"):
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