from __future__ import annotations

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def _add_column_if_missing(engine: Engine, table: str, column: str, ddl_type: str) -> None:
    insp = inspect(engine)
    if table not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns(table)}
    if column in existing:
        return
    ddl = f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"
    with engine.begin() as conn:
        conn.execute(text(ddl))
    logger.info("Added missing column %s.%s", table, column)


def ensure_maps_business_geo_columns(engine: Engine) -> None:
    """
    This project uses `create_all()` for schema creation in dev mode, which does not
    add new columns for existing tables. Ensure the minimal columns we rely on exist.
    """
    _add_column_if_missing(engine, "maps_businesses", "latitude", "FLOAT")
    _add_column_if_missing(engine, "maps_businesses", "longitude", "FLOAT")


def ensure_maps_business_ai_columns(engine: Engine) -> None:
    """Add AI scoring columns to maps_businesses if they don't exist yet."""
    _add_column_if_missing(engine, "maps_businesses", "ai_confidence", "FLOAT")
    _add_column_if_missing(engine, "maps_businesses", "ai_type", "VARCHAR(100)")
    _add_column_if_missing(engine, "maps_businesses", "lead_score", "FLOAT")
    # Postgres does not have a DATETIME type (use TIMESTAMP).
    # SQLite will accept both; keep DATETIME there for readability.
    ts_type = "TIMESTAMP" if engine.dialect.name in ("postgresql", "postgres") else "DATETIME"
    _add_column_if_missing(engine, "maps_businesses", "ai_last_updated", ts_type)
