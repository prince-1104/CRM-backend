import os
from typing import Any

import httpx
from sqlalchemy import asc, desc, func, nulls_last, or_
from sqlalchemy.orm import Session

import models
from services import app_settings as app_settings_svc
from services import google_maps_service

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")
TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"


def list_products() -> list[dict[str, Any]]:
    return [
        {"sku": "SU-CH-001", "name": "Chef Coat Pro", "active": True},
        {"sku": "SU-HT-002", "name": "Hotel Frontdesk Set", "active": True},
        {"sku": "SU-RS-003", "name": "Restaurant Service Set", "active": True},
    ]


def _fetch_place_details(client: httpx.Client, place_id: str) -> dict[str, Any]:
    details_response = client.get(
        DETAILS_URL,
        params={
            "place_id": place_id,
            "key": GOOGLE_MAPS_API_KEY,
            "fields": "formatted_phone_number,website,rating,user_ratings_total,name,formatted_address",
        },
        timeout=30,
    )
    details_response.raise_for_status()
    return details_response.json().get("result", {})


def scrape_businesses(db: Session, region: str, category: str) -> list[models.MapsBusiness]:
    if not GOOGLE_MAPS_API_KEY:
        raise ValueError("GOOGLE_MAPS_API_KEY is not configured")

    query = f"{category} in {region}"
    created_or_updated: list[models.MapsBusiness] = []

    with httpx.Client() as client:
        response = client.get(
            TEXT_SEARCH_URL,
            params={"query": query, "key": GOOGLE_MAPS_API_KEY},
            timeout=30,
        )
        response.raise_for_status()
        results = response.json().get("results", [])[:20]

        for item in results:
            place_id = item.get("place_id")
            if not place_id:
                continue
            details = _fetch_place_details(client, place_id)

            existing = (
                db.query(models.MapsBusiness)
                .filter(models.MapsBusiness.google_place_id == place_id)
                .first()
            )
            if existing:
                target = existing
            else:
                target = models.MapsBusiness(
                    google_place_id=place_id,
                    name=details.get("name") or item.get("name") or "Unknown",
                )
                db.add(target)

            target.name = details.get("name") or item.get("name") or "Unknown"
            target.phone = details.get("formatted_phone_number")
            target.address = details.get("formatted_address") or item.get("formatted_address")
            target.website = details.get("website")
            r = details.get("rating")
            target.rating = float(r) if r is not None else None
            target.review_count = details.get("user_ratings_total")
            target.region = region
            target.category = category
            created_or_updated.append(target)

        db.commit()
        for row in created_or_updated:
            db.refresh(row)

    return created_or_updated


def get_businesses(
    db: Session,
    region: str | None = None,
    category: str | None = None,
    is_converted_to_lead: bool | None = None,
) -> list[models.MapsBusiness]:
    query = db.query(models.MapsBusiness).order_by(models.MapsBusiness.scraped_at.desc())
    if region:
        query = query.filter(models.MapsBusiness.region == region)
    if category:
        query = query.filter(models.MapsBusiness.category == category)
    if is_converted_to_lead is not None:
        query = query.filter(models.MapsBusiness.is_converted_to_lead == is_converted_to_lead)
    return query.all()


def update_converted_to_lead(
    db: Session, listing_id: int, is_converted: bool
) -> models.MapsBusiness | None:
    row = db.query(models.MapsBusiness).filter(models.MapsBusiness.id == listing_id).first()
    if not row:
        return None
    row.is_converted_to_lead = is_converted
    if is_converted:
        row.contact_status = "converted"
    db.commit()
    db.refresh(row)
    return row


def update_contact_status(
    db: Session, listing_id: int, contact_status: str
) -> models.MapsBusiness | None:
    row = db.query(models.MapsBusiness).filter(models.MapsBusiness.id == listing_id).first()
    if not row:
        return None
    row.contact_status = contact_status
    row.is_converted_to_lead = contact_status == "converted"
    db.commit()
    db.refresh(row)
    return row


def bulk_update_maps_contact_status(
    db: Session, ids: list[int], contact_status: str
) -> int:
    n = 0
    for mid in ids:
        row = db.query(models.MapsBusiness).filter(models.MapsBusiness.id == mid).first()
        if row:
            row.contact_status = contact_status
            row.is_converted_to_lead = contact_status == "converted"
            n += 1
    db.commit()
    return n


def bulk_add_maps_notes(db: Session, ids: list[int], note_suffix: str) -> int:
    n = 0
    for mid in ids:
        row = db.query(models.MapsBusiness).filter(models.MapsBusiness.id == mid).first()
        if row:
            prev = row.notes or ""
            row.notes = (prev + "\n" + note_suffix).strip()
            n += 1
    db.commit()
    return n


def bulk_delete_maps_businesses(db: Session, ids: list[int]) -> int:
    if not ids:
        return 0
    n = (
        db.query(models.MapsBusiness)
        .filter(models.MapsBusiness.id.in_(ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(n)


def get_maps_stats(db: Session) -> dict:
    total = db.query(func.count(models.MapsBusiness.id)).scalar() or 0
    by_region_rows = (
        db.query(models.MapsBusiness.region, func.count(models.MapsBusiness.id))
        .filter(models.MapsBusiness.region.isnot(None))
        .group_by(models.MapsBusiness.region)
        .all()
    )
    by_category_rows = (
        db.query(models.MapsBusiness.category, func.count(models.MapsBusiness.id))
        .filter(models.MapsBusiness.category.isnot(None))
        .group_by(models.MapsBusiness.category)
        .all()
    )
    by_status_rows = (
        db.query(models.MapsBusiness.contact_status, func.count(models.MapsBusiness.id))
        .group_by(models.MapsBusiness.contact_status)
        .all()
    )
    last_scrape = db.query(func.max(models.MapsBusiness.scraped_at)).scalar()
    last_run = app_settings_svc.get_last_scrape(db)
    meta = app_settings_svc.maps_key_meta()
    by_region = {r: c for r, c in by_region_rows if r}
    by_cat = {r: c for r, c in by_category_rows if r}
    by_contact = {r: c for r, c in by_status_rows if r}
    by_category_display = dict(by_cat)
    if "lodging" in by_cat:
        by_category_display["hotels"] = by_cat["lodging"]

    return {
        "total": total,
        "total_businesses": total,
        "by_region": by_region,
        "by_category": by_cat,
        "by_category_display": by_category_display,
        "by_contact_status": by_contact,
        "by_status": dict(by_contact),
        "last_scrape_at": last_scrape.isoformat() if last_scrape else None,
        "last_collection_run": last_run,
        "maps_api_configured": meta["configured"],
        "maps_key_last4": meta["key_last4"],
    }


def update_notes(db: Session, listing_id: int, notes: str) -> models.MapsBusiness | None:
    row = db.query(models.MapsBusiness).filter(models.MapsBusiness.id == listing_id).first()
    if not row:
        return None
    row.notes = notes
    db.commit()
    db.refresh(row)
    return row


def query_maps_businesses_paginated(
    db: Session,
    *,
    region: str | None = None,
    category: str | None = None,
    page: int = 1,
    limit: int = 50,
    search: str | None = None,
    sort: str | None = None,
    contact_status: str | None = None,
    rating_min: float | None = None,
    is_converted_to_lead: bool | None = None,
) -> tuple[list[models.MapsBusiness], int]:
    q = db.query(models.MapsBusiness)
    if region:
        q = q.filter(models.MapsBusiness.region == region)
    if category:
        q = q.filter(models.MapsBusiness.category == category)
    if contact_status:
        q = q.filter(models.MapsBusiness.contact_status == contact_status)
    if is_converted_to_lead is not None:
        q = q.filter(models.MapsBusiness.is_converted_to_lead == is_converted_to_lead)
    if rating_min is not None:
        q = q.filter(models.MapsBusiness.rating >= rating_min)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                models.MapsBusiness.name.ilike(term),
                models.MapsBusiness.phone.ilike(term),
            )
        )

    total = q.count()

    raw_sort = (sort or "-scraped_at").strip()
    descending = raw_sort.startswith("-")
    sort_key = raw_sort[1:].lower() if descending else raw_sort.lower()
    if not sort_key:
        sort_key = "scraped_at"
        descending = True

    if sort_key == "rating":
        q = q.order_by(
            nulls_last(desc(models.MapsBusiness.rating))
            if descending
            else nulls_last(asc(models.MapsBusiness.rating))
        )
    elif sort_key == "review_count":
        q = q.order_by(
            nulls_last(desc(models.MapsBusiness.review_count))
            if descending
            else nulls_last(asc(models.MapsBusiness.review_count))
        )
    elif sort_key == "name":
        q = q.order_by(
            models.MapsBusiness.name.desc()
            if descending
            else models.MapsBusiness.name.asc()
        )
    elif sort_key == "region":
        q = q.order_by(
            nulls_last(desc(models.MapsBusiness.region))
            if descending
            else nulls_last(asc(models.MapsBusiness.region))
        )
    elif sort_key == "contact_status":
        q = q.order_by(
            models.MapsBusiness.contact_status.desc()
            if descending
            else models.MapsBusiness.contact_status.asc()
        )
    elif sort_key in ("created_at", "scraped_at"):
        q = q.order_by(
            desc(models.MapsBusiness.scraped_at)
            if descending
            else models.MapsBusiness.scraped_at.asc()
        )
    else:
        q = q.order_by(desc(models.MapsBusiness.scraped_at))

    offset = max(0, (page - 1) * limit)
    rows = q.offset(offset).limit(limit).all()
    return rows, total


def list_regions_with_stats(db: Session) -> list[dict[str, Any]]:
    """Per configured region: lat/lng, count of businesses, last scrape time."""
    out: list[dict[str, Any]] = []
    for name, coords in google_maps_service.REGIONS.items():
        count = (
            db.query(func.count(models.MapsBusiness.id))
            .filter(models.MapsBusiness.region == name)
            .scalar()
            or 0
        )
        last = (
            db.query(func.max(models.MapsBusiness.scraped_at))
            .filter(models.MapsBusiness.region == name)
            .scalar()
        )
        out.append(
            {
                "name": name,
                "lat": coords["lat"],
                "lng": coords["lng"],
                "last_scrape": last.isoformat() if last else None,
                "count": int(count),
            }
        )
    return out


def get_businesses_for_export(
    db: Session,
    region: str | None = None,
    category: str | None = None,
) -> list[models.MapsBusiness]:
    """Rows for CSV/Excel export with optional filters."""
    q = db.query(models.MapsBusiness).order_by(models.MapsBusiness.region, models.MapsBusiness.name)
    if region and region.strip():
        q = q.filter(models.MapsBusiness.region == region.strip())
    if category and category.strip():
        q = q.filter(models.MapsBusiness.category == category.strip().lower())
    return q.all()


def update_maps_business_combined(
    db: Session,
    listing_id: int,
    *,
    is_converted_to_lead: bool | None = None,
    notes: str | None = None,
    contact_status: str | None = None,
) -> models.MapsBusiness | None:
    """Apply notes, optional contact_status, optional conversion flag in one commit."""
    row = db.query(models.MapsBusiness).filter(models.MapsBusiness.id == listing_id).first()
    if not row:
        return None
    if notes is not None:
        row.notes = notes
    if contact_status is not None:
        row.contact_status = contact_status
        row.is_converted_to_lead = contact_status == "converted"
    elif is_converted_to_lead is not None:
        row.is_converted_to_lead = is_converted_to_lead
        if is_converted_to_lead:
            row.contact_status = "converted"
    db.commit()
    db.refresh(row)
    return row
