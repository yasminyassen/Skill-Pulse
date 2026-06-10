"""add password reset fields

Revision ID: b7c8d9e0f1a2
Revises: a1b2c3d4e5f6
Create Date: 2026-06-10 12:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b7c8d9e0f1a2'
down_revision: Union[str, None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('reset_password_token', sa.String(), nullable=True))
    op.add_column('users', sa.Column('reset_password_expires_at', sa.DateTime(timezone=True), nullable=True))
    op.create_index(
        'ix_users_reset_password_token',
        'users',
        ['reset_password_token'],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index('ix_users_reset_password_token', table_name='users')
    op.drop_column('users', 'reset_password_expires_at')
    op.drop_column('users', 'reset_password_token')
