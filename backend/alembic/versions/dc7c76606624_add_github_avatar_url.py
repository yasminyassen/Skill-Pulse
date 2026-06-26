"""repair recruiter candidate github avatar url

Revision ID: dc7c76606624
Revises: s1t2u3v4w5x6
Create Date: 2026-06-26 06:53:23.740783

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# revision identifiers, used by Alembic.
revision: str = 'dc7c76606624'
down_revision: Union[str, None] = 's1t2u3v4w5x6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if not inspector.has_table("recruiter_candidates"):
        return

    columns = {column["name"] for column in inspector.get_columns("recruiter_candidates")}
    if "github_avatar_url" not in columns:
        op.add_column("recruiter_candidates", sa.Column("github_avatar_url", sa.String(), nullable=True))


def downgrade() -> None:
    pass
