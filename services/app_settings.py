"""Persisted JSON settings (maps defaults, export, business info, last scrape)."""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from sqlalchemy.orm import Session

import models

logger = logging.getLogger(__name__)

DEFAULT_MAPS_DEFAULTS: dict[str, Any] = {
    "default_radius_km": 15,
    "categories": {
        "restaurants": True,
        "lodging": True,
        "bar": True,
        "cafe": True,
    },
}

DEFAULT_EXPORT_PREFS: dict[str, Any] = {
    "default_format": "csv",
    "default_columns": [
        "name",
        "phone",
        "status",
        "region",
        "created_at",
    ],
    "auto_backup_schedule": "weekly",
}

DEFAULT_BUSINESS_INFO: dict[str, Any] = {
    "business_name": "",
    "phone": "",
    "whatsapp": "",
    "email": "",
    "address": "",
    "revenue_display": "",
}


def _load_json(raw: str | None) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _dump_json(data: dict[str, Any]) -> str:
    return json.dumps(data, ensure_ascii=False)


def get_setting_dict(db: Session, key: str, default: dict[str, Any]) -> dict[str, Any]:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if not row:
        return dict(default)
    merged = dict(default)
    merged.update(_load_json(row.value_json))
    return merged


def set_setting_dict(db: Session, key: str, data: dict[str, Any]) -> None:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == key).first()
    if row:
        row.value_json = _dump_json(data)
    else:
        db.add(models.AppSetting(key=key, value_json=_dump_json(data)))
    db.commit()


def merge_setting_dict(
    db: Session, key: str, partial: dict[str, Any], default: dict[str, Any]
) -> dict[str, Any]:
    current = get_setting_dict(db, key, default)
    for k, v in partial.items():
        if v is None:
            continue
        if k == "categories" and isinstance(v, dict) and isinstance(
            current.get("categories"), dict
        ):
            current["categories"].update(v)
        else:
            current[k] = v
    set_setting_dict(db, key, current)
    return current


def get_last_scrape(db: Session) -> dict[str, Any] | None:
    row = db.query(models.AppSetting).filter(models.AppSetting.key == "last_scrape").first()
    if not row:
        return None
    data = _load_json(row.value_json)
    return data if data else None


def set_last_scrape(
    db: Session,
    *,
    at_iso: str,
    new_created: int,
    total_found: int,
    region: str,
    category: str,
    updated: int = 0,
) -> None:
    payload = {
        "at": at_iso,
        "new_created": new_created,
        "total_found": total_found,
        "region": region,
        "category": category,
        "updated": updated,
    }
    set_setting_dict(db, "last_scrape", payload)


def maps_key_meta() -> dict[str, Any]:
    key = os.getenv("GOOGLE_MAPS_API_KEY", "").strip()
    if not key:
        return {"configured": False, "key_last4": None}
    return {"configured": True, "key_last4": key[-4:] if len(key) >= 4 else key}


def seed_team_from_env_if_empty(db: Session) -> None:
    n = db.query(models.TeamMember).count()
    if n > 0:
        return
    raw = os.getenv("TEAM_MEMBERS", "Sales Team,Operations")
    for idx, part in enumerate(raw.split(",")):
        name = part.strip()
        if not name:
            continue
        phone = f"seed{idx+1:08d}"
        db.add(models.TeamMember(name=name, phone=phone))
    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("seed_team_from_env_if_empty failed")
