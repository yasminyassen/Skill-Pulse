"""drop legacy shared-only tables

Revision ID: o1p2q3r4s5t6
Revises: n1o2p3q4r5s6
Create Date: 2026-06-26 00:00:00.000000

The shared database kept several legacy tables that are no longer mapped by
the application models. Drop only those obsolete tables so shared and local
schemas converge on the current Alembic/model schema.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "o1p2q3r4s5t6"
down_revision: Union[str, None] = "n1o2p3q4r5s6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


LEGACY_TABLES = (
    "recruiter_tasks",
    "quality_findings",
    "quality_metrics",
    "links",
)


def upgrade() -> None:
    for table_name in LEGACY_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table_name}" CASCADE')


def downgrade() -> None:
    pass
