from typing import Dict, Any
import time


def build_unified_schema(ast_result: Dict[str, Any], llm_result: Dict[str, Any], commit_sha: str | None = None) -> Dict[str, Any]:
    """Combine AST and LLM outputs into the unified metric schema.

    Returns a mapping of required keys to evidence entries.
    """
    ts = int(time.time())
    unified: Dict[str, Any] = {"generated_at": ts, "commit": commit_sha, "metrics": {}}

    # Helper to attach an entry
    def attach(name, value, source, confidence, ref=None):
        unified["metrics"].setdefault(name, [])
        unified["metrics"][name].append({
            "value": value,
            "source": source,
            "confidence": confidence,
            "ref": ref,
        })

    # AST hints
    ast_agg = ast_result.get("aggregate_metrics", {})
    files = ast_result.get("files", [])

    # code_smells (AST: long functions, style violations)
    attach("code_smells", ast_agg.get("long_functions", 0), "AST", 0.6)
    attach("duplication", ast_agg.get("avg_duplication_score", 0.0), "AST", 0.5)
    attach("complexity", ast_agg.get("avg_cyclomatic_complexity", 0.0), "AST", 0.7)
    attach("documentation_coverage", ast_agg.get("avg_docstring_coverage", 1.0), "AST", 0.7)
    attach("test_indicators", ast_agg.get("avg_test_function_ratio", 0.0), "AST", 0.6)
    attach("import_coupling", ast_agg.get("import_coupling_total", 0), "AST", 0.6)
    attach("efferent_coupling", ast_agg.get("efferent_coupling_total", 0), "AST", 0.6)
    attach("circular_imports", ast_agg.get("circular_import_count", 0), "AST", 0.8)
    attach("dead_code_symbols", ast_agg.get("dead_code_symbols", 0), "AST", 0.5)
    attach("halstead_volume", ast_agg.get("avg_halstead_volume", 0.0), "AST", 0.7)
    attach("maintainability_index", ast_agg.get("avg_official_maintainability_index", 0.0), "AST", 0.7)
    attach("inheritance_depth", ast_agg.get("max_inheritance_depth", 0), "AST", 0.6)
    attach("class_lcom", ast_agg.get("avg_class_lcom", 0.0), "AST", 0.6)
    attach("god_classes", ast_agg.get("god_classes", 0), "AST", 0.6)

    # LLM problem solving components
    if llm_result:
        for comp in ("algorithms", "data_structures", "balanced_complexity", "edge_cases"):
            entry = llm_result.get(comp)
            if entry:
                attach(comp, entry.get("score"), "LLM", entry.get("confidence", 0.5), ref=entry.get("evidence"))

    return unified
