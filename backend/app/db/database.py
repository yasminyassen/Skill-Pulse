from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings
#from app.core.request_context import increment_query_count

# SQLAlchemy engine tuned for hosted PostgreSQL providers such as Neon.
# pool_pre_ping checks a connection before using it, so stale/closed SSL
# connections are discarded instead of failing during db.commit().
# pool_recycle refreshes connections periodically to avoid server-side idle closes.
# engine = create_engine(
#     settings.DATABASE_URL,
#     pool_pre_ping=True,
#     pool_recycle=300,
#     pool_size=5,
#     max_overflow=10,
#     pool_timeout=30,
#     connect_args={
#         "sslmode": "require",
#         "connect_timeout": 10,
#         "keepalives": 1,
#         "keepalives_idle": 30,
#         "keepalives_interval": 10,
#         "keepalives_count": 5,
#     },
# )

connect_args = {
    "connect_timeout": 10,
    "keepalives": 1,
    "keepalives_idle": 30,
    "keepalives_interval": 10,
    "keepalives_count": 5,
}

if "neon.tech" in settings.DATABASE_URL:
    connect_args["sslmode"] = "require"

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=300,
    pool_size=5,
    max_overflow=10,
    pool_timeout=30,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


# @event.listens_for(engine, "before_cursor_execute")
# def _count_sql_query(conn, cursor, statement, parameters, context, executemany):
#     increment_query_count()


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
