# ai_services/insights/ai_insights.py
# ===================================================
# SkillPulse AI Engine — Role-Based Insights + RAG
# ===================================================

import os
import json
import logging
from dotenv import load_dotenv

load_dotenv()
from openai import AsyncOpenAI
from json_repair import repair_json

logger = logging.getLogger(__name__)


# ===================================================
#  CLIENT
# ===================================================

def _get_client():
    mode = os.getenv("AI_MODE", "openrouter")
    if mode == "openrouter":
        return AsyncOpenAI(
            base_url=os.getenv("OPENROUTER_API_URL", "https://openrouter.ai/api/v1"),
            api_key=os.getenv("OPENROUTER_API_KEY"),
        ), os.getenv("OPENROUTER_MODEL", "qwen/qwen3-14b")
    else:
        return AsyncOpenAI(
            base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
            api_key="ollama",
        ), os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")


async def _call_llm(system_prompt: str, user_content: str) -> dict:
    client, model = _get_client()
    full_prompt = f"{system_prompt}\n\n=== REPOSITORY DATA TO ANALYZE ===\n{user_content}"
    response = await client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": full_prompt}],
        temperature=0.4,
        max_tokens=2000,
    )
    raw = response.choices[0].message.content
    try:
        return json.loads(repair_json(raw))
    except Exception as e:
        logger.error(f"Parse failed: {e}\nRaw: {raw[:300]}")
        raise ValueError(f"Unparseable response: {e}")


# ===================================================
#  HELPERS
# ===================================================

def _score_label(score: float) -> str:
    if score >= 85:   return "excellent"
    elif score >= 70: return "good"
    elif score >= 50: return "needs improvement"
    elif score >= 30: return "poor"
    else:             return "critically low"


def _test_label(test_files: int) -> str:
    if test_files == 0:
        return "0 test files (no automated tests exist)"
    elif test_files <= 2:
        return f"{test_files} test file(s) — minimal coverage"
    return f"{test_files} test files"


def _build_security_summary(security_report: dict) -> str:
    if not security_report or security_report.get("total_findings", 0) == 0:
        return "No security findings."
    total    = security_report.get("total_findings", 0)
    severity = security_report.get("severity_distribution", {})
    owasp    = security_report.get("owasp_distribution", {})
    files    = security_report.get("top_vulnerable_files", {})
    lines = [f"Total: {total} findings"]
    if severity:
        lines.append("Severity -> " + ", ".join(f"{k}: {v}" for k, v in sorted(severity.items())))
    if owasp:
        top = sorted(owasp.items(), key=lambda x: x[1], reverse=True)[:4]
        lines.append("OWASP -> " + ", ".join(f"{k} ({v})" for k, v in top))
    if files:
        lines.append("Top affected files -> " + ", ".join(list(files.keys())[:3]))
    return "\n".join(lines)


def _build_categorized_findings_summary(security_report: dict) -> str:
    categorized = security_report.get("categorized_findings") or {}
    if not categorized:
        return "HIGH: none\nMEDIUM: none\nLOW: none"

    lines: list[str] = []
    for severity in ("HIGH", "MEDIUM", "LOW"):
        per_file = categorized.get(severity, {}) or {}
        if not per_file:
            lines.append(f"{severity}: none")
            continue
        fragments = []
        for file_path, issues in list(per_file.items())[:5]:
            fragments.append(f"{file_path} ({len(issues)})")
        lines.append(f"{severity}: " + ", ".join(fragments))

    return "\n".join(lines)


# ===================================================
#  RAG CONTEXT BUILDER
# ===================================================

def _get_rag_context(doc_id, analysis_result: dict, security_report: dict) -> str:
    if not doc_id:
        return ""
    try:
        from ai_services.rag.rag_retriever import build_rag_context
        return build_rag_context(doc_id, analysis_result, security_report)
    except Exception as e:
        logger.warning(f"[RAG] Could not build RAG context: {e}")
        return ""


# ===================================================
#  PROMPTS
# ===================================================

_DEVELOPER_PROMPT = """You are SkillPulse AI — a senior software engineer giving code review feedback.

AUDIENCE: The developer who wrote this code.

TASK: Generate specific, honest, and actionable insights based on the metrics AND the CODING STANDARDS CONTEXT provided below.

HOW TO INTERPRET SCORES:
- code_quality -> driven by: style violations, duplication, function size, complexity
- maintainability -> driven by: docstring coverage, coupling, nesting depth, long functions
- architecture -> driven by: import coupling, inheritance depth, module separation
- problem_solving -> driven by: test files count, test function ratio, cyclomatic complexity, long functions
- security_score -> driven by: HIGH/MEDIUM/LOW security findings and affected files

CRITICAL RULES:
- You MUST use the CODING STANDARDS CONTEXT section to write your Fix points
- Every Fix must explicitly name the standard it comes from, for example:
  'per Clean Code: functions should do one thing'
  'per SOLID SRP: each module should have one responsibility'
  'per OWASP A08: validate all deserialized data'
  'per Google Python Style Guide: all public functions require docstrings'
- Why: cite the actual metric value
- Fix: cite the metric AND the specific standard/rule from the context
- Do NOT write generic advice. Every fix must reference a standard by name.
- Include final_categorized_findings grouped by HIGH, MEDIUM, LOW with file paths
- Use single quotes inside strings, never double quotes
- Return ONLY valid JSON

JSON structure:
{
  "skills_insights": {
    "code_quality": [
      "Why: reference the actual metric value that drives this score",
      "Fix: specific fix citing the standard name (e.g. per Clean Code: ...)"
    ],
    "maintainability": [
      "Why: reference the actual metric value",
      "Fix: specific fix citing the standard name"
    ],
    "architecture": [
      "Why: reference the actual metric value",
      "Fix: specific fix citing the standard name (e.g. per SOLID SRP: ...)"
    ],
    "problem_solving": [
      "Why: cite the actual drivers (test files count, complexity, etc.)",
      "Fix: specific fix citing the standard name (e.g. per TDD: ...)"
    ]
  },
  "security_insights": "Paragraph citing exact OWASP categories with counts, affected files, and the specific OWASP mitigation rule that applies from the context.",
  "final_categorized_findings": {
    "HIGH": ["file_path: concise issue summary"],
    "MEDIUM": ["file_path: concise issue summary"],
    "LOW": ["file_path: concise issue summary"]
  }
}"""


_MANAGER_PROMPT = """You are SkillPulse AI — generating a code health report for an Engineering Manager.

AUDIENCE: Engineering Manager or CTO. No code jargon. Focus on delivery risk and business impact.

TASK: Translate the technical metrics into clear business risks and team strengths.
Every point must be grounded in the actual data — no generic statements.

HOW TO FRAME THINGS:
- Missing tests = risk of bugs reaching production = higher support cost and slower releases
- High security findings = data exposure risk, compliance issues, customer trust
- High import coupling = future features take longer to build, changes break other parts
- Good code quality = lower maintenance cost, easier onboarding
- Good docstring coverage = faster knowledge transfer when team grows

RULES:
- security_skill_insight: frame the actual OWASP findings as business risk — mention severity levels and what they mean for users/data
- areas_needing_attention: 2-3 items — pick the highest impact risks, back each with a metric
- team_strengths: exactly 3 — each must cite an actual metric value as evidence
- Use single quotes inside strings, never double quotes
- Return ONLY valid JSON

JSON structure:
{
  "security_skill_insight": "Business-impact paragraph citing actual severity counts and what they mean for the product.",
  "areas_needing_attention": [
    {"title": "Specific risk name", "description": "Business impact with metric evidence."},
    {"title": "Specific risk name", "description": "Business impact with metric evidence."}
  ],
  "team_strengths": [
    "Strength — backed by metric (e.g. zero style violations across X files)",
    "Strength — backed by metric",
    "Strength — backed by metric"
  ]
}"""


_RECRUITER_PROMPT = """You are SkillPulse AI — creating a candidate summary card for a recruiter.

AUDIENCE: HR professional. Zero technical background. Write like you are describing a person's work habits.

TASK: Summarize this developer's strengths and growth areas in plain, professional language.
Base it on the scores and profile facts — be specific and honest, not generic.

HOW TO TRANSLATE SCORES TO PLAIN LANGUAGE:
- High code quality = 'produces clean, organized work consistently'
- Good maintainability = 'writes code that teammates can easily understand and continue'
- Low problem_solving (from missing tests) = 'would benefit from training in quality assurance practices'
- Security issues = 'shows gaps in security awareness — addressable with structured training'
- Zero style violations = 'highly consistent and detail-oriented work style'

RULES:
- Exactly 3 highlights
- Highlight 1: lead with the developer's real strongest quality (back it with the score)
- Highlight 2: honest growth area — frame as a training opportunity, not a flaw
- Highlight 3: overall hiring potential and team collaboration fit
- Max 25 words per highlight
- ZERO technical terms (no 'cyclomatic', 'OWASP', 'coupling', 'pytest', 'docstring', etc.)
- Use single quotes inside strings, never double quotes
- Return ONLY valid JSON

JSON structure:
{
  "key_highlights": [
    "Highlight 1 — specific strength backed by performance level",
    "Highlight 2 — growth area as a training opportunity",
    "Highlight 3 — hiring potential and team fit"
  ]
}"""


# ===================================================
#  CONTENT BUILDERS
# ===================================================

def _developer_content(analysis: dict, security_report: dict, rag_context: str = "") -> str:
    scores = analysis.get("scores", {})
    m      = analysis.get("aggregate_metrics", {})

    base = f"""SCORES (out of 100):
- Code Quality:    {scores.get('code_quality')} — {_score_label(scores.get('code_quality', 0))}
- Maintainability: {scores.get('maintainability')} — {_score_label(scores.get('maintainability', 0))}
- Architecture:    {scores.get('architecture')} — {_score_label(scores.get('architecture', 0))}
- Security Score:  {scores.get('security_score')} — {_score_label(scores.get('security_score', 0))}
- Problem Solving: {scores.get('problem_solving')} — {_score_label(scores.get('problem_solving', 0))}

METRICS (use these to explain each score):
- Total files: {m.get('total_files')} | Test files: {_test_label(m.get('test_files', 0))}
- Avg test function ratio: {m.get('avg_test_function_ratio', 0)}
- Avg cyclomatic complexity: {m.get('avg_cyclomatic_complexity')} (healthy < 5, warning > 10)
- Avg function size: {m.get('avg_function_size', 0):.1f} lines (healthy < 20)
- Long functions: {m.get('long_functions', 0)}
- Deep nesting instances: {m.get('deep_nesting', 0)} | Avg nesting depth: {m.get('avg_nesting_depth', 0):.2f}
- Docstring coverage: {m.get('avg_docstring_coverage', 0)*100:.0f}% (ideal > 80%)
- Code duplication: {m.get('avg_duplication_score', 0)*100:.0f}% (ideal < 15%)
- Import coupling total: {m.get('import_coupling_total')} (high = tightly coupled modules)
- Style violations: {m.get('style_violations', 0)}
- Unused variables: {m.get('unused_variables', 0)}

SECURITY DATA:
{_build_security_summary(security_report)}

SECURITY FINDINGS GROUPED BY SEVERITY AND FILE:
{_build_categorized_findings_summary(security_report)}"""

    if rag_context:
        base += f"\n\nCODING STANDARDS CONTEXT (you MUST cite these standards in your Fix points):\n{rag_context}"

    return base


def _manager_content(analysis: dict, security_report: dict, rag_context: str = "") -> str:
    scores = analysis.get("scores", {})
    m      = analysis.get("aggregate_metrics", {})

    base = f"""SCORES (out of 100):
- Code Quality:    {scores.get('code_quality')} — {_score_label(scores.get('code_quality', 0))}
- Maintainability: {scores.get('maintainability')} — {_score_label(scores.get('maintainability', 0))}
- Architecture:    {scores.get('architecture')} — {_score_label(scores.get('architecture', 0))}
- Security Score:  {scores.get('security_score')} — {_score_label(scores.get('security_score', 0))}
- Problem Solving: {scores.get('problem_solving')} — {_score_label(scores.get('problem_solving', 0))}
- Overall:         {scores.get('overall')} — {_score_label(scores.get('overall', 0))}

TEAM METRICS:
- Total files: {m.get('total_files')} | Test files: {_test_label(m.get('test_files', 0))}
- Avg complexity: {m.get('avg_cyclomatic_complexity')} | Long functions: {m.get('long_functions', 0)}
- Docstring coverage: {m.get('avg_docstring_coverage', 0)*100:.0f}%
- Import coupling: {m.get('import_coupling_total')}
- Style violations: {m.get('style_violations', 0)}
- Total lines of code: {m.get('total_loc', 0)}

SECURITY DATA:
{_build_security_summary(security_report)}

SECURITY FINDINGS GROUPED BY SEVERITY AND FILE:
{_build_categorized_findings_summary(security_report)}"""

    if rag_context:
        base += f"\n\nCODING STANDARDS CONTEXT:\n{rag_context}"

    return base


def _recruiter_content(analysis: dict, security_report: dict, rag_context: str = "") -> str:
    scores    = analysis.get("scores", {})
    m         = analysis.get("aggregate_metrics", {})
    total_sec = security_report.get("total_findings", 0) if security_report else 0

    return f"""PERFORMANCE SCORES (out of 100):
- Code Quality (cleanliness and consistency): {scores.get('code_quality')} — {_score_label(scores.get('code_quality', 0))}
- Maintainability (ease of collaboration):    {scores.get('maintainability')} — {_score_label(scores.get('maintainability', 0))}
- Architecture (project organization):        {scores.get('architecture')} — {_score_label(scores.get('architecture', 0))}
- Security Score (safe coding awareness):     {scores.get('security_score')} — {_score_label(scores.get('security_score', 0))}
- Problem Solving (testing and logic):        {scores.get('problem_solving')} — {_score_label(scores.get('problem_solving', 0))}
- Overall Score:                              {scores.get('overall')} — {_score_label(scores.get('overall', 0))}

PROFILE FACTS:
- Documentation: {m.get('avg_docstring_coverage', 0)*100:.0f}% of code is documented
- Automated testing: {_test_label(m.get('test_files', 0))}
- Style consistency: {'perfect — zero violations across all files' if m.get('style_violations', 0) == 0 else f"{m.get('style_violations')} inconsistencies found"}
- Security issues found: {total_sec} ({'none' if total_sec == 0 else 'minor — trainable' if total_sec <= 5 else 'moderate' if total_sec <= 15 else 'significant — needs attention'})"""


# ===================================================
#  ROLE ROUTER
# ===================================================

_ROLE_MAP = {
    "developer": (_DEVELOPER_PROMPT, _developer_content),
    "manager":   (_MANAGER_PROMPT,   _manager_content),
    "recruiter": (_RECRUITER_PROMPT, _recruiter_content),
}


async def generate_insights(
    role: str,
    analysis_result: dict,
    security_report: dict = None,
    doc_id: str = None,
) -> dict:
    security_report = security_report or {}
    role = role.lower()
    print(f"[RAG DEBUG] doc_id received = {doc_id}")
    print(f"[RAG DEBUG] role = {role}")

    if role not in _ROLE_MAP:
        logger.warning(f"Unknown role '{role}' — defaulting to developer")
        role = "developer"

    prompt, content_fn = _ROLE_MAP[role]

    rag_context = _get_rag_context(doc_id, analysis_result, security_report)
    print(f"[RAG DEBUG] rag_context length = {len(rag_context)}")

    if rag_context:
        logger.info(f"[RAG] Context injected into prompt ({len(rag_context)} chars)")
    else:
        logger.info("[RAG] No context available — running without RAG")

    logger.info(f"Generating insights | role={role} | mode={os.getenv('AI_MODE')}")

    result = await _call_llm(prompt, content_fn(analysis_result, security_report, rag_context))
    logger.info("Insights generated.")
    return result
