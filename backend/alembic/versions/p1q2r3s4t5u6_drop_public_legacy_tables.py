"""drop public legacy tables

Revision ID: p1q2r3s4t5u6
Revises: o1p2q3r4s5t6
Create Date: 2026-06-26 00:00:00.000000

Follow-up cleanup using explicit public schema qualification.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "p1q2r3s4t5u6"
down_revision: Union[str, None] = "o1p2q3r4s5t6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('DROP TABLE IF EXISTS public."recruiter_tasks" CASCADE')
    op.execute('DROP TABLE IF EXISTS public."quality_findings" CASCADE')
    op.execute('DROP TABLE IF EXISTS public."quality_metrics" CASCADE')
    op.execute('DROP TABLE IF EXISTS public."links" CASCADE')


def downgrade() -> None:
    pass
