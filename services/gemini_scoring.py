from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from google.genai import Client
from google.genai import types

import models

logger = logging.getLogger(__name__)

# Default model for Gemini generation. Can be overridden with `GEMINI_MODEL_ID`.
MODEL_ID = os.getenv("GEMINI_MODEL_ID", "gemini-1.5-flash-latest")
BATCH_SIZE = 20
AI_CACHE_DAYS = 7
MAX_BULK_ROWS = 200

_client: Client | None = None


def _get_client() -> Client | None:
    global _client
    if _client is not None:
        return _client
    key = os.getenv("GEMINI_API_KEY", "")
    if not key:
        return None
    _client = Client(api_key=key)
    return _client


# ---------------------------------------------------------------------------
# Pre-filter: reject obvious junk before wasting an AI call
# ---------------------------------------------------------------------------

_BLACKLIST = [
    "school", "college", "university", "academy", "coaching", "tuition",
    "bank", "atm", "finance", "insurance",
    "hospital", "clinic", "pharmacy", "diagnostic", "pathology",
    "temple", "church", "mosque", "gurudwara", "ashram", "math",
    "library", "museum",
    "fire station", "police station", "railway station", "bus station",
    "police", "post office",
    "government", "municipal", "court",
    "electronics", "mobile shop", "mobile store", "repair", "hardware", "computer",
    "general store", "departmental store", "kirana", "bazaar", "wonderland",
    "gym", "yoga", "fitness",
    "petrol", "gas station", "fuel",
    "laundry", "salon", "spa", "parlour", "parlor",
    "dentist", "doctor", "nursing",
    "travel", "tours", "courier",
    "jewel", "optical", "photo studio",
    "advocate", "lawyer", "consultancy",
    "ngo", "trust", "foundation", "society",
    "parking", "garage", "automobile", "car wash",
]

_RETAIL_BLACKLIST = [
    "dairy",
    "supermarket",
    "mart",
    "store",
    "pickup",
    "pick up",
    "wholesale",
    "retail",
]


def pre_filter(business: dict[str, Any]) -> bool:
    """Return False for businesses that are obviously irrelevant."""
    name = (business.get("name") or "").lower()
    if any(term in name for term in _BLACKLIST):
        return False
    if any(term in name for term in _RETAIL_BLACKLIST):
        return False
    return True


# ---------------------------------------------------------------------------
# Google Places type-based filter (strongest signal from Google)
# ---------------------------------------------------------------------------

_CATEGORY_ALLOWED_TYPES: dict[str, set[str]] = {
    "catering": {"restaurant", "meal_takeaway", "meal_delivery", "cafe", "bar"},
    "restaurants": {"restaurant", "meal_takeaway", "meal_delivery", "food", "cafe"},
    "lodging": {"lodging"},
    "hotel": {"lodging"},
    "bar": {"bar", "night_club", "liquor_store"},
    "cafe": {"cafe", "bakery"},
    "security": set(),
}

_CATERING_BLOCKED_TYPES: set[str] = {
    "grocery_store",
    "supermarket",
    "convenience_store",
    "store",
}

_TYPE_HARD_REJECT: set[str] = {
    "school", "university", "library", "museum",
    "church", "hindu_temple", "mosque", "synagogue", "place_of_worship",
    "hospital", "doctor", "dentist", "pharmacy", "physiotherapist",
    "bank", "atm", "finance", "insurance_agency", "accounting",
    "police", "fire_station", "post_office", "local_government_office",
    "courthouse", "city_hall",
    "gas_station", "car_dealer", "car_rental", "car_repair", "car_wash",
    "parking", "transit_station", "bus_station", "train_station", "subway_station",
    "airport", "taxi_stand",
    "gym", "spa", "beauty_salon", "hair_care",
    "laundry", "dry_cleaning",
    "electronics_store", "hardware_store", "furniture_store", "home_goods_store",
    "shoe_store", "clothing_store", "jewelry_store", "book_store",
    "pet_store", "florist", "bicycle_store",
    "movie_theater", "bowling_alley", "amusement_park", "aquarium", "zoo",
    "cemetery", "funeral_home",
    "real_estate_agency", "moving_company", "storage",
    "travel_agency", "tourist_attraction",
    "lawyer", "locksmith", "plumber", "electrician", "painter", "roofing_contractor",
    "veterinary_care",
}


def strict_type_filter(business: dict[str, Any], category: str) -> bool:
    """Return False if Google's own types indicate the business is irrelevant.
    This is the strongest pre-AI signal we have."""
    google_types = set(business.get("types") or [])
    if not google_types:
        return True

    if google_types & _TYPE_HARD_REJECT:
        return False

    cat_key = category.strip().lower()
    if cat_key == "catering" and (google_types & _CATERING_BLOCKED_TYPES):
        return False

    allowed = _CATEGORY_ALLOWED_TYPES.get(cat_key)

    if allowed is None:
        return True
    if not allowed:
        return True

    return bool(google_types & allowed)


# ---------------------------------------------------------------------------
# AI caching: skip if already scored recently
# ---------------------------------------------------------------------------

def _should_skip_ai(row: models.MapsBusiness) -> bool:
    if row.ai_confidence is None:
        return False
    if row.ai_last_updated is None:
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(days=AI_CACHE_DAYS)
    ts = row.ai_last_updated
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return ts > cutoff


# ---------------------------------------------------------------------------
# Single-business AI validation
# ---------------------------------------------------------------------------

_SINGLE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "relevant": {"type": "string", "enum": ["YES", "NO"]},
        "confidence": {"type": "integer"},
        "type": {"type": "string"},
    },
    "required": ["relevant", "confidence", "type"],
}

_STRICT_PROMPT_SINGLE = (
    "You are filtering business leads for selling STAFF UNIFORMS.\n\n"
    "TARGET CATEGORY: {category}\n\n"
    "Target customers:\n"
    "- restaurants\n"
    "- catering companies\n"
    "- hotels\n"
    "- cafes\n"
    "- bars\n"
    "- security agencies\n\n"
    "STRICTLY REJECT:\n"
    "- grocery stores\n"
    "- supermarkets\n"
    "- dairy booths\n"
    "- retail shops\n"
    "- electronics stores\n"
    "- offices\n"
    "- religious places\n\n"
    "Only include businesses that:\n"
    "- employ staff wearing uniforms\n"
    "- serve customers directly\n\n"
    "- If unsure → NO\n\n"
    "Business:\n"
    "Name: {name}\n"
    "Address: {address}\n"
)


def ai_validate_business(business: dict[str, Any], category: str) -> dict[str, Any]:
    client = _get_client()
    if client is None:
        return {"relevant": "YES", "confidence": 0, "type": "unknown"}

    name = business.get("name", "")
    address = business.get("address", "")

    prompt = _STRICT_PROMPT_SINGLE.format(
        category=category, name=name, address=address,
    )

    try:
        response = client.models.generate_content(
            model=MODEL_ID,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_json_schema=_SINGLE_SCHEMA,
                temperature=0.1,
            ),
        )
        text = (response.text or "").strip()
        result = json.loads(text)
        result["confidence"] = max(0, min(100, int(result.get("confidence", 0))))
        return result
    except Exception:
        logger.exception("Gemini single-business validation failed for %s", name)
        return {"relevant": "NO", "confidence": 0, "type": "error"}


# ---------------------------------------------------------------------------
# Batch AI validation
# ---------------------------------------------------------------------------

_BATCH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "relevant": {"type": "string", "enum": ["YES", "NO"]},
                    "confidence": {"type": "integer"},
                    "type": {"type": "string"},
                },
                "required": ["index", "relevant", "confidence", "type"],
            },
        }
    },
    "required": ["results"],
}

_STRICT_PROMPT_BATCH = (
    "You are filtering business leads for selling STAFF UNIFORMS.\n\n"
    "TARGET CATEGORY: {category}\n\n"
    "Target customers:\n"
    "- restaurants\n"
    "- catering companies\n"
    "- hotels\n"
    "- cafes\n"
    "- bars\n"
    "- security agencies\n\n"
    "STRICTLY REJECT:\n"
    "- grocery stores\n"
    "- supermarkets\n"
    "- dairy booths\n"
    "- retail shops\n"
    "- electronics stores\n"
    "- offices\n"
    "- religious places\n\n"
    "Only include businesses that:\n"
    "- employ staff wearing uniforms\n"
    "- serve customers directly\n\n"
    "- If unsure → NO\n\n"
    "Classify each business below.\n\n"
    "Businesses:\n{listings}\n\n"
    "Return JSON with each result as:\n"
    "- relevant: YES or NO\n"
    "- confidence: number\n"
    "- type: one of restaurant/catering/hotel/bar/cafe/security/irrelevant\n"
)


def ai_validate_businesses_batch(
    businesses: list[dict[str, Any]], category: str
) -> list[dict[str, Any]]:
    """Validate a list of businesses in batches via Gemini, falling back to
    single-business calls if batch parsing fails."""
    client = _get_client()
    if client is None:
        return [{"relevant": "YES", "confidence": 0, "type": "unknown"} for _ in businesses]

    results: list[dict[str, Any]] = [None] * len(businesses)  # type: ignore[list-item]

    for chunk_start in range(0, len(businesses), BATCH_SIZE):
        chunk = businesses[chunk_start : chunk_start + BATCH_SIZE]
        listing_lines = []
        for i, b in enumerate(chunk):
            listing_lines.append(
                f"{i}. Name: {b.get('name', '')} | Address: {b.get('address', '')}"
            )

        prompt = _STRICT_PROMPT_BATCH.format(
            category=category, listings="\n".join(listing_lines),
        )

        try:
            response = client.models.generate_content(
                model=MODEL_ID,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_json_schema=_BATCH_SCHEMA,
                    temperature=0.1,
                ),
            )
            text = (response.text or "").strip()
            parsed = json.loads(text)

            for item in parsed.get("results", []):
                idx = item.get("index")
                if idx is not None and 0 <= idx < len(chunk):
                    item["confidence"] = max(0, min(100, int(item.get("confidence", 0))))
                    results[chunk_start + idx] = item

        except Exception:
            logger.exception("Gemini batch validation failed, falling back to single calls")

        for i, b in enumerate(chunk):
            abs_i = chunk_start + i
            if results[abs_i] is None:
                results[abs_i] = ai_validate_business(b, category)

    return results


# ---------------------------------------------------------------------------
# Business-aware lead scoring
# ---------------------------------------------------------------------------

_CATEGORY_PRIORITY: dict[str, float] = {
    "security": 35,
    "catering": 30,
    "lodging": 25,
    "hotel": 25,
    "restaurant": 20,
    "restaurants": 20,
    "bar": 10,
    "cafe": 5,
}


def calculate_lead_score(business: dict[str, Any]) -> float:
    score = 0.0

    rating = business.get("rating") or 0
    reviews = business.get("review_count") or 0
    confidence = business.get("ai_confidence") or 0
    category = (business.get("category") or "").lower()

    score += float(rating) * 15
    score += float(confidence) * 0.6

    if reviews > 200:
        score += 40
    elif reviews > 100:
        score += 30
    elif reviews > 50:
        score += 20
    elif reviews > 10:
        score += 10

    if business.get("phone"):
        score += 15
    if business.get("website"):
        score += 10

    score += _CATEGORY_PRIORITY.get(category, 0)

    return round(score, 1)


# ---------------------------------------------------------------------------
# Orchestrator: pre-filter + validate + score + persist
# ---------------------------------------------------------------------------


MIN_AI_CONFIDENCE = 70
_ALLOWED_AI_TYPES = {"restaurant", "catering", "hotel", "bar", "cafe", "security"}
_AI_TYPE_ALIASES = {
    "restaurants": "restaurant",
    "lodging": "hotel",
    "night_club": "bar",
}


def _normalize_ai_type(ai_type: str | None) -> str:
    raw = (ai_type or "").strip().lower()
    return _AI_TYPE_ALIASES.get(raw, raw)


def score_and_validate_businesses(
    rows: list[models.MapsBusiness],
    category: str,
    db: Any,
) -> dict[str, int]:
    """Run pre-filter, AI validation, and lead scoring on MapsBusiness rows.
    Skips rows that were scored recently (cache). Returns stats dict."""

    to_validate_rows: list[models.MapsBusiness] = []
    to_validate_dicts: list[dict[str, Any]] = []
    skipped_cache = 0
    skipped_junk = 0
    rejected_by_ai = 0
    rejected_by_type = 0
    now = datetime.now(timezone.utc)

    for r in rows:
        if _should_skip_ai(r):
            skipped_cache += 1
            continue

        biz = {
            "name": r.name,
            "address": r.address,
            "phone": r.phone,
            "website": r.website,
            "rating": r.rating,
            "review_count": r.review_count,
            "category": r.category,
        }

        if not pre_filter(biz):
            r.ai_confidence = 0
            r.ai_type = "filtered_junk"
            r.lead_score = 0.0
            r.ai_last_updated = now
            skipped_junk += 1
            continue

        to_validate_rows.append(r)
        to_validate_dicts.append(biz)

    ai_results = ai_validate_businesses_batch(to_validate_dicts, category) if to_validate_dicts else []

    validated = 0
    for row, ai_result, biz in zip(to_validate_rows, ai_results, to_validate_dicts):
        row.ai_confidence = ai_result.get("confidence", 0)
        row.ai_type = _normalize_ai_type(ai_result.get("type", "unknown"))
        row.ai_last_updated = now

        is_relevant = ai_result.get("relevant") == "YES"
        meets_confidence = row.ai_confidence >= MIN_AI_CONFIDENCE
        type_allowed = row.ai_type in _ALLOWED_AI_TYPES

        if not is_relevant or not meets_confidence or not type_allowed:
            row.lead_score = 0.0
            if not is_relevant:
                row.ai_type = f"rejected:{row.ai_type}"
            elif not type_allowed:
                row.ai_type = f"rejected_type:{row.ai_type or 'unknown'}"
                rejected_by_type += 1
            rejected_by_ai += 1
        else:
            biz["ai_confidence"] = row.ai_confidence
            row.lead_score = calculate_lead_score(biz)

        validated += 1

    try:
        db.commit()
    except Exception:
        logger.exception("Failed to persist AI scoring results")
        db.rollback()

    return {
        "ai_validated": validated,
        "skipped_cache": skipped_cache,
        "skipped_junk": skipped_junk,
        "rejected_by_ai": rejected_by_ai,
        "rejected_by_type": rejected_by_type,
    }
