"""
SkillPulse - AI Engine Model Benchmark (Real Data)
====================================================
بيجرب الموديلز على الـ JSON الحقيقي بتاع الـ Skill Scoring Engine
"""

import requests
import json
import time

# ===== ضحطي الـ API Key هنا =====
OPENROUTER_API_KEY = "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"
# ==================================

MODELS = [
    {
        "id": "deepseek/deepseek-coder-v2-lite-instruct",
        "name": "DeepSeek Coder V2",
    },
    {
        "id": "qwen/qwen-2.5-coder-7b-instruct",
        "name": "Qwen 2.5 Coder 7B",
    },
    {
        "id": "google/gemma-2-9b-it",
        "name": "Gemma 2 9B",
    },
    {
        "id": "meta-llama/llama-3.1-8b-instruct",
        "name": "Llama 3.1 8B",
    },
]

# ====== الـ JSON الحقيقي بتاع مشروعكم ======
REAL_ANALYSIS = {
    "repo": "Hadeel-Khaled/ML_Project",
    "aggregate_metrics": {
        "total_files": 16,
        "test_files": 0,
        "avg_cyclomatic_complexity": 2,
        "avg_function_size": 8.8,
        "avg_nesting_depth": 0.36,
        "avg_docstring_coverage": 0.75,
        "avg_test_function_ratio": 0,
        "avg_duplication_score": 0.16,
        "avg_comment_ratio": 0.45,
        "style_violations": 0,
        "long_functions": 1,
        "import_coupling_total": 51,
        "total_loc": 838
    },
    "scores": {
        "code_quality": 91.28,
        "maintainability": 78.82,
        "architecture": 77.96,
        "problem_solving": 15.4,
        "overall": 65.87
    },
    "security_findings_count": 20,
    "notable_files": [
        {
            "path": "src/preprocess/resize_and_clean.py",
            "issue": "highest cyclomatic complexity (11) and low comment ratio"
        },
        {
            "path": "src/preprocess/augmentation.py",
            "issue": "missing docstrings on 3 functions, complexity 8"
        },
        {
            "path": "src/features/extract_features.py",
            "issue": "high duplication score (0.61)"
        }
    ]
}


def build_prompt(analysis: dict) -> str:
    scores = analysis["scores"]
    metrics = analysis["aggregate_metrics"]

    return f"""You are SkillPulse, an AI assistant that explains code analysis results to developers in a clear and constructive way.

A developer submitted their Python repository for analysis. Here are the results:

## Repository: {analysis["repo"]}

## Scores (0-100):
- Code Quality: {scores["code_quality"]}
- Maintainability: {scores["maintainability"]}
- Architecture: {scores["architecture"]}
- Problem Solving: {scores["problem_solving"]}
- Overall: {scores["overall"]}

## Key Metrics:
- Total files: {metrics["total_files"]} | Test files: {metrics["test_files"]}
- Avg complexity: {metrics["avg_cyclomatic_complexity"]} | Avg function size: {metrics["avg_function_size"]} lines
- Docstring coverage: {metrics["avg_docstring_coverage"] * 100:.0f}%
- Code duplication: {metrics["avg_duplication_score"] * 100:.0f}%
- Security findings: {analysis["security_findings_count"]}

## Files with Issues:
{chr(10).join(f'- {f["path"]}: {f["issue"]}' for f in analysis["notable_files"])}

Generate a developer-friendly AI insight report. Be specific, honest, and encouraging.

Respond ONLY in this exact JSON format (no markdown, no extra text):
{{
  "overall_summary": "<2-3 sentences summarizing the developer's strengths and main area to improve>",
  "score_explanations": {{
    "code_quality": "<why they got this score, what it means>",
    "maintainability": "<why they got this score>",
    "architecture": "<why they got this score>",
    "problem_solving": "<why they got this score — be honest but constructive>"
  }},
  "top_recommendations": [
    "<specific actionable recommendation 1>",
    "<specific actionable recommendation 2>",
    "<specific actionable recommendation 3>"
  ],
  "skill_level": "<Junior | Mid | Senior>",
  "skill_reasoning": "<1-2 sentences explaining the skill level assessment>"
}}"""


def test_model(model, prompt):
    print(f"\n{'='*55}")
    print(f"🔍 {model['name']}")
    print(f"{'='*55}")

    start = time.time()

    try:
        response = requests.post(
            url="https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://skillpulse.dev",
                "X-Title": "SkillPulse AI Engine"
            },
            json={
                "model": model["id"],
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 1000,
                "temperature": 0.2
            },
            timeout=90
        )

        elapsed = round(time.time() - start, 2)

        if response.status_code != 200:
            print(f"❌ HTTP {response.status_code}: {response.text[:300]}")
            return None

        raw = response.json()["choices"][0]["message"]["content"]
        print(f"⏱️  {elapsed}s")

        # Parse JSON
        clean = raw.strip()
        for tag in ["```json", "```"]:
            if tag in clean:
                clean = clean.split(tag)[1].split("```")[0].strip()

        parsed = json.loads(clean)

        # اطبع الـ insights
        print(f"\n📋 Summary:\n   {parsed.get('overall_summary', '')[:150]}...")
        print(f"\n🎯 Skill Level: {parsed.get('skill_level')} — {parsed.get('skill_reasoning', '')[:100]}")
        print(f"\n💡 Problem Solving Explanation:\n   {parsed.get('score_explanations', {}).get('problem_solving', '')[:150]}")
        print(f"\n✅ Top Recommendations:")
        for i, rec in enumerate(parsed.get("top_recommendations", []), 1):
            print(f"   {i}. {rec[:100]}")

        return {
            "model": model["name"],
            "model_id": model["id"],
            "time": elapsed,
            "parsed": True,
            "fields_complete": all(k in parsed for k in [
                "overall_summary", "score_explanations",
                "top_recommendations", "skill_level", "skill_reasoning"
            ]),
            "result": parsed
        }

    except json.JSONDecodeError as e:
        print(f"⚠️  JSON parse failed: {e}")
        print(f"   Raw: {raw[:200]}")
        return {"model": model["name"], "time": round(time.time()-start, 2), "parsed": False}
    except Exception as e:
        print(f"❌ Error: {e}")
        return None


def print_summary(results):
    print(f"\n\n{'='*65}")
    print("📊 FINAL SUMMARY — أحسن موديل لـ SkillPulse AI Engine")
    print(f"{'='*65}")
    print(f"{'Model':<25} {'Time':>6} {'JSON':>6} {'Complete':>10} {'Skill':>8}")
    print(f"{'-'*65}")

    scored = []
    for r in results:
        if not r:
            continue
        t = f"{r.get('time', '?')}s"
        fmt = "✅" if r.get("parsed") else "❌"
        complete = "✅ Yes" if r.get("fields_complete") else "❌ No"
        skill = r.get("result", {}).get("skill_level", "—") if r.get("parsed") else "—"
        print(f"{r['model']:<25} {t:>6} {fmt:>6} {complete:>10} {skill:>8}")

        if r.get("parsed") and r.get("fields_complete"):
            scored.append(r)

    print(f"\n{'='*65}")
    if scored:
        best = min(scored, key=lambda x: x["time"])
        print(f"🏆 الموديل الأحسن: {best['model']}")
        print(f"   ID للـ AI Engine: {best['model_id']}")
        print(f"\n   ✅ كوبي الـ ID ده وقوليلي وهنبني الـ engine بيه")
    else:
        print("⚠️  محدش عمل JSON كامل — جربي تشيكي على الـ API Key")


if __name__ == "__main__":
    print("🚀 SkillPulse AI Engine — Model Benchmark on Real Data")

    if "xxxxxxxx" in OPENROUTER_API_KEY:
        print("❌ حطي الـ API Key الحقيقي في السطر 13!")
        exit(1)

    prompt = build_prompt(REAL_ANALYSIS)
    print(f"📝 Prompt built — {len(prompt)} chars\n")

    results = []
    for model in MODELS:
        result = test_model(model, prompt)
        results.append(result)
        time.sleep(2)

    print_summary(results)