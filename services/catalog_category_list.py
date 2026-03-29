"""Merged product catalogue labels: defaults, admin-created extras, and in-use DB values."""

from __future__ import annotations

import json
from sqlalchemy.orm import Session

import models
from catalog_categories import (
    PRODUCT_CATALOG_CATEGORIES,
    display_category,
    validate_catalog_category,
)

CATALOG_EXTRA_KEY = "catalog_categories_extra"


def _load_extra_list(raw: str | None) -> list[str]:
    if not raw or not str(raw).strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for x in data:
        s = str(x).strip()
        if not s or len(s) > 100:
            continue
        k = s.lower()
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    return out


def get_extra_categories(db: Session) -> list[str]:
    row = (
        db.query(models.AppSetting)
        .filter(models.AppSetting.key == CATALOG_EXTRA_KEY)
        .first()
    )
    return _load_extra_list(row.value_json if row else None)


def _set_extra_categories(db: Session, names: list[str]) -> None:
    payload = json.dumps(names, ensure_ascii=False)
    row = (
        db.query(models.AppSetting)
        .filter(models.AppSetting.key == CATALOG_EXTRA_KEY)
        .first()
    )
    if row:
        row.value_json = payload
    else:
        db.add(models.AppSetting(key=CATALOG_EXTRA_KEY, value_json=payload))
    db.commit()


def remove_extra_catalog_category(db: Session, raw_name: str) -> bool:
    """Drop a name from admin-created extras if it exists. Returns whether the list changed."""
    target = " ".join(raw_name.split()).strip().lower()
    if not target:
        return False
    extras = get_extra_categories(db)
    filtered = [e for e in extras if e.lower() != target]
    if len(filtered) == len(extras):
        return False
    filtered.sort(key=str.lower)
    _set_extra_categories(db, filtered)
    return True


def add_extra_catalog_category(db: Session, raw_name: str) -> str:
    s = " ".join(raw_name.split()).strip()
    if not s:
        raise ValueError("Name is required")
    if len(s) > 100:
        raise ValueError("Name must be at most 100 characters")
    for built in PRODUCT_CATALOG_CATEGORIES:
        if built.lower() == s.lower():
            raise ValueError(f'"{built}" is already a default catalogue')
    extras = get_extra_categories(db)
    for e in extras:
        if e.lower() == s.lower():
            raise ValueError("That catalogue already exists")
    extras.append(s)
    extras.sort(key=str.lower)
    _set_extra_categories(db, extras)
    return s


def distinct_product_categories(db: Session) -> list[str]:
    rows = (
        db.query(models.CatalogProduct.category)
        .filter(models.CatalogProduct.category.isnot(None))
        .distinct()
        .all()
    )
    out: list[str] = []
    for (cat,) in rows:
        if cat and str(cat).strip():
            out.append(str(cat).strip())
    return out


def list_merged_catalog_categories(db: Session) -> list[str]:
    """
    Build one entry per catalogue segment. Normalize extras and DB values through
    ``display_category`` so legacy labels (e.g. Hotel vs Hotels) do not appear twice.
    """
    merged: list[str] = list(PRODUCT_CATALOG_CATEGORIES)
    seen = {m.lower() for m in merged}
    for e in get_extra_categories(db):
        canon = display_category(e)
        if not canon:
            continue
        k = canon.lower()
        if k not in seen:
            merged.append(canon)
            seen.add(k)
    for p in distinct_product_categories(db):
        canon = display_category(p)
        if not canon:
            continue
        k = canon.lower()
        if k not in seen:
            merged.append(canon)
            seen.add(k)
    return sorted(merged, key=str.lower)


def resolve_catalog_category_for_product(db: Session, value: str | None) -> str | None:
    if value is None:
        return None
    if not str(value).strip():
        return None
    s = str(value).strip()
    try:
        return validate_catalog_category(s)
    except ValueError:
        pass
    merged = list_merged_catalog_categories(db)
    for label in merged:
        if label.lower() == s.lower():
            return label
    preview = ", ".join(merged[:8])
    suffix = "…" if len(merged) > 8 else ""
    raise ValueError(
        f"Unknown catalogue. Create it on the Catalogues page first, or pick one of: {preview}{suffix}"
    )
