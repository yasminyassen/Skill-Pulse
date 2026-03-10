from concurrent.futures import ThreadPoolExecutor, as_completed

from app.services.security.bandit_scan import run_bandit
from app.services.security.semgrep_scan import run_semgrep
from app.services.security.safety_scan import run_safety
from app.services.security.gitleaks_scan import run_gitleaks
from app.services.security.post_processing import deduplicate_findings


def run_security_analysis(repo_path):

    scanners = {
        "bandit": run_bandit,
        "semgrep": run_semgrep,
        "safety": run_safety,
        "gitleaks": run_gitleaks
    }

    findings = []

    with ThreadPoolExecutor(max_workers=len(scanners)) as executor:

        futures = {
            executor.submit(scanner, repo_path): name
            for name, scanner in scanners.items()
        }

        for future in as_completed(futures):

            tool_name = futures[future]

            try:

                results = future.result(timeout=400)

                if results:

                    print(f"{tool_name} completed with {len(results)} findings")

                    findings.extend(results)

                else:

                    print(f"{tool_name} completed with 0 findings")

            except Exception as e:

                print(f"{tool_name} failed:", e)
                
    findings = deduplicate_findings(findings)
    return findings