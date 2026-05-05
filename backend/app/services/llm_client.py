import os
import json
import re
import httpx
import logging
from typing import List, Dict, Any
import time


class LLMError(Exception):
    pass


def _get_env(*names: str) -> str | None:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return None


def _extract_json_payload(text: str) -> dict:
    # Best-effort JSON extraction from model responses that include prose.
    try:
        return json.loads(text)
    except Exception:
        pass

    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return {}

    try:
        return json.loads(match.group(0))
    except Exception:
        return {}


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
    seconds = max(5.0, min(300.0, seconds))
    return httpx.Timeout(seconds)


def analyze_problem_solving(files: List[Dict[str, Any]], commit_sha: str | None = None) -> Dict[str, Any]:
    """Extract problem-solving signals using configured LLM provider.

    Supports AI_MODE=openrouter (OpenRouter) or ollama (local Ollama). If AI_MODE is not set
    this function will try OpenRouter first.
    Returns a deterministic structure with numeric scores and confidences.
    """
    ai_mode = (os.environ.get("AI_MODE") or "openrouter").lower()

    # Build payload files (lightweight snippets)
    payload_files = []
    for f in files:
        snippet = "\n".join((f.get("content", "") or "").splitlines()[:200])
        payload_files.append({"path": f.get("path"), "snippet": snippet})

    if ai_mode == "ollama":
        url, model = _ollama_config()
        client = httpx.Client(timeout=_llm_timeout())
        body = {"model": model, "files": payload_files, "task": "problem_solving_analysis", "commit": commit_sha}
        try:
            r = client.post(f"{url.rstrip('/')}/llm", json=body)
            r.raise_for_status()
            resp = r.json()
        except Exception as e:
            raise LLMError(f"Ollama request failed: {e}")

    else:
        # default to OpenRouter
        url, key, model = _openrouter_config()
        client = httpx.Client(timeout=_llm_timeout())
        body = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "Return only strict JSON. No markdown. No extra keys.",
                },
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
        try:
            r = client.post(f"{url.rstrip('/')}/chat/completions", json=body, headers=headers)
            r.raise_for_status()
            jr = r.json()
            # openrouter may wrap text in choices; handle common shapes
            if isinstance(jr, dict) and jr.get("choices"):
                text = jr["choices"][0].get("message", {}).get("content") or jr["choices"][0].get("text")
                if isinstance(text, (bytes, str)):
                    logging.warning(
                        "LLM model=%s files=%s first_snippet_len=%s",
                        model,
                        len(payload_files),
                        len(payload_files[0]["snippet"]) if payload_files else 0,
                    )
                    logging.warning("LLM raw response text: %s", text)
                    resp = _extract_json_payload(text)
                    logging.warning("Parsed JSON keys: %s", list((resp or {}).keys()))
                else:
                    resp = {}
            else:
                resp = jr
        except Exception as e:
            raise LLMError(f"OpenRouter request failed: {e}")

    # Normalize response into deterministic numeric scores
    out = {"generated_at": int(time.time())}
    for key_sig in ("algorithms", "data_structures", "balanced_complexity", "edge_cases"):
        val = (resp or {}).get(key_sig) or {}
        score = float(val.get("score", 0.0) or 0.0)
        confidence = float(val.get("confidence", 0.0) or 0.0)
        evidence = val.get("evidence", [])
        out[key_sig] = {"score": round(max(0.0, min(100.0, score)), 2), "confidence": round(max(0.0, min(1.0, confidence)), 3), "evidence": evidence}

    return out


def analyze_skill_scores(
    files: List[Dict[str, Any]],
    base_scores: Dict[str, Any],
    aggregate_metrics: Dict[str, Any],
    commit_sha: str | None = None,
) -> Dict[str, Any]:
    """Calibrate AST/rule-based scores using LLM context from code snippets.

    Returns a deterministic structure with per-skill scores and confidences.
    """
    ai_mode = (os.environ.get("AI_MODE") or "openrouter").lower()

    payload_files = []
    for f in files:
        snippet = "\n".join((f.get("content", "") or "").splitlines()[:200])
        payload_files.append({"path": f.get("path"), "snippet": snippet})

    request_payload = {
        "task": "skill_score_adjustment",
        "base_scores": base_scores,
        "aggregate_metrics": aggregate_metrics,
        "files": payload_files,
        "commit": commit_sha,
        "response_format": "json",
        "instructions": (
            "Return JSON with keys: code_quality, maintainability, architecture. "
            "Each value must be an object with: adjustment (-20 to 20), confidence (0-1), reason (string). "
            "Do NOT return full scores. Adjustments must be small; if unsure return 0."
        ),
    }

    if ai_mode == "ollama":
        url, model = _ollama_config()
        client = httpx.Client(timeout=_llm_timeout())
        body = {
            "model": model,
            "files": payload_files,
            "task": "skill_score_adjustment",
            "commit": commit_sha,
            "base_scores": base_scores,
            "aggregate_metrics": aggregate_metrics,
            "response_format": "json",
            "instructions": request_payload["instructions"],
        }
        try:
            r = client.post(f"{url.rstrip('/')}/llm", json=body)
            r.raise_for_status()
            resp = r.json()
        except Exception as e:
            raise LLMError(f"Ollama request failed: {e}")
    else:
        url, key, model = _openrouter_config()
        client = httpx.Client(timeout=_llm_timeout())
        # body = {
        #     "model": model,
        #     "messages": [
        #         {
        #             "role": "system",
        #             "content": "Return only strict JSON. No markdown. No extra keys.",
        #         },
        #         {
        #             "role": "user",
        #             "content": (
        #                 "You are a code reviewer. Your job is to calibrate existing rule-based scores, not replace them.\n\n"
        #                 "Inputs:\n"
        #                 "- base_scores are deterministic metric-based scores.\n"
        #                 "- aggregate_metrics contain objective signals.\n"
        #                 "- files contain actual code snippets.\n\n"
        #                 "Read ALL provided files. Base reasoning only on visible code patterns. Do not assume missing features.\n\n"
        #                 "Return ONLY valid JSON with this exact structure:\n\n"
        #                 "{\n"
        #                 "  \"code_quality\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"},\n"
        #                 "  \"maintainability\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"},\n"
        #                 "  \"architecture\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"}\n"
        #                 "}\n\n"
        #                 "Do NOT return full scores. Do NOT add extra fields. Do NOT modify problem_solving.\n\n"
        #                 "Adjustment rules:\n"
        #                 "- Adjustments must be small and conservative.\n"
        #                 "- Minor issue: -2 to -5; moderate: -5 to -10; major: -10 to -20.\n"
        #                 "- Combine issues into a stronger adjustment.\n"
        #                 "- If unsure, adjustment = 0.\n"
        #                 "- If base score < 50, avoid large negatives unless critical.\n"
        #                 "- If base score >= 90 but the implementation is trivial, simplistic, or non-production-ready, consider a negative adjustment (-5 to -15) ONLY if clearly supported by the code.\n\n"
        #                 "Confidence rules:\n"
        #                 "- High (>=0.7) only with clear evidence in multiple files.\n"
        #                 "- Medium (0.4-0.7) with some evidence.\n"
        #                 "- Low (<0.4) when unclear; if low, use adjustment = 0.\n\n"
        #                 "Skill-specific guidelines:\n"
        #                 "Code Quality (ONLY): code smells, unused variables, duplication, naming/style.\n"
        #                 "DO NOT include any security-related evaluation under code quality.\n\n"
        #                 "Maintainability: docstrings/comments, test coverage signals, readability, function size/structure.\n"
        #                 "Architecture: separation of concerns, coupling, clear layering.\n\n"
        #                 "Anti-inflation rules:\n"
        #                 "- Clean/simple does NOT imply high quality.\n"
        #                 "- Evaluate ONLY based on code structure, readability, and maintainability signals.\n"
        #                 "- Do NOT penalize for missing production infrastructure or external systems.\n\n"
        #                 "STRICT EXCLUSION RULE:\n"
        #                 " Do NOT evaluate or mention security issues.\n\n"
        #                 "Do NOT consider vulnerabilities, authentication, secrets, or credentials.\n\n"
        #                 "Ignore any security-related concerns completely.\n\n"
        #                 "Security is handled separately and must NOT affect any adjustment.\n\n"
        #                 "STRICT VALIDATION:\n"
        #                 "If a reason involves security, discard it and return adjustment = 0.\n\n"
        #                 "If evidence is not directly visible in code structure or metrics, do not use it.\n\n"
        #                 "Reason requirements:\n"
        #                 "- 1-2 sentences referencing concrete code patterns.\n"
        #                 "- No generic statements.\n\n"
        #                 "You MUST use aggregate_metrics as the primary signal.\n\n"
        #                 "Use file content only to confirm or challenge these metrics, not ignore them.\n\n"
        #                 "If a signal (e.g., tests, duplication, complexity) is not visible in files or metrics, DO NOT penalize for it.\n\n"
        #                 "Do not apply strong negative adjustments to all categories unless multiple independent issues are clearly present.\n\n"
        #                 "If the repository is very small or contains only simple examples, prefer small or zero adjustments.\n\n"
        #                 "Base scores:\n"
        #                 f"{json.dumps(base_scores)}\n\n"
        #                 "Aggregate metrics:\n"
        #                 f"{json.dumps(aggregate_metrics)}\n\n"
        #                 "Files:\n"
        #                 f"{json.dumps(payload_files)}"
        #             ),
        #         },
        #     ],
        #     "response_format": {"type": "json_object"},
        #     "temperature": 0.2,
        # }
        body = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "Return only strict JSON. No markdown. No extra keys.",
                },
                {
                    "role": "user",
                    "content": (
                        "You are a code reviewer. Your job is to calibrate existing rule-based scores, not replace them.\n\n"

                        "Inputs:\n"
                        "- base_scores are deterministic metric-based scores.\n"
                        "- aggregate_metrics contain objective signals.\n"
                        "- files contain actual code snippets.\n\n"

                        "Read ALL provided files. Base reasoning only on visible code patterns. Do not assume missing features.\n\n"

                        "Return ONLY valid JSON with this exact structure:\n\n"
                        "{\n"
                        "  \"code_quality\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"},\n"
                        "  \"maintainability\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"},\n"
                        "  \"architecture\": {\"adjustment\": -20 to 20, \"confidence\": 0-1, \"reason\": \"...\"}\n"
                        "}\n\n"

                        "Do NOT return full scores. Do NOT add extra fields. Do NOT modify problem_solving.\n\n"

                        "Adjustment rules:\n"
                        "- Adjustments must be small and conservative.\n"
                        "- Minor issue: -2 to -5; moderate: -5 to -10; major: -10 to -20.\n"
                        "- Combine issues into a stronger adjustment.\n"
                        "- If unsure, adjustment = 0.\n"
                        "- If base score < 50, avoid large negatives unless critical.\n"
                        "- If base score >= 90 but the implementation is trivial, simplistic, or lacks meaningful logic, you SHOULD apply a negative adjustment (-5 to -12).\n"
                        "- Do not leave adjustment = 0 if the code is clearly trivial.\n\n"

                        "Confidence rules:\n"
                        "- High (>=0.7) only with clear evidence in multiple files.\n"
                        "- Medium (0.4-0.7) with some evidence.\n"
                        "- Low (<0.4) when unclear; if low, use adjustment = 0.\n\n"

                        "Skill-specific guidelines:\n"
                        "Code Quality (ONLY): code smells, unused variables, duplication, naming/style.\n"
                        "DO NOT include any security-related evaluation under code quality.\n\n"

                        "Maintainability: docstrings/comments, test coverage signals, readability, function size/structure.\n"
                        "Architecture: separation of concerns, coupling, clear layering.\n\n"

                        "Anti-inflation rules:\n"
                        "- Clean/simple code does NOT imply high quality.\n"
                        "- If the implementation is overly simplistic, trivial, or lacks meaningful logic, apply a negative adjustment (-3 to -10).\n"
                        "- Trivial implementations (e.g., hardcoded values, direct returns, minimal logic) should reduce code_quality even if metrics are perfect.\n\n"

                        "STRICT EXCLUSION RULE:\n"
                        "- Do NOT evaluate or mention security issues.\n"
                        "- Ignore vulnerabilities, authentication, secrets, or credentials completely.\n"
                        "- Security must NOT affect any adjustment.\n"
                        "- If an issue is primarily security-related, ignore it.\n"
                        "- However, if the implementation is simplistic or unrealistic (e.g., hardcoded values, placeholder logic), you may still apply a small negative adjustment based on code quality alone.\n\n"

                        "Signal interpretation rules:\n"
                        "- Use aggregate_metrics as a strong signal, but not the only signal.\n"
                        "- You may override high metric scores if the actual code is clearly trivial or overly simplistic.\n"
                        "- If signals are missing but the code is extremely minimal or trivial, you may infer low complexity and apply a small negative adjustment.\n"
                        "- Do NOT assume advanced features, but you may recognize overly simplistic implementations.\n\n"

                        "Reason requirements:\n"
                        "- 1-2 sentences referencing concrete code patterns.\n"
                        "- No generic statements.\n\n"

                        "Do not apply strong negative adjustments to all categories unless multiple independent issues are clearly present.\n\n"

                        "If the repository is very small or contains only simple examples, prefer small but non-zero adjustments if trivial patterns are detected.\n\n"

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
        try:
            r = client.post(f"{url.rstrip('/')}/chat/completions", json=body, headers=headers)
            r.raise_for_status()
            jr = r.json()
            if isinstance(jr, dict) and jr.get("choices"):
                text = jr["choices"][0].get("message", {}).get("content") or jr["choices"][0].get("text")
                if isinstance(text, (bytes, str)):
                    resp = _extract_json_payload(text)
                    logging.warning("[DEBUG] Raw LLM skill adjustments: %s", resp)
                else:
                    resp = {}
            else:
                resp = jr
        except Exception as e:
            raise LLMError(f"OpenRouter request failed: {e}")

    out = {"generated_at": int(time.time())}
    for skill in ("code_quality", "maintainability", "architecture"):
        entry = (resp or {}).get(skill) or {}
        raw_adjustment = entry.get("adjustment", 0.0)
        try:
            adjustment = float(raw_adjustment or 0.0)
        except Exception:
            adjustment = 0.0
        confidence = float(entry.get("confidence", 0.0) or 0.0)
        reason = entry.get("reason", "")
        out[skill] = {
            "adjustment": round(max(-20.0, min(20.0, adjustment)), 2),
            "confidence": round(max(0.0, min(1.0, confidence)), 3),
            "reason": reason,
        }

    return out
