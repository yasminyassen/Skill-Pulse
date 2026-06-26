"""repair sonar schema

Revision ID: q1r2s3t4u5v6
Revises: p1q2r3s4t5u6
Create Date: 2026-06-26 00:00:00.000000

Some databases were stamped past the Sonar migrations without the Sonar
tables. Create the current Sonar schema if it is missing.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "q1r2s3t4u5v6"
down_revision: Union[str, None] = "p1q2r3s4t5u6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _table_exists(table_name: str) -> bool:
    return table_name in _inspector().get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return column_name in {column["name"] for column in _inspector().get_columns(table_name)}


def _index_exists(table_name: str, index_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return index_name in {index["name"] for index in _inspector().get_indexes(table_name)}


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if _table_exists(table_name) and not _column_exists(table_name, column.name):
        op.add_column(table_name, column)


def _create_index_if_missing(index_name: str, table_name: str, columns: list[str]) -> None:
    if _table_exists(table_name) and not _index_exists(table_name, index_name):
        op.create_index(index_name, table_name, columns)


def _create_sonar_analysis_summaries() -> None:
    if _table_exists("sonar_analysis_summaries"):
        return

    op.create_table(
        "sonar_analysis_summaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("analysis_run_id", sa.Integer(), sa.ForeignKey("analysis_runs.id"), nullable=False, unique=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("project_key", sa.String(), nullable=True),
        sa.Column("quality_gate", sa.String(), nullable=True),
        sa.Column("sonar_health_score", sa.Float(), nullable=True),
        sa.Column("measures", sa.JSON(), nullable=True),
        sa.Column("coverage", sa.JSON(), nullable=True),
        sa.Column("scanner", sa.JSON(), nullable=True),
        sa.Column("ce_task", sa.JSON(), nullable=True),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )


def _create_sonar_file_measures() -> None:
    if _table_exists("sonar_file_measures"):
        return

    op.create_table(
        "sonar_file_measures",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("analysis_run_id", sa.Integer(), sa.ForeignKey("analysis_runs.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("file_path", sa.String(), nullable=False),
        sa.Column("measures", sa.JSON(), nullable=True),
        sa.Column("coverage", sa.Float(), nullable=True),
        sa.Column("duplicated_lines", sa.Float(), nullable=True),
        sa.Column("duplicated_lines_density", sa.Float(), nullable=True),
        sa.Column("ncloc", sa.Float(), nullable=True),
        sa.Column("complexity", sa.Float(), nullable=True),
        sa.Column("cognitive_complexity", sa.Float(), nullable=True),
        sa.Column("functions", sa.Float(), nullable=True),
        sa.Column("classes", sa.Float(), nullable=True),
        sa.Column("statements", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )


def _create_sonar_issues() -> None:
    if _table_exists("sonar_issues"):
        return

    op.create_table(
        "sonar_issues",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("analysis_run_id", sa.Integer(), sa.ForeignKey("analysis_runs.id"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("issue_key", sa.String(), nullable=True),
        sa.Column("file_path", sa.String(), nullable=True),
        sa.Column("line", sa.Integer(), nullable=True),
        sa.Column("start_line", sa.Integer(), nullable=True),
        sa.Column("end_line", sa.Integer(), nullable=True),
        sa.Column("start_column", sa.Integer(), nullable=True),
        sa.Column("end_column", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(), nullable=True),
        sa.Column("severity", sa.String(), nullable=True),
        sa.Column("rule", sa.String(), nullable=True),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("status", sa.String(), nullable=True),
        sa.Column("raw_issue", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )


def upgrade() -> None:
    _add_column_if_missing("skill_scores", sa.Column("sonar_health_score", sa.Float(), nullable=True))

    _create_sonar_analysis_summaries()
    _create_sonar_file_measures()
    _create_sonar_issues()

    _add_column_if_missing("sonar_issues", sa.Column("start_line", sa.Integer(), nullable=True))
    _add_column_if_missing("sonar_issues", sa.Column("end_line", sa.Integer(), nullable=True))
    _add_column_if_missing("sonar_issues", sa.Column("start_column", sa.Integer(), nullable=True))
    _add_column_if_missing("sonar_issues", sa.Column("end_column", sa.Integer(), nullable=True))

    _create_index_if_missing("ix_sonar_analysis_summaries_id", "sonar_analysis_summaries", ["id"])
    _create_index_if_missing(
        "ix_sonar_analysis_summaries_analysis_run_id",
        "sonar_analysis_summaries",
        ["analysis_run_id"],
    )
    _create_index_if_missing("ix_sonar_file_measures_id", "sonar_file_measures", ["id"])
    _create_index_if_missing(
        "ix_sonar_file_measures_analysis_run_id",
        "sonar_file_measures",
        ["analysis_run_id"],
    )
    _create_index_if_missing("ix_sonar_issues_id", "sonar_issues", ["id"])
    _create_index_if_missing("ix_sonar_issues_analysis_run_id", "sonar_issues", ["analysis_run_id"])


def downgrade() -> None:
    op.drop_index("ix_sonar_issues_analysis_run_id", table_name="sonar_issues")
    op.drop_index("ix_sonar_issues_id", table_name="sonar_issues")
    op.drop_table("sonar_issues")
    op.drop_index("ix_sonar_file_measures_analysis_run_id", table_name="sonar_file_measures")
    op.drop_index("ix_sonar_file_measures_id", table_name="sonar_file_measures")
    op.drop_table("sonar_file_measures")
    op.drop_index("ix_sonar_analysis_summaries_analysis_run_id", table_name="sonar_analysis_summaries")
    op.drop_index("ix_sonar_analysis_summaries_id", table_name="sonar_analysis_summaries")
    op.drop_table("sonar_analysis_summaries")
