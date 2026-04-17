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
    lowered = path.lower()
    return lowered.split("/")[-1].startswith("test_") or "/tests/" in lowered or lowered.endswith("_test.py")


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


def analyze_python_files(files: list[dict]) -> dict:
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
    scores = _compute_scores(file_reports)

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


def _min_max_scale(value: float, low: float, high: float, reverse: bool = False) -> float:
    if high <= low:
        return 1.0
    scaled = (value - low) / (high - low)
    scaled = max(0.0, min(1.0, scaled))
    return 1.0 - scaled if reverse else scaled


def _mean_scaled(file_reports: list[dict], key: str, reverse: bool = False) -> float:
    values = [float(r["metrics"].get(key, 0.0)) for r in file_reports]
    low = min(values)
    high = max(values)
    scaled = [_min_max_scale(v, low, high, reverse=reverse) for v in values]
    return sum(scaled) / len(scaled) if scaled else 1.0


def _compute_scores(file_reports: list[dict]) -> dict:
    if not file_reports:
        return {
            "code_quality": 0,
            "maintainability": 0,
            "architecture": 0,
            "problem_solving": 0,
            "overall": 0,
        }

    quality_components = {
        "smells": _mean_scaled(file_reports, "long_functions", reverse=True),
        "duplication": _mean_scaled(file_reports, "duplication_score", reverse=True),
        "unused_vars": _mean_scaled(file_reports, "unused_variables", reverse=True),
        "style": _mean_scaled(file_reports, "style_violations", reverse=True),
    }

    maintainability_components = {
        "docs": _mean_scaled(file_reports, "docstring_coverage", reverse=False),
        "tests": _mean_scaled(file_reports, "test_function_ratio", reverse=False),
        "complexity": _mean_scaled(file_reports, "cyclomatic_complexity", reverse=True),
        "comments": _mean_scaled(file_reports, "comment_ratio", reverse=False),
    }

    architecture_components = {
        "coupling": _mean_scaled(file_reports, "import_coupling", reverse=True),
        "inheritance": _mean_scaled(file_reports, "max_inheritance_depth", reverse=False),
        "function_size": _mean_scaled(file_reports, "avg_function_size", reverse=True),
        "modularity": _mean_scaled(file_reports, "avg_nesting_depth", reverse=True),
    }

    problem_solving_components = {
        "complexity_distribution": _mean_scaled(file_reports, "cyclomatic_complexity", reverse=False),
        "nesting": _mean_scaled(file_reports, "avg_nesting_depth", reverse=False),
        "modularity": _mean_scaled(file_reports, "avg_function_size", reverse=False),
        "logic_density": _mean_scaled(file_reports, "long_functions", reverse=False),
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
    architecture = weighted(
        architecture_components,
        {"coupling": 0.35, "inheritance": 0.2, "function_size": 0.25, "modularity": 0.2},
    )
    problem_solving = weighted(
        problem_solving_components,
        {"complexity_distribution": 0.35, "nesting": 0.25, "modularity": 0.2, "logic_density": 0.2},
    )

    overall = (code_quality + maintainability + architecture + problem_solving) / 4.0

    return {
        "code_quality": round(code_quality * 100, 2),
        "maintainability": round(maintainability * 100, 2),
        "architecture": round(architecture * 100, 2),
        "problem_solving": round(problem_solving * 100, 2),
        "overall": round(overall * 100, 2),
    }
