"""allow multiple sonar summaries per team run

Revision ID: u1v2w3x4y5z6
Revises: t1u2v3w4x5y6
Create Date: 2026-06-27 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "u1v2w3x4y5z6"
down_revision: Union[str, None] = "t1u2v3w4x5y6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _inspector() -> sa.Inspector:
    return sa.inspect(op.get_bind())


def _unique_constraint_exists(table_name: str, constraint_name: str) -> bool:
    return constraint_name in {
        constraint["name"]
        for constraint in _inspector().get_unique_constraints(table_name)
    }


def upgrade() -> None:
    if _unique_constraint_exists(
        "sonar_analysis_summaries",
        "sonar_analysis_summaries_analysis_run_id_key",
    ):
        op.drop_constraint(
            "sonar_analysis_summaries_analysis_run_id_key",
            "sonar_analysis_summaries",
            type_="unique",
        )

    if not _unique_constraint_exists(
        "sonar_analysis_summaries",
        "uq_sonar_analysis_summary_run_user",
    ):
        op.create_unique_constraint(
            "uq_sonar_analysis_summary_run_user",
            "sonar_analysis_summaries",
            ["analysis_run_id", "user_id"],
        )


def downgrade() -> None:
    if _unique_constraint_exists(
        "sonar_analysis_summaries",
        "uq_sonar_analysis_summary_run_user",
    ):
        op.drop_constraint(
            "uq_sonar_analysis_summary_run_user",
            "sonar_analysis_summaries",
            type_="unique",
        )

    if not _unique_constraint_exists(
        "sonar_analysis_summaries",
        "sonar_analysis_summaries_analysis_run_id_key",
    ):
        op.create_unique_constraint(
            "sonar_analysis_summaries_analysis_run_id_key",
            "sonar_analysis_summaries",
            ["analysis_run_id"],
        )
