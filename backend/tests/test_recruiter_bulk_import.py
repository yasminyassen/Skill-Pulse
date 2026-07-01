import os
from types import SimpleNamespace

import pandas as pd
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/skillpulse_test")
os.environ.setdefault("SECRET_KEY", "test-secret-key")

from app.api.recruiter_bulk import BulkRepository, _apply_bulk_task_status  # noqa: E402
from app.services.recruiter_bulk_import import parse_candidate_rows_from_dataframe, parse_candidate_upload  # noqa: E402


def test_parse_csv_upload_with_flexible_headers() -> None:
    content = (
        "Candidate,GitHub URL,branch\n"
        "Alice,https://github.com/acme/book-api-alice,main\n"
        "Bob,acme/book-api-bob,main\n"
    ).encode("utf-8")

    rows, skipped = parse_candidate_upload("candidates.csv", content)

    assert len(rows) == 2
    assert skipped == []
    assert rows[0]["candidate_name"] == "Alice"
    assert rows[0]["full_name"] == "acme/book-api-alice"
    assert rows[1]["full_name"] == "acme/book-api-bob"


def test_parse_dataframe_reports_invalid_rows() -> None:
    df = pd.DataFrame([
        {"candidate_name": "Alice", "repo_url": "not-a-url"},
    ])

    rows, skipped = parse_candidate_rows_from_dataframe(df)
    assert rows == []
    assert len(skipped) == 1


def test_parse_upload_requires_required_columns() -> None:
    content = b"name only\nAlice\n"
    with pytest.raises(ValueError, match="does not match the required format"):
        parse_candidate_upload("bad.csv", content)


def _repo(from_cache: bool) -> BulkRepository:
    return BulkRepository(
        candidate="Alice",
        repo_name="book-api",
        html_url="https://github.com/acme/book-api",
        default_branch="main",
        analysis_source="cache" if from_cache else "scheduled",
    )


def test_cached_bulk_results_complete_task_without_mutating_history() -> None:
    task = SimpleNamespace(valid_count=2, status="analyzing")

    scheduled_count = _apply_bulk_task_status(task, [_repo(True), _repo(True)])

    assert scheduled_count == 0
    assert task.status == "completed"


def test_mixed_bulk_results_remain_analyzing_until_scheduled_runs_finish() -> None:
    task = SimpleNamespace(valid_count=2, status="analyzing")

    scheduled_count = _apply_bulk_task_status(task, [_repo(True), _repo(False)])

    assert scheduled_count == 1
    assert task.status == "analyzing"
