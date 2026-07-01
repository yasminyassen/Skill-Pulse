"""Generate Skill-Pulse Postman collection and environment files."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

OUT_DIR = Path(__file__).parent


def uid() -> str:
    return str(uuid.uuid4())


def base_tests(expected_status: int | list[int], extra: str | None = None) -> list[str]:
    codes = expected_status if isinstance(expected_status, list) else [expected_status]
    code_js = " || ".join(f"pm.response.code === {c}" for c in codes)
    lines = [
        f'pm.test("Status is one of {codes}", function () {{',
        f"    pm.expect([{', '.join(str(c) for c in codes)}]).to.include(pm.response.code);",
        "});",
        'pm.test("Response time under 30s", function () {',
        "    pm.expect(pm.response.responseTime).to.be.below(30000);",
        "});",
        'pm.test("Content-Type is JSON when body exists", function () {',
        "    if (pm.response.text() && pm.response.text().length > 0) {",
        '        pm.expect(pm.response.headers.get("Content-Type")).to.include("application/json");',
        "    }",
        "});",
    ]
    if extra:
        lines.append(extra)
    return lines


def auth_header(use_token: str = "{{access_token}}") -> list[dict]:
    return [{"key": "Authorization", "value": f"Bearer {use_token}", "type": "text"}]


def req(
    name: str,
    method: str,
    path: str,
    *,
    folder_auth: bool = True,
    body: dict | None = None,
    query: list[dict] | None = None,
    formdata: list[dict] | None = None,
    expected: int | list[int] = 200,
    tests: str | None = None,
    prerequest: str | None = None,
    description: str = "",
    no_auth: bool = False,
) -> dict:
    headers = [] if no_auth else auth_header()
    if body is not None:
        headers.append({"key": "Content-Type", "value": "application/json"})
    item: dict = {
        "name": name,
        "request": {
            "method": method,
            "header": headers,
            "url": {
                "raw": f"{{{{base_url}}}}{path}",
                "host": ["{{base_url}}"],
                "path": [p for p in path.strip("/").split("/") if p],
            },
            "description": description,
        },
        "event": [
            {
                "listen": "test",
                "script": {
                    "type": "text/javascript",
                    "exec": base_tests(expected, tests),
                },
            }
        ],
    }
    if prerequest is not None:
        item["event"].append({
            "listen": "prerequest",
            "script": {
                "type": "text/javascript",
                "exec": [line for line in prerequest.splitlines()],
            },
        })
    if query:
        item["request"]["url"]["query"] = query
    if body is not None:
        item["request"]["body"] = {"mode": "raw", "raw": json.dumps(body, indent=2)}
    if formdata is not None:
        item["request"]["body"] = {"mode": "formdata", "formdata": formdata}
    if no_auth:
        item["auth"] = {"type": "noauth"}
    return item


def folder(name: str, items: list[dict], description: str = "") -> dict:
    return {"name": name, "description": description, "item": items}


LOGIN_SAVE_TOKEN = """
if (pm.response.code === 200) {
    const data = pm.response.json();
    if (data.access_token) {
        pm.environment.set("access_token", data.access_token);
        pm.collectionVariables.set("access_token", data.access_token);
    }
}
pm.test("access_token saved", function () {
    if (pm.response.code === 200) {
        pm.expect(pm.environment.get("access_token")).to.be.a("string").and.not.empty;
    }
});
"""

REGISTER_SAVE = """
if (pm.response.code === 200) {
    const data = pm.response.json();
    if (data.user_id) pm.environment.set("user_id", String(data.user_id));
    if (data.work_email) pm.environment.set("test_email", data.work_email);
}
"""

WHOAMI_SAVE = """
if (pm.response.code === 200) {
    const data = pm.response.json();
    if (data.id) pm.environment.set("user_id", String(data.id));
    if (data.role) pm.environment.set("current_role", data.role);
}
"""

ANALYSIS_SAVE = """
if (pm.response.code === 200) {
    const data = pm.response.json();
    const runId = data.analysis_run_id || data.run_id;
    if (runId) {
        pm.environment.set("analysis_run_id", String(runId));
        pm.collectionVariables.set("analysis_run_id", String(runId));
    }
    if (data.repo_id) pm.environment.set("repo_id", String(data.repo_id));
}
"""

POLL_ANALYSIS = """
if (pm.response.code === 200) {
    const data = pm.response.json();
    if (data.status) pm.environment.set("analysis_status", data.status);
    if (data.analysis_run_id) pm.environment.set("analysis_run_id", String(data.analysis_run_id));
}
pm.test("Analysis status is present", function () {
    if (pm.response.code === 200 && pm.response.json().status) {
        pm.expect(["pending", "running", "completed", "failed"]).to.include(pm.response.json().status);
    }
});
"""

# Pre-request guard: skip requests that depend on {{analysis_run_id}} when the
# variable is missing or is not a valid integer (e.g. still the default empty
# string or the literal "undefined" left over from an unresolved template).
SKIP_IF_NO_RUN_ID = """
const runId = pm.environment.get("analysis_run_id") || pm.collectionVariables.get("analysis_run_id");
if (!runId || isNaN(parseInt(runId, 10))) {
    console.warn("[skip] analysis_run_id not set — skipping " + pm.info.requestName);
    postman.setNextRequest(null);
}
"""


def build_collection() -> dict:
    pwd = "TestPass1!"
    items = [
        folder(
            "00 - Setup & Smoke",
            [
                req(
                    "OpenAPI schema",
                    "GET",
                    "/openapi.json",
                    no_auth=True,
                    expected=200,
                    description="Smoke test: API is running.",
                ),
                req(
                    "Register Developer",
                    "POST",
                    "/auth/register",
                    no_auth=True,
                    expected=[200, 400],
                    body={
                        "username": "{{dev_username}}",
                        "full_name": "Test Developer",
                        "work_email": "{{user_email}}",
                        "role": "developer",
                        "specialization": "backend",
                        "password": pwd,
                    },
                    tests=REGISTER_SAVE,
                    description="Creates a developer test account. 400 if username/email already exists.",
                ),
                req(
                    "Verify Email",
                    "POST",
                    "/auth/verify-email",
                    no_auth=True,
                    expected=[200, 400],
                    body={"work_email": "{{user_email}}", "code": "{{verification_code}}"},
                    description="Use the 6-digit code from email or database.",
                ),
                req(
                    "Login Developer",
                    "POST",
                    "/auth/login",
                    no_auth=True,
                    expected=[200, 401, 403],
                    body={"username": "{{dev_username}}", "password": pwd},
                    tests=LOGIN_SAVE_TOKEN,
                ),
            ],
            description="Run these first to confirm the API is up and obtain an access token.",
        ),
        folder(
            "01 - Auth",
            [
                req("Register Manager", "POST", "/auth/register", no_auth=True, expected=[200, 400], body={
                    "username": "{{mgr_username}}", "full_name": "Test Manager", "work_email": "{{mgr_email}}",
                    "role": "manager", "password": pwd,
                }, tests=REGISTER_SAVE),
                req("Register Recruiter", "POST", "/auth/register", no_auth=True, expected=[200, 400], body={
                    "username": "{{rec_username}}", "full_name": "Test Recruiter", "work_email": "{{rec_email}}",
                    "role": "recruiter", "password": pwd,
                }, tests=REGISTER_SAVE),
                req("Login Manager", "POST", "/auth/login", no_auth=True, expected=[200, 401, 403],
                    body={"username": "{{mgr_username}}", "password": pwd}, tests=LOGIN_SAVE_TOKEN),
                req("Login Recruiter", "POST", "/auth/login", no_auth=True, expected=[200, 401, 403],
                    body={"username": "{{rec_username}}", "password": pwd}, tests=LOGIN_SAVE_TOKEN),
                req("Whoami Full", "GET", "/auth/whoami-full", expected=200),
                req("Refresh Token", "POST", "/auth/refresh", no_auth=True, expected=[200, 401],
                    description="Requires refresh_token cookie from login."),
                req("Forgot Password", "POST", "/auth/forgot-password", no_auth=True, expected=[200, 404],
                    body={"email": "{{user_email}}"}),
                req("Reset Password", "POST", "/auth/reset-password", no_auth=True, expected=[200, 400],
                    body={"token": "{{reset_token}}", "new_password": "NewPass1!"}),
                req("Complete Profile", "PATCH", "/auth/complete-profile", expected=[200, 422],
                    body={"role": "developer", "specialization": "backend"}),
                req("Logout", "POST", "/auth/logout", no_auth=True, expected=[200, 401]),
            ],
        ),
        folder(
            "02 - Analysis (Developer)",
            [
                req("Run Analysis", "POST", "/analysis/run", expected=[200, 403, 422],
                    body={
                        "repo_url": "{{repo_url}}",
                        "branch": "{{branch}}",
                        "programming_language": "python",
                        "auto_detect_requirements_coverage": False,
                    }, tests=ANALYSIS_SAVE,
                    description="Requires GitHub linked for developer contribution scope."),
                req(
                    "Run Analysis With Coverage",
                    "POST",
                    "/analysis/run/with-coverage",
                    expected=[200, 403, 422],
                    formdata=[
                        {"key": "repo_url", "value": "{{repo_url}}", "type": "text"},
                        {"key": "branch", "value": "{{branch}}", "type": "text"},
                        {"key": "programming_language", "value": "python", "type": "text"},
                        {"key": "auto_detect_requirements_coverage", "value": "false", "type": "text"},
                        {"key": "coverage_file", "type": "file", "src": "sample-coverage.xml", "description": "JaCoCo/Cobertura XML"},
                    ],
                    tests=ANALYSIS_SAVE,
                    description="Attach a coverage XML file in Postman before sending.",
                ),
                req("Get Analysis Status", "GET", "/analysis/{{analysis_run_id}}", expected=[200, 404],
                    prerequest=SKIP_IF_NO_RUN_ID, tests=POLL_ANALYSIS),
                req("Analysis History", "GET", "/analysis/history", expected=200,
                    query=[{"key": "limit", "value": "10"}]),
                req("Detailed Metrics", "GET", "/analysis/{{analysis_run_id}}/detailed-metrics",
                    expected=[200, 404], prerequest=SKIP_IF_NO_RUN_ID),
                req("Learning Recommendations", "GET", "/analysis/{{analysis_run_id}}/learning-recommendations",
                    expected=[200, 404], prerequest=SKIP_IF_NO_RUN_ID),
                req("Sonar Dashboard", "GET", "/analysis/{{analysis_run_id}}/sonar-dashboard",
                    expected=[200, 404], prerequest=SKIP_IF_NO_RUN_ID),
                req("Sonar Results", "GET", "/analysis/{{analysis_run_id}}/sonar-results",
                    expected=[200, 404], prerequest=SKIP_IF_NO_RUN_ID,
                    query=[{"key": "include_raw", "value": "false"}]),
                req("Skills Summary", "GET", "/analysis/skills/summary", expected=200),
                req("Profile Dashboard", "GET", "/analysis/profile-dashboard", expected=200),
                req("Update Analysis Profile", "PATCH", "/analysis/profile", expected=200,
                    body={"organization": "SkillPulse QA", "job_title": "Backend Developer"}),
            ],
        ),
        folder(
            "03 - Security Report",
            [
                req("Get Security Report", "GET", "/security-report/{{analysis_run_id}}",
                    expected=[200, 404], prerequest=SKIP_IF_NO_RUN_ID,
                    description="Returns Bandit/Semgrep/Safety/Gitleaks findings and score breakdown."),
            ],
        ),
        folder(
            "04 - Repositories",
            [
                req("Connected Repos", "GET", "/repos/connected", expected=200),
                req("Disconnect Analysis", "DELETE", "/repos/disconnect-analysis/{{analysis_run_id}}",
                    expected=[200, 404], prerequest=SKIP_IF_NO_RUN_ID),
                req("Disconnect Repo", "DELETE", "/repos/disconnect/{{repo_id}}", expected=[200, 404]),
            ],
        ),
        folder(
            "05 - Profile",
            [
                req("Get Profile", "GET", "/profile", expected=200),
                req("Update Profile", "PATCH", "/profile", expected=200,
                    body={"full_name": "Updated Name", "organization": "SkillPulse"}),
                req("Set Password Request Code", "POST", "/profile/set-password/request-code", expected=[200, 400]),
                req("Change Password Request Code", "POST", "/profile/change-password/request-code", expected=[200, 400],
                    body={"current_password": pwd}),
            ],
        ),
        folder(
            "06 - Manager Dashboard",
            [
                req("Overview", "GET", "/manager/dashboard/overview", expected=[200, 403],
                    query=[{"key": "trend_granularity", "value": "monthly"}]),
                req("Repos", "GET", "/manager/dashboard/repos", expected=[200, 403]),
                req("KPIs", "GET", "/manager/dashboard/kpis", expected=[200, 403]),
                req("Trends", "GET", "/manager/dashboard/trends", expected=[200, 403]),
                req("Skills Distribution", "GET", "/manager/dashboard/skills", expected=[200, 403]),
                req("Team Insights", "GET", "/manager/dashboard/insights", expected=[200, 403]),
                req("Team Members", "GET", "/manager/dashboard/members", expected=[200, 403]),
                req("Member Details", "GET", "/manager/dashboard/members/{{user_id}}/details", expected=[200, 403, 404]),
            ],
            description="Use manager token (login as manager first).",
        ),
        folder(
            "07 - Manager Security",
            [
                req("Security Repos", "GET", "/manager/security/repos", expected=[200, 403]),
                req("Team Security Overview", "GET", "/manager/security/team", expected=[200, 403]),
                req("Repository Risk", "GET", "/manager/security/repository-risk", expected=[200, 403]),
                req("Repo Security Detail", "GET", "/manager/security/repositories/{{repo_id}}", expected=[200, 403, 404]),
            ],
        ),
        folder(
            "08 - Manager Profile",
            [
                req("Get Manager Profile", "GET", "/manager/profile", expected=[200, 403]),
                req("Team Overview", "GET", "/manager/profile/team-overview", expected=[200, 403]),
                req("Activities", "GET", "/manager/profile/activities", expected=[200, 403],
                    query=[{"key": "limit", "value": "6"}]),
            ],
        ),
        folder(
            "09 - Requirements",
            [
                req(
                    "Upload PRD",
                    "POST",
                    "/requirements/upload",
                    expected=[200, 403, 422],
                    formdata=[
                        {"key": "file", "type": "file", "src": "sample-prd.txt", "description": "PDF/MD/TXT/XLSX/CSV"},
                        {"key": "repository_id", "value": "{{repo_id}}", "type": "text"},
                    ],
                    description="Manager only. Attach a PRD file before sending.",
                ),
                req("List Repositories", "GET", "/requirements/repositories", expected=200),
                req("Requirements State", "GET", "/requirements/repositories/{{repo_id}}/requirements-state", expected=[200, 404]),
                req("Repo Stories", "GET", "/requirements/repositories/{{repo_id}}/stories", expected=[200, 404]),
                req("Analysis Readiness", "GET", "/requirements/repositories/{{repo_id}}/analysis-readiness", expected=[200, 404]),
                req("Contributors", "GET", "/requirements/repositories/{{repo_id}}/contributors", expected=[200, 404]),
                req("Sync Contributors", "POST", "/requirements/repositories/{{repo_id}}/sync-contributors", expected=[200, 403, 404]),
                req("Developer Assigned Repos", "GET", "/requirements/repositories/developer/assigned", expected=200),
                req("Developer Repo Tasks", "GET", "/requirements/repositories/{{repo_id}}/developer", expected=[200, 404]),
                req("Document Stories", "GET", "/requirements/{{doc_id}}/stories", expected=[200, 404]),
                req("Confirm Requirements", "POST", "/requirements/{{doc_id}}/confirm", expected=[200, 403, 404]),
            ],
            description="Upload PRD via multipart in Postman manually: POST /requirements/upload",
        ),
        folder(
            "10 - Requirement Coverage",
            [
                req("Detect Coverage", "POST", "/requirements/coverage/repositories/{{repo_id}}/detect", expected=[200, 403, 404]),
                req("Coverage Dashboard", "GET", "/requirements/coverage/repositories/{{repo_id}}", expected=[200, 404]),
                req("Coverage Runs", "GET", "/requirements/coverage/repositories/{{repo_id}}/runs", expected=[200, 403, 404]),
                req("Coverage Run Detail", "GET", "/requirements/coverage/runs/{{coverage_run_id}}", expected=[200, 404]),
                req("Refresh Ownership", "POST", "/requirements/coverage/repositories/{{repo_id}}/refresh-ownership", expected=[200, 403, 404]),
                req("Developer Coverage", "GET", "/requirements/coverage/repositories/{{repo_id}}/developer", expected=[200, 404]),
            ],
        ),
        folder(
            "11 - Recruiter",
            [
                req(
                    "Bulk Analyze Preview",
                    "POST",
                    "/api/recruiter/bulk-analyze/preview",
                    expected=[200, 403, 422],
                    formdata=[
                        {"key": "file", "type": "file", "src": "sample-candidates.csv", "description": "CSV or XLSX"},
                    ],
                ),
                req(
                    "Bulk Analyze Confirm",
                    "POST",
                    "/api/recruiter/bulk-analyze/confirm",
                    expected=[200, 403, 422],
                    body={
                        "candidates": [
                            {"candidate_name": "Jane Doe", "repo_url": "{{repo_url}}", "branch": "{{branch}}"}
                        ],
                        "force_reanalyze": False,
                        "title": "QA Batch",
                    },
                ),
                req("Recruiter Profile", "GET", "/recruiter/profile", expected=[200, 403]),
                req("Eval Settings", "PATCH", "/recruiter/eval-settings", expected=[200, 403],
                    body={"security_score_visible": True, "weight_security": 20}),
                req("Profile Dashboard", "GET", "/recruiter/profile-dashboard", expected=[200, 403]),
                req("Recruiter Tasks", "GET", "/analysis/recruiter/tasks", expected=[200, 403]),
                req("Recruiter Candidates", "GET", "/analysis/recruiter/candidates", expected=[200, 403]),
                req("Dashboard Summary", "GET", "/analysis/recruiter/dashboard-summary", expected=[200, 403]),
                req("Candidate Insights", "GET", "/analysis/recruiter/candidate-insights/{{analysis_run_id}}",
                    expected=[200, 403, 404], prerequest=SKIP_IF_NO_RUN_ID),
                req("Delete Candidate Analysis", "DELETE", "/analysis/recruiter/candidates/{{analysis_run_id}}",
                    expected=[200, 403, 404], prerequest=SKIP_IF_NO_RUN_ID),
            ],
        ),
    ]

    return {
        "info": {
            "_postman_id": uid(),
            "name": "Skill-Pulse API Tests",
            "description": (
                "Complete Postman test suite for Skill-Pulse.\n\n"
                "## Setup\n"
                "1. Import `Skill-Pulse-Local.postman_environment.json`\n"
                "2. Start backend: `uvicorn app.main:app --reload` from `backend/`\n"
                "3. Run folder **00 - Setup & Smoke** (set verification_code from email/DB)\n"
                "4. For role-specific tests, login as manager/recruiter and re-run those folders\n\n"
                "## Variables\n"
                "Set `repo_url`, `branch`, `analysis_run_id`, `repo_id` in environment after analysis.\n\n"
                "## Notes\n"
                "- Analysis runs are async: poll **Get Analysis Status** until status=completed\n"
                "- Developer analysis needs GitHub connected + Python contributions\n"
                "- Manager analysis needs registered team developers on the repo"
            ),
            "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        },
        "auth": {
            "type": "bearer",
            "bearer": [{"key": "token", "value": "{{access_token}}", "type": "string"}],
        },
        "event": [
            {
                "listen": "prerequest",
                "script": {
                    "type": "text/javascript",
                    "exec": [
                        "// Collection-level: ensure base_url is set",
                        "if (!pm.environment.get('base_url')) {",
                        "    pm.environment.set('base_url', 'http://localhost:8000');",
                        "}",
                    ],
                },
            },
        ],
        "variable": [
            {"key": "base_url", "value": "http://localhost:8000"},
            {"key": "access_token", "value": ""},
            {"key": "analysis_run_id", "value": "1"},
            {"key": "repo_id", "value": "1"},
            {"key": "doc_id", "value": "1"},
            {"key": "coverage_run_id", "value": "1"},
            {"key": "dev_username", "value": "dev_tester"},
            {"key": "user_email", "value": "dev_tester@example.com"},
            {"key": "mgr_username", "value": "mgr_tester"},
            {"key": "mgr_email", "value": "mgr_tester@example.com"},
            {"key": "rec_username", "value": "rec_tester"},
            {"key": "rec_email", "value": "rec_tester@example.com"},
            {"key": "repo_url", "value": "https://github.com/octocat/Hello-World"},
            {"key": "branch", "value": "master"},
            {"key": "verification_code", "value": "000000"},
        ],
        "item": items,
    }


def build_environment() -> dict:
    return {
        "id": uid(),
        "name": "Skill-Pulse Local",
        "values": [
            {"key": "base_url", "value": "http://localhost:8000", "enabled": True},
            {"key": "access_token", "value": "", "enabled": True},
            {"key": "refresh_token", "value": "", "enabled": True},
            {"key": "user_id", "value": "", "enabled": True},
            {"key": "current_role", "value": "", "enabled": True},
            {"key": "analysis_run_id", "value": "", "enabled": True},
            {"key": "analysis_status", "value": "", "enabled": True},
            {"key": "repo_id", "value": "", "enabled": True},
            {"key": "doc_id", "value": "", "enabled": True},
            {"key": "coverage_run_id", "value": "", "enabled": True},
            {"key": "task_id", "value": "", "enabled": True},
            {"key": "dev_username", "value": "dev_tester", "enabled": True},
            {"key": "user_email", "value": "dev_tester@example.com", "enabled": True},
            {"key": "mgr_username", "value": "mgr_tester", "enabled": True},
            {"key": "mgr_email", "value": "mgr_tester@example.com", "enabled": True},
            {"key": "rec_username", "value": "rec_tester", "enabled": True},
            {"key": "rec_email", "value": "rec_tester@example.com", "enabled": True},
            {"key": "repo_url", "value": "https://github.com/octocat/Hello-World", "enabled": True},
            {"key": "branch", "value": "master", "enabled": True},
            {"key": "verification_code", "value": "000000", "enabled": True},
            {"key": "reset_token", "value": "", "enabled": True},
            {"key": "test_email", "value": "", "enabled": True},
        ],
        "_postman_variable_scope": "environment",
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    collection_path = OUT_DIR / "Skill-Pulse-API.postman_collection.json"
    env_path = OUT_DIR / "Skill-Pulse-Local.postman_environment.json"
    collection_path.write_text(json.dumps(build_collection(), indent=2), encoding="utf-8")
    env_path.write_text(json.dumps(build_environment(), indent=2), encoding="utf-8")
    print(f"Wrote {collection_path}")
    print(f"Wrote {env_path}")


if __name__ == "__main__":
    main()
