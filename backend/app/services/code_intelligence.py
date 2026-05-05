import ast
import hashlib
import re
from collections import Counter, defaultdict

SNAKE_CASE_RE = re.compile(r"^[a-z_][a-z0-9_]*$")


class FunctionAnalyzer(ast.NodeVisitor):
    def __init__(self) -> None:
        self.max_depth = 0
        self._current_depth = 0
        self.cyclomatic = 1

    def _bump_depth(self, node: ast.AST) -> None:
        self._current_depth += 1
        self.max_depth = max(self.max_depth, self._current_depth)
        self.generic_visit(node)
        self._current_depth -= 1

    def visit_If(self, node: ast.If) -> None:
        self.cyclomatic += 1
        self._bump_depth(node)

    def visit_For(self, node: ast.For) -> None:
        self.cyclomatic += 1
        self._bump_depth(node)

    def visit_AsyncFor(self, node: ast.AsyncFor) -> None:
        self.cyclomatic += 1
        self._bump_depth(node)

    def visit_While(self, node: ast.While) -> None:
        self.cyclomatic += 1
        self._bump_depth(node)

    def visit_Try(self, node: ast.Try) -> None:
        self.cyclomatic += 1
        self._bump_depth(node)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        self.cyclomatic += 1
        self._bump_depth(node)

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        if isinstance(node.op, (ast.And, ast.Or)):
            self.cyclomatic += max(len(node.values) - 1, 1)
        self.generic_visit(node)


def _line_count(node: ast.AST) -> int:
    start = getattr(node, "lineno", None)
    end = getattr(node, "end_lineno", None)
    if not start or not end:
        return 0
    return max(0, end - start + 1)


def _function_param_count(node: ast.FunctionDef | ast.AsyncFunctionDef) -> int:
    args = node.args
    return len(args.args) + len(args.kwonlyargs) + (1 if args.vararg else 0) + (1 if args.kwarg else 0)


def _collect_unused_variables(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[str]:
    assigned: set[str] = set()
    used: set[str] = set()

    for child in ast.walk(node):
        if isinstance(child, ast.Name):
            if isinstance(child.ctx, ast.Store):
                assigned.add(child.id)
            elif isinstance(child.ctx, ast.Load):
                used.add(child.id)

    return sorted(v for v in assigned if v not in used and not v.startswith("_"))


def _module_name_from_import(node: ast.AST) -> list[str]:
    modules: list[str] = []
    if isinstance(node, ast.Import):
        for alias in node.names:
            modules.append(alias.name.split(".")[0])
    elif isinstance(node, ast.ImportFrom):
        if node.module:
            modules.append(node.module.split(".")[0])
    return modules


def _is_test_file(path: str) -> bool:
    lowered = path.replace("\\", "/").lower()
    filename = lowered.rsplit("/", 1)[-1]
    path_parts = lowered.split("/")

    return (
        "test" in filename
        or filename.endswith("_test.py")
        or filename.endswith(".test.py")
        or "tests" in path_parts
        or "test" in path_parts
    )


def _hash_windows(lines: list[str], window_size: int = 5) -> list[str]:
    hashes: list[str] = []
    if len(lines) < window_size:
        return hashes
    for idx in range(0, len(lines) - window_size + 1):
        block = "\n".join(line.strip() for line in lines[idx : idx + window_size] if line.strip())
        if not block:
            continue
        hashes.append(hashlib.sha1(block.encode("utf-8")).hexdigest())
    return hashes


def analyze_python_files(files: list[dict], problem_solving_score: float = 0.0) -> dict:
    file_reports: list[dict] = []
    all_hashes: Counter[str] = Counter()
    file_hashes: dict[str, list[str]] = {}

    for file_obj in files:
        path = file_obj["path"]
        lines = file_obj.get("content", "").splitlines()
        hashes = _hash_windows(lines)
        file_hashes[path] = hashes
        all_hashes.update(hashes)

    for file_obj in files:
        path = file_obj["path"]
        content = file_obj.get("content", "")
        lines = content.splitlines()
        loc = len(lines)
        comment_lines = sum(1 for line in lines if line.strip().startswith("#"))
        is_test = _is_test_file(path)

        syntax_error = None
        try:
            tree = ast.parse(content)
        except SyntaxError as exc:
            syntax_error = f"{exc.msg} at line {exc.lineno}"
            tree = None

        functions: list[dict] = []
        classes: list[dict] = []
        style_violations = 0
        missing_docstrings = 0
        public_symbols = 0
        documented_symbols = 0
        module_imports: set[str] = set()
        cyclomatic_file = 0
        unused_variables_total = 0

        if tree is not None:
            class_defs = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)}
            class_depth_cache: dict[str, int] = {}

            def _class_depth(name: str, trail: set[str] | None = None) -> int:
                if name in class_depth_cache:
                    return class_depth_cache[name]
                if trail is None:
                    trail = set()
                if name in trail:
                    return 1
                trail.add(name)
                node = class_defs.get(name)
                if not node or not node.bases:
                    class_depth_cache[name] = 1
                    return 1
                depths = [1]
                for base in node.bases:
                    if isinstance(base, ast.Name):
                        depths.append(1 + _class_depth(base.id, trail))
                    else:
                        depths.append(2)
                class_depth_cache[name] = max(depths)
                return class_depth_cache[name]

            for node in ast.walk(tree):
                if isinstance(node, (ast.Import, ast.ImportFrom)):
                    module_imports.update(_module_name_from_import(node))

                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    name = node.name
                    params = _function_param_count(node)
                    size = _line_count(node)
                    analyzer = FunctionAnalyzer()
                    analyzer.visit(node)
                    unused = _collect_unused_variables(node)

                    if not name.startswith("_"):
                        public_symbols += 1
                        if ast.get_docstring(node):
                            documented_symbols += 1
                        else:
                            missing_docstrings += 1

                    if not SNAKE_CASE_RE.match(name):
                        style_violations += 1

                    if params > 5:
                        style_violations += 1

                    functions.append(
                        {
                            "name": name,
                            "size": size,
                            "param_count": params,
                            "cyclomatic": analyzer.cyclomatic,
                            "max_nesting": analyzer.max_depth,
                            "long_function": size > 50,
                            "too_many_params": params > 5,
                            "deep_nesting": analyzer.max_depth > 4,
                            "is_test_function": name.startswith("test_"),
                            "unused_variables": unused,
                        }
                    )

                    cyclomatic_file += analyzer.cyclomatic
                    unused_variables_total += len(unused)

                if isinstance(node, ast.ClassDef):
                    name = node.name
                    depth = _class_depth(name)
                    if not name.startswith("_"):
                        public_symbols += 1
                        if ast.get_docstring(node):
                            documented_symbols += 1
                        else:
                            missing_docstrings += 1
                    classes.append({"name": name, "inheritance_depth": depth})

        duplicated_windows = sum(1 for h in file_hashes.get(path, []) if all_hashes[h] > 1)
        total_windows = len(file_hashes.get(path, []))
        duplication_score = (duplicated_windows / total_windows) if total_windows else 0.0

        long_functions = sum(1 for f in functions if f["long_function"])
        too_many_params = sum(1 for f in functions if f["too_many_params"])
        deep_nesting = sum(1 for f in functions if f["deep_nesting"])
        test_functions = sum(1 for f in functions if f["is_test_function"])
        avg_function_size = (
            sum(f["size"] for f in functions) / len(functions) if functions else 0.0
        )
        avg_nesting = (
            sum(f["max_nesting"] for f in functions) / len(functions) if functions else 0.0
        )
        max_inheritance_depth = max((c["inheritance_depth"] for c in classes), default=0)
        docstring_coverage = (
            documented_symbols / public_symbols if public_symbols else 1.0
        )
        comment_ratio = comment_lines / loc if loc else 0.0
        test_function_ratio = test_functions / len(functions) if functions else 0.0

        metrics = {
            "loc": loc,
            "comment_lines": comment_lines,
            "comment_ratio": comment_ratio,
            "cyclomatic_complexity": cyclomatic_file,
            "avg_function_size": avg_function_size,
            "avg_nesting_depth": avg_nesting,
            "long_functions": long_functions,
            "too_many_params": too_many_params,
            "deep_nesting": deep_nesting,
            "style_violations": style_violations,
            "missing_docstrings": missing_docstrings,
            "docstring_coverage": docstring_coverage,
            "unused_variables": unused_variables_total,
            "import_coupling": len(module_imports),
            "max_inheritance_depth": max_inheritance_depth,
            "is_test_file": is_test,
            "test_function_ratio": test_function_ratio,
            "duplication_score": duplication_score,
            "syntax_error": syntax_error,
        }

        file_reports.append(
            {
                "path": path,
                "filename": file_obj.get("filename", path.rsplit("/", 1)[-1]),
                "size": file_obj.get("size", len(content.encode("utf-8"))),
                "metrics": metrics,
            }
        )

    aggregate = _aggregate_metrics(file_reports)
    scores = _compute_scores(file_reports, problem_solving_score)

    return {
        "files": file_reports,
        "aggregate_metrics": aggregate,
        "scores": scores,
    }


def _aggregate_metrics(file_reports: list[dict]) -> dict:
    if not file_reports:
        return {}

    sums = defaultdict(float)
    test_files = 0
    for report in file_reports:
        m = report["metrics"]
        for key in (
            "loc",
            "cyclomatic_complexity",
            "avg_function_size",
            "avg_nesting_depth",
            "long_functions",
            "too_many_params",
            "deep_nesting",
            "style_violations",
            "missing_docstrings",
            "unused_variables",
            "import_coupling",
            "max_inheritance_depth",
            "test_function_ratio",
            "docstring_coverage",
            "duplication_score",
            "comment_ratio",
        ):
            sums[key] += float(m.get(key, 0.0))

        if m.get("is_test_file"):
            test_files += 1

    total_files = len(file_reports)
    return {
        "total_files": total_files,
        "python_files": total_files,
        "test_files": test_files,
        "avg_cyclomatic_complexity": sums["cyclomatic_complexity"] / total_files,
        "avg_function_size": sums["avg_function_size"] / total_files,
        "avg_nesting_depth": sums["avg_nesting_depth"] / total_files,
        "avg_docstring_coverage": sums["docstring_coverage"] / total_files,
        "avg_test_function_ratio": sums["test_function_ratio"] / total_files,
        "avg_duplication_score": sums["duplication_score"] / total_files,
        "avg_comment_ratio": sums["comment_ratio"] / total_files,
        "style_violations": int(sums["style_violations"]),
        "unused_variables": int(sums["unused_variables"]),
        "long_functions": int(sums["long_functions"]),
        "too_many_params": int(sums["too_many_params"]),
        "deep_nesting": int(sums["deep_nesting"]),
        "import_coupling_total": int(sums["import_coupling"]),
        "max_inheritance_depth": int(max(r["metrics"].get("max_inheritance_depth", 0) for r in file_reports)),
        "total_loc": int(sums["loc"]),
    }


def _normalize_metric(value: float, low: float, high: float, reverse: bool = False) -> float:
    if high <= low:
        return 1.0
    scaled = (value - low) / (high - low)
    scaled = max(0.0, min(1.0, scaled))
    return 1.0 - scaled if reverse else scaled


def _avg_normalized(
    file_reports: list[dict],
    key: str,
    low: float,
    high: float,
    reverse: bool = False,
) -> float:
    values = [float(r["metrics"].get(key, 0.0)) for r in file_reports]
    scaled = [_normalize_metric(v, low, high, reverse=reverse) for v in values]
    return sum(scaled) / len(scaled) if scaled else 1.0


def _normalize(value, min_val, max_val):
    """Normalize a value to a 0-1 scale."""
    if max_val == min_val:
        return 0.0
    return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))


def _calculate_aggregate_metrics(file_reports: list[dict]) -> dict:
    """Calculate aggregate metrics from a list of file reports."""
    total_metrics = defaultdict(float)
    total_loc = 0
    total_comment_lines = 0
    max_inheritance_depth = 0
    import_coupling_total = 0
    file_count = len(file_reports)

    if not file_count:
        return {
            "avg_docstring_coverage": 0.0,
            "avg_duplication_score": 0.0,
            "avg_cyclomatic_complexity": 0.0,
            "avg_maintainability_index": 0.0,
            "loc": 0,
            "comment_ratio": 0.0,
            "import_coupling_total": 0,
            "max_inheritance_depth": 0,
        }

    for report in file_reports:
        metrics = report.get("metrics", {})
        for key, value in metrics.items():
            if isinstance(value, (int, float)):
                total_metrics[key] += value
        
        loc = metrics.get("loc", 0)
        total_loc += loc
        total_comment_lines += metrics.get("comment_lines", 0)
        max_inheritance_depth = max(max_inheritance_depth, metrics.get("max_inheritance_depth", 0))
        import_coupling_total += int(metrics.get("import_coupling", 0))

    avg_metrics = {key: value / file_count for key, value in total_metrics.items()}

    return {
        "avg_docstring_coverage": avg_metrics.get("docstring_coverage", 0.0),
        "avg_duplication_score": avg_metrics.get("duplication_score", 0.0),
        "avg_cyclomatic_complexity": avg_metrics.get("cyclomatic_complexity", 0.0),
        "avg_maintainability_index": avg_metrics.get("maintainability_index", 0.0),
        "loc": total_loc,
        "comment_ratio": total_comment_lines / total_loc if total_loc > 0 else 0.0,
        "import_coupling_total": import_coupling_total,
        "max_inheritance_depth": max_inheritance_depth,
    }


def _compute_scores(file_reports: list[dict], problem_solving_score: float = 0.0) -> dict:
    """Computes scores from a list of file reports."""
    aggregate_metrics = _calculate_aggregate_metrics(file_reports)

    quality_components = {
        "smells": _avg_normalized(file_reports, "long_functions", 0.0, 2.0, reverse=True),
        "duplication": _avg_normalized(file_reports, "duplication_score", 0.0, 1.0, reverse=True),
        "unused_vars": _avg_normalized(file_reports, "unused_variables", 0.0, 5.0, reverse=True),
        "style": _avg_normalized(file_reports, "style_violations", 0.0, 5.0, reverse=True),
    }

    maintainability_components = {
        "docs": _avg_normalized(file_reports, "docstring_coverage", 0.0, 1.0, reverse=False),
        "tests": _avg_normalized(file_reports, "test_function_ratio", 0.0, 0.5, reverse=False),
        "complexity": _avg_normalized(file_reports, "cyclomatic_complexity", 1.0, 20.0, reverse=True),
        "comments": _avg_normalized(file_reports, "comment_ratio", 0.0, 0.3, reverse=False),
    }

    architecture_components = {
        "coupling": _avg_normalized(file_reports, "import_coupling", 0.0, 20.0, reverse=True),
        "inheritance": _avg_normalized(file_reports, "max_inheritance_depth", 1.0, 5.0, reverse=False),
        "function_size": _avg_normalized(file_reports, "avg_function_size", 10.0, 60.0, reverse=True),
        "modularity": _avg_normalized(file_reports, "avg_nesting_depth", 1.0, 6.0, reverse=True),
    }


    def weighted(components: dict[str, float], weights: dict[str, float]) -> float:
        return sum(components[name] * weights[name] for name in components)

    code_quality = weighted(
        quality_components,
        {"smells": 0.35, "duplication": 0.25, "unused_vars": 0.2, "style": 0.2},
    )
    maintainability = weighted(
        maintainability_components,
        {"docs": 0.3, "tests": 0.25, "complexity": 0.3, "comments": 0.15},
    )
    architecture = (
        (1 - _normalize(aggregate_metrics["import_coupling_total"], 0, 50)) * 0.5 +
        (1 - _normalize(aggregate_metrics["max_inheritance_depth"], 0, 5)) * 0.5
    )

    problem_solving = problem_solving_score

    overall = (code_quality + maintainability + architecture + problem_solving) / 4.0

    scores = {
        "code_quality": round(code_quality * 100, 2),
        "maintainability": round(maintainability * 100, 2),
        "architecture": round(architecture * 100, 2),
        "problem_solving": round(problem_solving * 100, 2),
        "overall_score": round(overall * 100, 2),
    }

    return scores
