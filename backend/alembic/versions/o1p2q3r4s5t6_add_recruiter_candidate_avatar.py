"""add recruiter candidate avatar url

Revision ID: s1t2u3v4w5x6
Revises: r1s2t3u4v5w6
Create Date: 2026-06-26 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "s1t2u3v4w5x6"
down_revision: Union[str, None] = "r1s2t3u4v5w6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if inspector.has_table("recruiter_candidates"):
        columns = {column["name"] for column in inspector.get_columns("recruiter_candidates")}
        if "github_avatar_url" not in columns:
            op.add_column("recruiter_candidates", sa.Column("github_avatar_url", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    if inspector.has_table("recruiter_candidates"):
        columns = {column["name"] for column in inspector.get_columns("recruiter_candidates")}
        if "github_avatar_url" in columns:
            op.drop_column("recruiter_candidates", "github_avatar_url")
