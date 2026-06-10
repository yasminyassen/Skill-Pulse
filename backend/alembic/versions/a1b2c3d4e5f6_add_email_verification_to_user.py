"""add email verification to user

Revision ID: a1b2c3d4e5f6
Revises: 5f6df26da71b, c6fe7e863631
Create Date: 2026-06-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, None] = ('5f6df26da71b', 'c6fe7e863631')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_verified', sa.Boolean(), nullable=False, server_default=sa.text('true')))
    op.add_column('users', sa.Column('verification_code', sa.String(), nullable=True))
    op.alter_column('users', 'is_verified', server_default=None)


def downgrade() -> None:
    op.drop_column('users', 'verification_code')
    op.drop_column('users', 'is_verified')
