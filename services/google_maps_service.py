"""
Google Maps / Places data collection (Nearby Search + Place Details).

Uses Places API HTTP endpoints with httpx (async). Set GOOGLE_MAPS_API_KEY.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any

import httpx
from sqlalchemy.orm import Session

import models

logger = logging.getLogger(__name__)

GOOGLE_MAPS_API_KEY = os.getenv("GOOGLE_MAPS_API_KEY", "")

NEARBY_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"
DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"

REGIONS: dict[str, dict[str, float]] = {
    "Delhi": {"lat": 28.6139, "lng": 77.2090},
    "Kolkata": {"lat": 22.5726, "lng": 88.3639},
    "Mumbai": {"lat": 19.0760, "lng": 72.8777},
    "Bangalore": {"lat": 12.9716, "lng": 77.5946},
    "Hyderabad": {"lat": 17.3850, "lng": 78.4867},
    "Pune": {"lat": 18.5204, "lng": 73.8567},
    "Chennai": {"lat": 13.0827, "lng": 80.2707},
}

# UI categories -> Google Places single-type filter
CATEGORY_TO_PLACE_TYPE: dict[str, str] = {
    "restaurants": "restaurant",
    "lodging": "lodging",
    "bar": "bar",
    "cafe": "cafe",
}


class GoogleMapsAPIError(Exception):
    """Places API error (incl. rate limits / denied)."""


def _normalize_phone_key(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    if len(digits) < 10:
        return None
    return digits[-12:]


async def search_businesses_by_region(
    region: str,
    category: str,
    radius_km: int = 15,
) -> list[dict[str, Any]]:
    """
    Nearby Search. Returns list of dicts:
    name, address, phone, website, rating, review_count, place_id
    (phone/website may be filled after get_place_details).
    """
    if not GOOGLE_MAPS_API_KEY:
        raise GoogleMapsAPIError("GOOGLE_MAPS_API_KEY is not configured")

    region_key = region.strip()
    if region_key not in REGIONS:
        raise GoogleMapsAPIError(f"Unknown region: {region}")

    cat_key = category.strip().lower()
    place_type = CATEGORY_TO_PLACE_TYPE.get(cat_key)
    if not place_type:
        raise GoogleMapsAPIError(f"Unsupported category: {category}")

    coords = REGIONS[region_key]
    location = f"{coords['lat']},{coords['lng']}"
    radius_m = max(1, radius_km) * 1000

    aggregated: list[dict[str, Any]] = []
    next_page_token: str | None = None
    max_pages = 5

    async with httpx.AsyncClient(timeout=60.0) as client:
        for _ in range(max_pages):
            params: dict[str, Any] = {
                "location": location,
                "radius": radius_m,
                "type": place_type,
                "key": GOOGLE_MAPS_API_KEY,
            }
            if next_page_token:
                params["pagetoken"] = next_page_token

            response = await client.get(NEARBY_SEARCH_URL, params=params)
            response.raise_for_status()
            payload = response.json()
            status = payload.get("status")

            if status == "OVER_QUERY_LIMIT":
                raise GoogleMapsAPIError(
                    "Google Places API rate limit reached. Try again later."
                )
            if status == "REQUEST_DENIED":
                raise GoogleMapsAPIError(
                    payload.get("error_message") or "Places API request denied"
                )
            if status not in ("OK", "ZERO_RESULTS"):
                raise GoogleMapsAPIError(
                    f"Places Nearby Search failed: {status} — {payload.get('error_message', '')}"
                )

            for item in payload.get("results", []):
                pid = item.get("place_id")
                if not pid:
                    continue
                vic = item.get("vicinity")
                r = item.get("rating")
                urt = item.get("user_ratings_total")
                aggregated.append(
                    {
                        "name": item.get("name") or "Unknown",
                        "address": vic,
                        "phone": item.get("formatted_phone_number"),
                        "website": item.get("website"),
                        "rating": float(r) if r is not None else None,
                        "review_count": urt,
                        "place_id": pid,
                    }
                )

            next_page_token = payload.get("next_page_token")
            if not next_page_token:
                break
            await asyncio.sleep(2.1)

    return aggregated


async def get_place_details(place_id: str) -> dict[str, Any]:
    """Returns phone, website, rating, review_count from Place Details."""
    if not GOOGLE_MAPS_API_KEY:
        raise GoogleMapsAPIError("GOOGLE_MAPS_API_KEY is not configured")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            DETAILS_URL,
            params={
                "place_id": place_id,
                "fields": "formatted_phone_number,website,rating,user_ratings_total",
                "key": GOOGLE_MAPS_API_KEY,
            },
        )
        response.raise_for_status()
        payload = response.json()
        status = payload.get("status")
        if status == "OVER_QUERY_LIMIT":
            raise GoogleMapsAPIError(
                "Google Places API rate limit reached. Try again later."
            )
        if status != "OK":
            raise GoogleMapsAPIError(
                f"Place Details failed: {status} — {payload.get('error_message', '')}"
            )

        result = payload.get("result") or {}
        r = result.get("rating")
        return {
            "phone": result.get("formatted_phone_number"),
            "website": result.get("website"),
            "rating": float(r) if r is not None else None,
            "review_count": result.get("user_ratings_total"),
        }


def _merge_detail(row: dict[str, Any], detail: dict[str, Any]) -> dict[str, Any]:
    out = {**row}
    if detail.get("phone"):
        out["phone"] = detail["phone"]
    if detail.get("website"):
        out["website"] = detail["website"]
    if detail.get("rating") is not None:
        out["rating"] = detail["rating"]
    if detail.get("review_count") is not None:
        out["review_count"] = detail["review_count"]
    return out


async def enrich_with_place_details(
    businesses: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Call get_place_details for each item and merge (logs errors, keeps partial row)."""
    out: list[dict[str, Any]] = []
    for b in businesses:
        pid = b.get("place_id")
        if not pid:
            continue
        try:
            detail = await get_place_details(pid)
            out.append(_merge_detail(b, detail))
        except GoogleMapsAPIError as e:
            logger.warning("Place details failed for %s: %s", pid, e)
            out.append(b)
        except Exception:
            logger.exception("Place details unexpected error for %s", pid)
            out.append(b)
    return out


def _find_existing(
    db: Session, place_id: str | None, phone_clean: str
) -> models.MapsBusiness | None:
    if place_id:
        row = (
            db.query(models.MapsBusiness)
            .filter(models.MapsBusiness.google_place_id == place_id)
            .first()
        )
        if row:
            return row
    key = _normalize_phone_key(phone_clean)
    if not key:
        return None
    for row in db.query(models.MapsBusiness).filter(models.MapsBusiness.phone.isnot(None)):
        if _normalize_phone_key(row.phone) == key:
            return row
    return None


def _save_businesses_to_db_sync(
    region: str,
    category: str,
    businesses: list[dict[str, Any]],
    db: Session,
) -> dict[str, int]:
    new_created = 0
    updated = 0
    duplicates_skipped = 0
    skipped_no_phone = 0
    seen_place_ids: set[str] = set()

    for raw in businesses:
        place_id = raw.get("place_id")
        if place_id and place_id in seen_place_ids:
            duplicates_skipped += 1
            continue
        if place_id:
            seen_place_ids.add(place_id)

        phone = raw.get("phone")
        if not phone or not str(phone).strip():
            skipped_no_phone += 1
            logger.info("Skipping business without phone: %s", raw.get("name"))
            continue

        phone_clean = str(phone).strip()[:20]

        existing = _find_existing(db, place_id, phone_clean)
        rating = raw.get("rating")
        rc = raw.get("review_count")

        if existing:
            existing.name = raw.get("name") or existing.name
            existing.address = raw.get("address") or existing.address
            existing.phone = phone_clean
            existing.website = raw.get("website") or existing.website
            existing.rating = (
                float(rating) if rating is not None else existing.rating
            )
            existing.review_count = (
                int(rc) if rc is not None else existing.review_count
            )
            existing.region = region
            existing.category = category
            updated += 1
        else:
            db.add(
                models.MapsBusiness(
                    google_place_id=place_id,
                    name=raw.get("name") or "Unknown",
                    address=raw.get("address"),
                    phone=phone_clean,
                    website=raw.get("website"),
                    rating=float(rating) if rating is not None else None,
                    review_count=int(rc) if rc is not None else None,
                    region=region,
                    category=category,
                    is_converted_to_lead=False,
                    contact_status="not_contacted",
                )
            )
            new_created += 1

    try:
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Commit failed for maps businesses")
        raise

    return {
        "new_created": new_created,
        "updated": updated,
        "duplicates_skipped": duplicates_skipped,
        "skipped_no_phone": skipped_no_phone,
    }


def save_businesses_to_db(
    region: str,
    category: str,
    businesses: list[dict[str, Any]],
    db: Session,
) -> dict[str, int]:
    """Upsert MapsBusiness rows (sync; use same thread as FastAPI Session)."""
    return _save_businesses_to_db_sync(region, category, businesses, db)


# Alias for callers that follow the Phase 10 spec name
save_to_db = save_businesses_to_db


async def test_places_api_connection() -> tuple[bool, str]:
    """Minimal Nearby Search (Delhi, 500m, restaurant) to verify API key."""
    if not GOOGLE_MAPS_API_KEY:
        return False, "GOOGLE_MAPS_API_KEY is not configured"
    coords = REGIONS.get("Delhi")
    if not coords:
        return False, "No default region configured"
    location = f"{coords['lat']},{coords['lng']}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(
            NEARBY_SEARCH_URL,
            params={
                "location": location,
                "radius": 500,
                "type": "restaurant",
                "key": GOOGLE_MAPS_API_KEY,
            },
        )
        response.raise_for_status()
        payload = response.json()
        st = payload.get("status")
        if st in ("OK", "ZERO_RESULTS"):
            return True, f"Places API OK ({st})"
        if st == "REQUEST_DENIED":
            return False, payload.get("error_message") or "REQUEST_DENIED"
        if st == "OVER_QUERY_LIMIT":
            return False, "Rate limit — try again later"
        return False, f"Unexpected status: {st}"


__all__ = [
    "GOOGLE_MAPS_API_KEY",
    "REGIONS",
    "CATEGORY_TO_PLACE_TYPE",
    "GoogleMapsAPIError",
    "search_businesses_by_region",
    "get_place_details",
    "enrich_with_place_details",
    "save_businesses_to_db",
    "save_to_db",
    "test_places_api_connection",
]
