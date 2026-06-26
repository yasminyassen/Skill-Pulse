"""add sonar issue location fields

Revision ID: n1o2p3q4r5s6
Revises: m1n2o3p4q5r6
Create Date: 2026-06-26 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "n1o2p3q4r5s6"
down_revision: Union[str, None] = "m1n2o3p4q5r6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _column_exists(table_name: str, column_name: str) -> bool:
    if not _table_exists(table_name):
        return False
    return column_name in {
        column["name"]
        for column in sa.inspect(op.get_bind()).get_columns(table_name)
    }


def _add_column_if_missing(table_name: str, column: sa.Column) -> None:
    if _table_exists(table_name) and not _column_exists(table_name, column.name):
        op.add_column(table_name, column)


def upgrade() -> None:
    _add_column_if_missing("sonar_issues", sa.Column("start_line", sa.Integer(), nullable=True))
    _add_column_if_missing("sonar_issues", sa.Column("end_line", sa.Integer(), nullable=True))
    _add_column_if_missing("sonar_issues", sa.Column("start_column", sa.Integer(), nullable=True))
    _add_column_if_missing("sonar_issues", sa.Column("end_column", sa.Integer(), nullable=True))


def downgrade() -> None:
    for column_name in ("end_column", "start_column", "end_line", "start_line"):
        if _column_exists("sonar_issues", column_name):
            op.drop_column("sonar_issues", column_name)
