"""Catalogue cards: merged category names + optional profile rows (cover, SKU prefix, CTA)."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import func
from sqlalchemy.orm import Session

import models
from catalog_categories import PRODUCT_CATALOG_CATEGORIES
from services import catalog_category_list as ccl


def derived_sku_prefix(label: str) -> str:
    compact = "".join(c for c in label if c.isalnum()).upper()
    if not compact:
        return "ITEM"
    return compact[:24]


def _products_by_category_lower(
    db: Session, *, only_active: bool
) -> dict[str, list[models.CatalogProduct]]:
    q = db.query(models.CatalogProduct)
    if only_active:
        q = q.filter(models.CatalogProduct.active.is_(True))
    rows = q.all()
    out: dict[str, list[models.CatalogProduct]] = defaultdict(list)
    for p in rows:
        key = (p.category or "").strip().lower()
        if key:
            out[key].append(p)
    return out


def _profiles_by_name_lower(db: Session) -> dict[str, models.CatalogCategoryProfile]:
    rows = db.query(models.CatalogCategoryProfile).all()
    return {r.name.strip().lower(): r for r in rows}


def list_catalogue_cards(
    db: Session, *, only_active_products: bool
) -> list[dict]:
    names = ccl.list_merged_catalog_categories(db)
    prof = _profiles_by_name_lower(db)
    prods = _products_by_category_lower(db, only_active=only_active_products)
    cards: list[dict] = []
    for name in names:
        k = name.lower()
        row = prof.get(k)
        plist = prods.get(k, [])
        prefix = (
            (row.sku_prefix.strip() if row and row.sku_prefix else "") or derived_sku_prefix(name)
        )
        cards.append(
            {
                "id": row.id if row else None,
                "name": name,
                "sku_prefix": prefix,
                "cover_image_url": row.cover_image_url if row else None,
                "badge_label": row.badge_label if row else None,
                "cta_label": row.cta_label if row else None,
                "sort_order": row.sort_order if row else 0,
                "product_count": len(plist),
                "preview_product_names": [x.name for x in plist[:3]],
            }
        )
    cards.sort(key=lambda x: (x["sort_order"], x["name"].lower()))
    return cards


def upsert_catalogue(db: Session, payload: dict) -> models.CatalogCategoryProfile:
    raw_name = str(payload["name"]).strip()
    if not raw_name:
        raise ValueError("Name is required")
    if len(raw_name) > 100:
        raise ValueError("Name must be at most 100 characters")

    canonical: str | None = None
    merged = ccl.list_merged_catalog_categories(db)
    for m in merged:
        if m.lower() == raw_name.lower():
            canonical = m
            break
    if canonical is None:
        canonical = ccl.add_extra_catalog_category(db, raw_name)

    row = (
        db.query(models.CatalogCategoryProfile)
        .filter(func.lower(models.CatalogCategoryProfile.name) == canonical.lower())
        .first()
    )

    sku_prefix = str(payload.get("sku_prefix") or "").strip()[:24]
    cover = payload.get("cover_image_url")
    cover_s = str(cover).strip()[:1024] if cover else None
    if cover_s == "":
        cover_s = None

    badge = payload.get("badge_label")
    badge_s = str(badge).strip()[:80] if badge else None
    if badge_s == "":
        badge_s = None

    cta = payload.get("cta_label")
    cta_s = str(cta).strip()[:80] if cta else None
    if cta_s == "":
        cta_s = None

    sort_order = int(payload.get("sort_order") or 0)

    if row:
        row.name = canonical
        row.sku_prefix = sku_prefix
        row.cover_image_url = cover_s
        row.badge_label = badge_s
        row.cta_label = cta_s
        row.sort_order = sort_order
    else:
        row = models.CatalogCategoryProfile(
            name=canonical,
            sku_prefix=sku_prefix,
            cover_image_url=cover_s,
            badge_label=badge_s,
            cta_label=cta_s,
            sort_order=sort_order,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def delete_catalogue_profile(db: Session, profile_id: int) -> bool:
    row = db.get(models.CatalogCategoryProfile, profile_id)
    if not row:
        return False
    name = row.name
    db.delete(row)
    db.commit()

    n = (
        db.query(models.CatalogProduct)
        .filter(func.lower(models.CatalogProduct.category) == name.lower())
        .count()
    )
    if n == 0 and name not in PRODUCT_CATALOG_CATEGORIES:
        ccl.remove_extra_catalog_category(db, name)
    return True