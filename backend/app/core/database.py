from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base

from .config import settings

# SQLite with aiosqlite for async
engine = create_async_engine(
    settings.database_url,
    echo=settings.debug,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

        # Idempotent schema evolution (FR-029). create_all adds NEW tables
        # but does NOT add new columns to existing tables. Reviewers
        # upgrading across features (001 -> 002 -> 003) keep a populated
        # DB — add missing columns here. Each ALTER is PRAGMA-guarded so
        # repeat runs no-op.
        def _probe_and_alter(sync_conn):
            posts_cols = {
                row[1]
                for row in sync_conn.exec_driver_sql(
                    "PRAGMA table_info(posts)"
                ).fetchall()
            }
            # 002 additions
            if "series_id" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN series_id INTEGER "
                    "REFERENCES series(id)"
                )
            if "series_position" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN series_position INTEGER"
                )
            # 003 additions
            if "body" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN body TEXT"
                )
            if "published_url" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN published_url VARCHAR(1024)"
                )
            if "stage" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN stage VARCHAR(32)"
                )
            if "previous_status" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN previous_status VARCHAR(32)"
                )
            # 006 additions — failure annotation columns for auto-publish.
            if "last_publish_attempt_at" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN last_publish_attempt_at DATETIME"
                )
            if "last_publish_error" not in posts_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE posts ADD COLUMN last_publish_error VARCHAR(64)"
                )

            series_cols = {
                row[1]
                for row in sync_conn.exec_driver_sql(
                    "PRAGMA table_info(series)"
                ).fetchall()
            }
            if "status" not in series_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE series ADD COLUMN status VARCHAR(32) "
                    "NOT NULL DEFAULT 'active'"
                )
            if "previous_status" not in series_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE series ADD COLUMN previous_status VARCHAR(32)"
                )
            # 004 additions
            if "family_id" not in series_cols:
                sync_conn.exec_driver_sql(
                    "ALTER TABLE series ADD COLUMN family_id INTEGER "
                    "REFERENCES series(id)"
                )
                # One-shot backfill so every legacy row is its own singleton
                # family. Safe to run once per deployment — subsequent boots
                # skip the ALTER (guarded above) and re-running the UPDATE
                # would no-op because the column is then non-NULL everywhere.
                sync_conn.exec_driver_sql(
                    "UPDATE series SET family_id = id WHERE family_id IS NULL"
                )

        await conn.run_sync(_probe_and_alter)
