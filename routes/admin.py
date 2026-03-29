import hashlib
import hmac
import logging
import os
from datetime import date, datetime, timezone
from urllib.parse import quote
from io import BytesIO, StringIO

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import JSONResponse, Response, StreamingResponse
from sqlalchemy.orm import Session


import auth
import models
import schemas
from database import get_db
from services import app_settings as app_settings_service
from services import catalog_category_list as catalog_category_list_service
from services import catalog_category_profiles as catalog_category_profiles_service
from services import google_maps_service
from services import team_service as team_service
from services.google_maps_service import GoogleMapsAPIError
from services import gemini_scoring
from services import leads as lead_service, products as product_service
from services import r2_storage as r2_storage_service
from services import resend_mail

logger = logging.getLogger(__name__)


def _bootstrap_secret_matches(expected: str, provided: str) -> bool:
    if not expected or not provided:
        return False
    he = hashlib.sha256(expected.encode()).digest()
    hp = hashlib.sha256(provided.encode()).digest()
    return hmac.compare_digest(he, hp)

router = APIRouter()

ALLOWED_SCRAPE_REGIONS = frozenset(google_maps_service.REGIONS.keys())
ALLOWED_SCRAPE_CATEGORIES = frozenset(
    {"restaurants", "lodging", "bar", "cafe", "catering"}
)
MAPS_CATEGORY_LIST = sorted(ALLOWED_SCRAPE_CATEGORIES)


async def _run_maps_collection_scrape(
    payload: schemas.MapsCollectionScrapeRequest,
    db: Session,
) -> dict | JSONResponse:
    """Shared scrape logic for POST /maps-collection/scrape and POST /maps/scrape."""
    region = (payload.region or "").strip()
    category = payload.category.strip().lower()
    has_coords = payload.lat is not None and payload.lng is not None

    if not has_coords:
        if not region:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "detail": "Region is required"},
            )
        if region not in ALLOWED_SCRAPE_REGIONS:
            return JSONResponse(
                status_code=400,
                content={"status": "error", "detail": "Invalid region"},
            )
    if category not in ALLOWED_SCRAPE_CATEGORIES:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "detail": "Invalid category"},
        )

    try:
        if has_coords:
            location = f"{payload.lat},{payload.lng}"
            raw = await google_maps_service.search_businesses_by_location(
                location=location,
                category=category,
                radius_m=int(payload.radius_km) * 1000,
            )
        else:
            raw = await google_maps_service.search_businesses_by_region(
                region, category, payload.radius_km
            )
        total_found = len(raw)

        filtered = []
        pre_rejected_type = 0
        pre_rejected_blacklist = 0
        for item in raw:
            if not gemini_scoring.strict_type_filter(item, category):
                pre_rejected_type += 1
                continue
            if not gemini_scoring.pre_filter(item):
                pre_rejected_blacklist += 1
                continue
            filtered.append(item)

        pre_rejected = pre_rejected_type + pre_rejected_blacklist
        logger.info(
            "Pre-filter: %d/%d passed (%d type rejects, %d blacklist rejects)",
            len(filtered), total_found, pre_rejected_type, pre_rejected_blacklist,
        )

        enriched = await google_maps_service.enrich_with_place_details(filtered)
        region_for_db = region or "Custom"
        stats = google_maps_service.save_businesses_to_db(
            region_for_db, category, enriched, db
        )
    except GoogleMapsAPIError as exc:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "detail": str(exc)},
        )
    except Exception as exc:
        logger.exception("maps-collection scrape failed")
        return JSONResponse(
            status_code=500,
            content={"status": "error", "detail": str(exc) or repr(exc)},
        )

    msg = f"{stats['new_created']} new businesses added, {stats['updated']} updated"
    if pre_rejected:
        msg += (
            f" ({pre_rejected} pre-filtered: "
            f"{pre_rejected_type} by type, {pre_rejected_blacklist} by blacklist)"
        )
    if stats.get("skipped_no_phone"):
        msg += f" ({stats['skipped_no_phone']} skipped with no phone)"

    ai_stats = {"ai_validated": 0}
    saved_rows = (
        db.query(models.MapsBusiness)
        .filter(
            models.MapsBusiness.region == (region or "Custom"),
            models.MapsBusiness.category == category,
            models.MapsBusiness.ai_type.is_(None),
        )
        .all()
    )
    if saved_rows:
        try:
            ai_stats = gemini_scoring.score_and_validate_businesses(saved_rows, category, db)
            msg += f", {ai_stats['ai_validated']} AI-scored"
            if ai_stats.get("skipped_cache"):
                msg += f" ({ai_stats['skipped_cache']} cached)"
            if ai_stats.get("skipped_junk"):
                msg += f" ({ai_stats['skipped_junk']} junk filtered)"
            if ai_stats.get("rejected_by_ai"):
                msg += f" ({ai_stats['rejected_by_ai']} rejected by AI)"
            if ai_stats.get("rejected_by_type"):
                msg += f" ({ai_stats['rejected_by_type']} rejected by AI type)"
        except Exception:
            logger.exception("AI scoring failed during scrape")

    app_settings_service.set_last_scrape(
        db,
        at_iso=datetime.now(timezone.utc).isoformat(),
        new_created=stats["new_created"],
        total_found=total_found,
        region=region or "Custom",
        category=category,
        updated=stats.get("updated", 0),
    )

    return {
        "status": "success",
        "region": region or "Custom",
        "category": category,
        "total_found": total_found,
        "pre_rejected_type": pre_rejected_type,
        "pre_rejected_blacklist": pre_rejected_blacklist,
        "new_created": stats["new_created"],
        "updated": stats["updated"],
        "duplicates_skipped": stats["duplicates_skipped"],
        "ai_validated": ai_stats.get("ai_validated", 0),
        "ai_rejected_by_type": ai_stats.get("rejected_by_type", 0),
        "message": msg,
    }


def _maps_businesses_paginated_result(
    db: Session,
    *,
    region: str | None,
    category: str | None,
    contact_status: str | None,
    rating_min: float | None,
    is_converted_to_lead: bool | None,
    lead_score_min: float | None = None,
    page: int,
    limit: int,
    search: str | None,
    sort: str | None,
) -> schemas.MapsBusinessPaginatedResponse:
    limit = min(max(limit, 1), 100)
    page = max(page, 1)
    raw = (sort or "-scraped_at").strip()
    base = raw[1:].lower() if raw.startswith("-") else raw.lower()
    allowed_sort = (
        "scraped_at",
        "created_at",
        "rating",
        "review_count",
        "name",
        "region",
        "contact_status",
        "lead_score",
        "ai_confidence",
    )
    sort_param = raw if base in allowed_sort else "-scraped_at"

    rows, total = product_service.query_maps_businesses_paginated(
        db,
        region=region,
        category=category,
        page=page,
        limit=limit,
        search=search,
        sort=sort_param,
        contact_status=contact_status,
        rating_min=rating_min,
        is_converted_to_lead=is_converted_to_lead,
        lead_score_min=lead_score_min,
    )
    pages = (total + limit - 1) // limit if total else 0

    return schemas.MapsBusinessPaginatedResponse(
        data=rows,
        pagination=schemas.PaginationMeta(
            page=page, limit=limit, total=total, pages=pages
        ),
    )


@router.post("/login", response_model=schemas.TokenResponse)
def login(
    payload: schemas.AdminLoginRequest, db: Session = Depends(get_db)
) -> schemas.TokenResponse:
    email = str(payload.email).strip().lower()
    user = (
        db.query(models.AdminUser)
        .filter(models.AdminUser.email == email)
        .first()
    )
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not auth.verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    token = auth.create_access_token(subject=user.email)
    return schemas.TokenResponse(access_token=token)


@router.post("/bootstrap/request", response_model=schemas.BootstrapRequestResponse)
def bootstrap_request(
    payload: schemas.AdminBootstrapRequest, db: Session = Depends(get_db)
) -> schemas.BootstrapRequestResponse:
    secret = os.getenv("ADMIN_BOOTSTRAP_SECRET", "").strip()
    if not secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Admin bootstrap is not configured",
        )
    if not _bootstrap_secret_matches(secret, payload.bootstrap_secret.strip()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bootstrap secret",
        )
    if db.query(models.AdminUser).count() > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="An admin account already exists",
        )
    email = str(payload.email).strip().lower()
    setup_jwt = auth.create_admin_setup_token(email)
    base = os.getenv("ADMIN_APP_BASE_URL", "http://localhost:3001").rstrip("/")
    setup_url = f"{base}/setup?token={quote(setup_jwt, safe='')}"
    try:
        resend_mail.send_admin_setup_email(to_email=email, setup_url=setup_url)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    except resend_mail.ResendAPIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc
    except Exception:
        logger.exception("Failed to send admin setup email")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not send email",
        )
    return schemas.BootstrapRequestResponse()


@router.post("/bootstrap/complete", response_model=schemas.TokenResponse)
def bootstrap_complete(
    payload: schemas.AdminBootstrapCompleteRequest, db: Session = Depends(get_db)
) -> schemas.TokenResponse:
    email = auth.decode_admin_setup_token(payload.token)
    if db.query(models.AdminUser).count() > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="An admin account already exists",
        )
    existing = (
        db.query(models.AdminUser)
        .filter(models.AdminUser.email == email)
        .first()
    )
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email is already registered",
        )
    user = models.AdminUser(
        email=email,
        hashed_password=auth.hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.TokenResponse(access_token=auth.create_access_token(subject=user.email))


def _admin_settings_response(db: Session, admin_email: str) -> schemas.AdminSettingsResponse:
    app_settings_service.seed_team_from_env_if_empty(db)
    maps_defaults = app_settings_service.get_setting_dict(
        db, "maps_defaults", app_settings_service.DEFAULT_MAPS_DEFAULTS
    )
    business = app_settings_service.get_setting_dict(
        db, "business_info", app_settings_service.DEFAULT_BUSINESS_INFO
    )
    export = app_settings_service.get_setting_dict(
        db, "export_prefs", app_settings_service.DEFAULT_EXPORT_PREFS
    )
    mstats = product_service.get_maps_stats(db)
    maps_block = {
        "api_configured": mstats.get("maps_api_configured", False),
        "key_last4": mstats.get("maps_key_last4"),
        "default_radius_km": maps_defaults.get("default_radius_km", 15),
        "categories": maps_defaults.get("categories", {}),
        "last_collection_run": mstats.get("last_collection_run"),
        "last_scrape_at": mstats.get("last_scrape_at"),
    }
    team_rows = team_service.list_members_with_call_counts(db)
    team = [schemas.TeamMemberResponse.model_validate(r) for r in team_rows]
    return schemas.AdminSettingsResponse(
        maps=maps_block,
        business=business,
        export=export,
        account=schemas.AccountInfoResponse(email=admin_email),
        team=team,
    )


@router.get("/settings", response_model=schemas.AdminSettingsResponse)
def get_settings(
    admin_email: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.AdminSettingsResponse:
    return _admin_settings_response(db, admin_email=admin_email)


@router.patch("/settings", response_model=schemas.AdminSettingsResponse)
def patch_settings(
    payload: schemas.AdminSettingsPatchRequest,
    admin_email: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.AdminSettingsResponse:
    if payload.maps_defaults:
        app_settings_service.merge_setting_dict(
            db,
            "maps_defaults",
            payload.maps_defaults,
            app_settings_service.DEFAULT_MAPS_DEFAULTS,
        )
    if payload.business:
        app_settings_service.merge_setting_dict(
            db,
            "business_info",
            payload.business,
            app_settings_service.DEFAULT_BUSINESS_INFO,
        )
    if payload.export:
        app_settings_service.merge_setting_dict(
            db,
            "export_prefs",
            payload.export,
            app_settings_service.DEFAULT_EXPORT_PREFS,
        )
    return _admin_settings_response(db, admin_email=admin_email)


@router.get("/team-members", response_model=list[schemas.TeamMemberResponse])
def get_team_members(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> list[schemas.TeamMemberResponse]:
    app_settings_service.seed_team_from_env_if_empty(db)
    rows = team_service.list_members_with_call_counts(db)
    return [schemas.TeamMemberResponse.model_validate(r) for r in rows]


@router.post("/team-members", response_model=schemas.TeamMemberResponse)
def create_team_member(
    payload: schemas.TeamMemberCreateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.TeamMemberResponse:
    row = team_service.create_member(db, payload.name, payload.phone)
    rows = team_service.list_members_with_call_counts(db)
    match = next((r for r in rows if r["id"] == row.id), None)
    return schemas.TeamMemberResponse.model_validate(
        match
        or {"id": row.id, "name": row.name, "phone": row.phone, "calls_made": 0}
    )


@router.patch("/team-members/{member_id}", response_model=schemas.TeamMemberResponse)
def update_team_member(
    member_id: int,
    payload: schemas.TeamMemberUpdateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.TeamMemberResponse:
    row = team_service.update_member(
        db, member_id, name=payload.name, phone=payload.phone
    )
    if not row:
        raise HTTPException(status_code=404, detail="Team member not found")
    counts = {r["name"]: r["calls_made"] for r in team_service.list_members_with_call_counts(db)}
    return schemas.TeamMemberResponse(
        id=row.id,
        name=row.name,
        phone=row.phone,
        calls_made=counts.get(row.name, 0),
    )


@router.delete("/team-members/{member_id}")
def delete_team_member(
    member_id: int,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    ok = team_service.delete_member(db, member_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Team member not found")
    return {"deleted": True}


@router.get("/leads/stats/daily", response_model=list[schemas.LeadDailyPoint])
def leads_stats_daily(
    days: int = 30,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> list[schemas.LeadDailyPoint]:
    raw = lead_service.get_leads_daily_stats(db, days=days)
    return [schemas.LeadDailyPoint(**r) for r in raw]


@router.post("/maps/test-connection", response_model=schemas.MapsTestConnectionResponse)
async def maps_test_connection(
    _: str = Depends(auth.get_current_admin),
) -> schemas.MapsTestConnectionResponse:
    try:
        ok, msg = await google_maps_service.test_places_api_connection()
    except Exception as exc:
        logger.exception("maps test connection")
        return schemas.MapsTestConnectionResponse(ok=False, message=str(exc))
    return schemas.MapsTestConnectionResponse(ok=ok, message=msg)


@router.get("/leads", response_model=schemas.LeadPaginatedResponse)
def browse_leads(
    page: int = 1,
    limit: int = 50,
    status: str | None = None,
    status_filter: str | None = None,
    region: str | None = None,
    source: str | None = None,
    called_from: date | None = None,
    called_to: date | None = None,
    interested: str | None = None,
    search: str | None = None,
    sort: str = "-created_at",
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.LeadPaginatedResponse:
    limit = min(max(limit, 1), 100)
    page = max(page, 1)
    effective_status = status if status is not None else status_filter
    status_list = (
        [s.strip() for s in effective_status.split(",") if s.strip()]
        if effective_status
        else None
    )
    rows, total = lead_service.query_leads_paginated(
        db,
        page=page,
        limit=limit,
        status=status_list,
        region=region,
        source=source,
        called_from=called_from,
        called_to=called_to,
        interested=interested,
        search=search,
        sort=sort,
    )
    pages = (total + limit - 1) // limit if total else 0
    return schemas.LeadPaginatedResponse(
        data=rows,
        pagination=schemas.PaginationMeta(
            page=page, limit=limit, total=total, pages=pages
        ),
    )


@router.get("/leads/stats", response_model=schemas.LeadStatsResponse)
def leads_stats(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.LeadStatsResponse:
    s = lead_service.get_lead_stats(db)
    return schemas.LeadStatsResponse(**s)


def _apply_lead_update(
    lead_id: int,
    payload: schemas.LeadUpdateRequest,
    db: Session,
) -> schemas.LeadResponse:
    data = payload.model_dump(exclude_unset=True)
    lead = lead_service.update_lead(db, lead_id, data)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return lead


@router.patch("/leads/{lead_id}", response_model=schemas.LeadResponse)
def patch_lead(
    lead_id: int,
    payload: schemas.LeadUpdateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.LeadResponse:
    return _apply_lead_update(lead_id, payload, db)


@router.put("/leads/{lead_id}", response_model=schemas.LeadUpdateSuccessResponse)
def put_lead(
    lead_id: int,
    payload: schemas.LeadUpdate,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.LeadUpdateSuccessResponse:
    data = payload.model_dump(exclude_unset=True, mode="python")
    lead = lead_service.update_lead(db, lead_id, data)
    if not lead:
        raise HTTPException(status_code=404, detail="Lead not found")
    return schemas.LeadUpdateSuccessResponse(data=lead)


@router.post("/leads/bulk-update")
def bulk_lead_update(
    payload: schemas.LeadBulkUpdateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, str | int]:
    try:
        n = lead_service.bulk_update_leads_by_action(
            db, payload.lead_ids, payload.action, payload.data
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "success", "updated": n}


@router.post("/leads/bulk-status")
def bulk_lead_status(
    payload: schemas.LeadBulkStatusRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    n = lead_service.bulk_update_leads_status(
        db, payload.lead_ids, payload.status
    )
    return {"updated": n}


@router.post("/leads/bulk-delete")
def bulk_lead_delete(
    payload: schemas.LeadBulkIdsRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    n = lead_service.bulk_delete_leads(db, payload.lead_ids)
    return {"deleted": n}


@router.get("/leads/export/csv")
def export_leads_csv(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    rows = lead_service.list_all_leads_for_export(db)
    output = StringIO()
    def esc_csv(s: str | None) -> str:
        return (s or "").replace("\n", " ").replace('"', "'")

    output.write(
        "id,name,phone,source,status,region,notes,called_date,called_by,"
        "interested,conversation_details,business_name,address,website,rating,"
        "review_count,category,email,last_contacted,created_at,updated_at,"
        "next_follow_up_at\n"
    )
    for row in rows:
        output.write(
            f"{row.id},\"{esc_csv(row.name)}\",\"{row.phone}\",\"{row.source}\",\"{row.status}\","
            f"\"{esc_csv(row.region)}\",\"{esc_csv(row.notes)}\","
            f"\"{row.called_date or ''}\",\"{esc_csv(row.called_by)}\",\"{esc_csv(row.interested)}\","
            f"\"{esc_csv(row.conversation_details)}\",\"{esc_csv(row.business_name)}\","
            f"\"{esc_csv(row.address)}\",\"{esc_csv(row.website)}\","
            f"\"{row.rating if row.rating is not None else ''}\","
            f"\"{row.review_count or ''}\",\"{esc_csv(row.category)}\",\"{esc_csv(row.email)}\","
            f"\"{row.last_contacted or ''}\",\"{row.created_at}\",\"{row.updated_at or ''}\","
            f"\"{row.next_follow_up_at or ''}\"\n"
        )
    content = output.getvalue().encode("utf-8")
    return StreamingResponse(
        BytesIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=leads.csv"},
    )


@router.post("/maps-collection/scrape")
async def maps_collection_scrape(
    payload: schemas.MapsCollectionScrapeRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Collect Places data by region (Nearby Search + Details) and upsert maps_businesses.
    """
    return await _run_maps_collection_scrape(payload, db)


@router.post("/maps/scrape")
async def maps_scrape(
    payload: schemas.MapsCollectionScrapeRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    """Alias for POST /maps-collection/scrape (same body and response)."""
    return await _run_maps_collection_scrape(payload, db)


@router.post("/maps/ai-score", response_model=schemas.AIScoringResponse)
def run_ai_scoring(
    payload: schemas.AIScoringRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.AIScoringResponse:
    """Run AI validation and lead scoring on maps businesses.
    Skips rows that were already scored within the cache window."""
    q = db.query(models.MapsBusiness)
    if payload.region:
        q = q.filter(models.MapsBusiness.region == payload.region)
    if payload.category:
        q = q.filter(models.MapsBusiness.category == payload.category)

    rows = q.all()
    if not rows:
        return schemas.AIScoringResponse(
            status="success",
            ai_validated=0,
            total_processed=0,
            message="No businesses found matching filters",
        )

    if len(rows) > gemini_scoring.MAX_BULK_ROWS:
        return schemas.AIScoringResponse(
            status="error",
            ai_validated=0,
            total_processed=0,
            message=f"Too many records ({len(rows)}). "
            f"Max {gemini_scoring.MAX_BULK_ROWS} per batch. "
            "Use region/category filters to narrow down.",
        )

    category = payload.category or "general"
    stats = gemini_scoring.score_and_validate_businesses(rows, category, db)

    parts = [f"AI-scored {stats['ai_validated']} businesses"]
    if stats.get("skipped_cache"):
        parts.append(f"{stats['skipped_cache']} skipped (cached)")
    if stats.get("skipped_junk"):
        parts.append(f"{stats['skipped_junk']} filtered as junk")
    if stats.get("rejected_by_ai"):
        parts.append(f"{stats['rejected_by_ai']} rejected by AI (irrelevant/low confidence)")
    if stats.get("rejected_by_type"):
        parts.append(f"{stats['rejected_by_type']} rejected by AI type")

    return schemas.AIScoringResponse(
        status="success",
        ai_validated=stats["ai_validated"],
        total_processed=len(rows),
        message=", ".join(parts),
    )


@router.get("/maps-businesses", response_model=schemas.MapsBusinessPaginatedResponse)
def get_maps_businesses_paginated(
    region: str | None = None,
    category: str | None = None,
    contact_status: str | None = None,
    rating_min: float | None = None,
    is_converted_to_lead: bool | None = None,
    lead_score_min: float | None = None,
    page: int = 1,
    limit: int = 50,
    search: str | None = None,
    sort: str | None = None,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.MapsBusinessPaginatedResponse:
    return _maps_businesses_paginated_result(
        db,
        region=region,
        category=category,
        contact_status=contact_status,
        rating_min=rating_min,
        is_converted_to_lead=is_converted_to_lead,
        lead_score_min=lead_score_min,
        page=page,
        limit=limit,
        search=search,
        sort=sort,
    )


@router.get(
    "/maps/businesses/paginated",
    response_model=schemas.MapsBusinessPaginatedResponse,
)
def get_maps_businesses_paginated_alias(
    region: str | None = None,
    category: str | None = None,
    contact_status: str | None = None,
    rating_min: float | None = None,
    is_converted_to_lead: bool | None = None,
    lead_score_min: float | None = None,
    page: int = 1,
    limit: int = 50,
    search: str | None = None,
    sort: str | None = None,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.MapsBusinessPaginatedResponse:
    """Same as GET /maps-businesses (paginated data + pagination meta)."""
    return _maps_businesses_paginated_result(
        db,
        region=region,
        category=category,
        contact_status=contact_status,
        rating_min=rating_min,
        is_converted_to_lead=is_converted_to_lead,
        lead_score_min=lead_score_min,
        page=page,
        limit=limit,
        search=search,
        sort=sort,
    )


@router.get("/maps/businesses", response_model=schemas.MapsBusinessPaginatedResponse)
def get_maps_businesses(
    region: str | None = None,
    business_type: str | None = None,
    category: str | None = None,
    contact_status: str | None = None,
    rating_min: float | None = None,
    is_converted_to_lead: bool | None = None,
    lead_score_min: float | None = None,
    page: int = 1,
    limit: int = 50,
    search: str | None = None,
    sort: str | None = None,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.MapsBusinessPaginatedResponse:
    """Paginated maps businesses; same as GET /maps-businesses (supports business_type alias for category)."""
    cat = category or business_type
    return _maps_businesses_paginated_result(
        db,
        region=region,
        category=cat,
        contact_status=contact_status,
        rating_min=rating_min,
        is_converted_to_lead=is_converted_to_lead,
        lead_score_min=lead_score_min,
        page=page,
        limit=limit,
        search=search,
        sort=sort,
    )


@router.put("/maps/businesses/{business_id}", response_model=schemas.MapsBusinessResponse)
def put_maps_business(
    business_id: int,
    payload: schemas.MapsBusinessPutRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.MapsBusinessResponse:
    body = payload.model_dump(exclude_unset=True)
    if not body:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                "Provide at least one of: is_converted_to_lead, notes, contact_status"
            ),
        )
    row = product_service.update_maps_business_combined(
        db,
        business_id,
        is_converted_to_lead=body.get("is_converted_to_lead"),
        notes=body.get("notes"),
        contact_status=body.get("contact_status"),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    return row


@router.patch(
    "/maps/businesses/{listing_id}/converted-to-lead",
    response_model=schemas.MapsBusinessResponse,
)
def set_converted_to_lead(
    listing_id: int,
    payload: schemas.ConvertedToLeadRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.MapsBusinessResponse:
    row = product_service.update_converted_to_lead(
        db, listing_id, payload.is_converted_to_lead
    )
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    return row


@router.patch("/maps/businesses/{listing_id}/notes", response_model=schemas.MapsBusinessResponse)
def update_notes(
    listing_id: int,
    payload: schemas.NotesUpdateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.MapsBusinessResponse:
    row = product_service.update_notes(db, listing_id, payload.notes)
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    return row


@router.get("/maps/stats")
def maps_stats(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict:
    return product_service.get_maps_stats(db)


@router.get("/maps/regions", response_model=list[schemas.MapsRegionResponse])
def maps_regions(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> list[schemas.MapsRegionResponse]:
    rows = product_service.list_regions_with_stats(db)
    return [schemas.MapsRegionResponse.model_validate(r) for r in rows]


@router.get("/maps/categories")
def maps_categories(_: str = Depends(auth.get_current_admin)) -> list[str]:
    return MAPS_CATEGORY_LIST


@router.get("/catalog/categories")
def get_catalog_product_categories(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> list[str]:
    return catalog_category_list_service.list_merged_catalog_categories(db)


@router.post("/catalog/categories", response_model=schemas.CatalogCategoryResponse)
def create_catalog_product_category(
    payload: schemas.CatalogCategoryCreateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.CatalogCategoryResponse:
    try:
        name = catalog_category_list_service.add_extra_catalog_category(db, payload.name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    all_cats = catalog_category_list_service.list_merged_catalog_categories(db)
    return schemas.CatalogCategoryResponse(name=name, categories=all_cats)


@router.get(
    "/catalog/catalogues",
    response_model=list[schemas.CatalogueCardResponse],
)
def list_catalogue_cards_admin(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> list[schemas.CatalogueCardResponse]:
    rows = catalog_category_profiles_service.list_catalogue_cards(
        db, only_active_products=False
    )
    return [schemas.CatalogueCardResponse.model_validate(r) for r in rows]


@router.put(
    "/catalog/catalogues",
    response_model=schemas.CatalogueCardResponse,
)
def upsert_catalogue(
    payload: schemas.CatalogueUpsertRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.CatalogueCardResponse:
    try:
        saved = catalog_category_profiles_service.upsert_catalogue(
            db, payload.model_dump()
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rows = catalog_category_profiles_service.list_catalogue_cards(
        db, only_active_products=False
    )
    canon = saved.name.strip().lower()
    for r in rows:
        if r["name"].lower() == canon:
            return schemas.CatalogueCardResponse.model_validate(r)
    raise HTTPException(status_code=500, detail="Catalogue saved but could not reload")


@router.delete("/catalog/catalogues/{profile_id}")
def delete_catalogue_profile(
    profile_id: int,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    ok = catalog_category_profiles_service.delete_catalogue_profile(db, profile_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Catalogue profile not found")
    return {"deleted": True}


@router.get("/catalog/products", response_model=list[schemas.CatalogProductResponse])
def get_catalog_products(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> list[schemas.CatalogProductResponse]:
    rows = product_service.list_products_admin(db)
    return [schemas.CatalogProductResponse.model_validate(r) for r in rows]


@router.post("/catalog/products", response_model=schemas.CatalogProductResponse)
def create_catalog_product(
    payload: schemas.CatalogProductCreateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.CatalogProductResponse:
    try:
        row = product_service.create_catalog_product(db, payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return schemas.CatalogProductResponse.model_validate(row)


@router.patch("/catalog/products/{product_id}", response_model=schemas.CatalogProductResponse)
def patch_catalog_product(
    product_id: int,
    payload: schemas.CatalogProductUpdateRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.CatalogProductResponse:
    body = payload.model_dump(exclude_unset=True)
    if not body:
        raise HTTPException(status_code=422, detail="Provide at least one field to update")
    try:
        row = product_service.update_catalog_product(db, product_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return schemas.CatalogProductResponse.model_validate(row)


@router.delete("/catalog/products/{product_id}")
def remove_catalog_product(
    product_id: int,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, bool]:
    ok = product_service.delete_catalog_product(db, product_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"deleted": True}


@router.post("/catalog/upload-image", response_model=schemas.CatalogImageUploadResponse)
async def upload_catalog_image(
    file: UploadFile = File(...),
    _: str = Depends(auth.get_current_admin),
) -> schemas.CatalogImageUploadResponse:
    allowed = {"image/jpeg", "image/png", "image/webp", "image/gif"}
    if file.content_type not in allowed:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Allowed: jpg, png, webp, gif",
        )
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be <= 10MB")
    if not content:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        result = r2_storage_service.upload_catalog_image(
            content=content,
            filename=file.filename or "upload.bin",
            content_type=file.content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception:
        logger.exception("catalog image upload failed")
        raise HTTPException(status_code=500, detail="Failed to upload image")

    return schemas.CatalogImageUploadResponse(key=result["key"], url=result["url"])


@router.get("/catalog/media/{key:path}")
def get_catalog_media(
    key: str,
    _: str = Depends(auth.get_current_admin),
) -> Response:
    """
    Authenticated image bytes for admin previews. Browser <img> to public r2.dev
    often fails when the bucket is private or the public base URL is wrong.
    """
    try:
        body, content_type = r2_storage_service.get_catalog_object(key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found") from None
    except Exception:
        logger.exception("catalog media fetch failed")
        raise HTTPException(status_code=500, detail="Failed to load image") from None

    return Response(
        content=body,
        media_type=content_type or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=300"},
    )


@router.patch(
    "/maps/businesses/{listing_id}/contact-status",
    response_model=schemas.MapsBusinessResponse,
)
def patch_maps_contact_status(
    listing_id: int,
    payload: schemas.MapsContactStatusRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> schemas.MapsBusinessResponse:
    row = product_service.update_contact_status(
        db, listing_id, payload.contact_status
    )
    if not row:
        raise HTTPException(status_code=404, detail="Listing not found")
    return row


@router.post("/maps/businesses/bulk-contact")
def bulk_maps_contact(
    payload: schemas.MapsBulkContactRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    n = product_service.bulk_update_maps_contact_status(
        db, payload.ids, payload.contact_status
    )
    return {"updated": n}


@router.post("/maps/businesses/bulk-notes")
def bulk_maps_notes(
    payload: schemas.MapsBulkNotesRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    n = product_service.bulk_add_maps_notes(db, payload.ids, payload.note)
    return {"updated": n}


@router.post("/maps/businesses/bulk-delete")
def bulk_maps_delete(
    payload: schemas.MapsBulkIdsRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
) -> dict[str, int]:
    n = product_service.bulk_delete_maps_businesses(db, payload.ids)
    return {"deleted": n}


def _esc_maps_csv_cell(s: str | None) -> str:
    return (s or "").replace("\n", " ").replace('"', "'")


def _google_maps_place_url(place_id: str | None) -> str | None:
    if not place_id:
        return None
    # Encode to avoid broken links inside PDF viewers.
    # Using the search endpoint is generally more tolerant for `place_id:*` queries.
    q = f"place_id:{place_id}"
    q_enc = quote(q, safe="")
    return f"https://www.google.com/maps/search/?api=1&query={q_enc}"


def _short_place_id(place_id: str | None, max_len: int = 20) -> str:
    if not place_id:
        return ""
    if len(place_id) <= max_len:
        return place_id
    # Keep the beginning + end so the value stays identifiable.
    head = place_id[:10]
    tail = place_id[-8:]
    return f"{head}...{tail}"


def _draw_maps_businesses_pdf(rows: list[models.MapsBusiness]) -> bytes:
    """
    Simple PDF renderer:
    - Each row shows a few columns.
    - The business `name` is a clickable Google Maps link (when place_id exists).
    """
    try:
        # Lazy import so the backend can still run even if reportlab isn't installed.
        from reportlab.pdfgen import canvas as pdf_canvas_local
        from reportlab.lib.pagesizes import A4 as A4_local
        from reportlab.pdfbase.pdfmetrics import stringWidth as stringWidth_local
    except ModuleNotFoundError as exc:
        raise HTTPException(
            status_code=501,
            detail="PDF export requires 'reportlab'. Please install it in the backend venv.",
        ) from exc

    buffer = BytesIO()
    w, h = A4_local
    c = pdf_canvas_local.Canvas(buffer, pagesize=A4_local)

    left = 24
    right = w - 24
    top = h - 24
    bottom = 24

    row_h = 14
    name_font = "Helvetica"
    body_font = "Helvetica"
    name_font_size = 9
    body_font_size = 8

    c.setTitle("Maps businesses export")
    c.setFont(body_font, 10)
    c.drawString(left, top, f"Maps Businesses Export ({len(rows)} rows)")

    # Column starts (keep it simple for readability).
    x_name = left
    x_phone = 220
    x_region = 295
    x_category = 365
    x_rating = 445
    x_placeid = 505

    # We will render name by truncating to approximate width.
    max_name_width = 95  # points-ish on A4 with small font

    y = top - 18
    c.setFont(body_font, body_font_size)

    def _ensure_page(next_y: float) -> float:
        nonlocal y
        if next_y < bottom:
            c.showPage()
            c.setFont(body_font, 10)
            c.drawString(left, top, "Maps Businesses Export (cont.)")
            c.setFont(body_font, body_font_size)
            y = top - 18
        return y

    for row in rows:
        _ensure_page(y - row_h)

        name = row.name or ""
        place_id = row.google_place_id
        link_url = _google_maps_place_url(place_id)

        phone = row.phone or ""
        region = row.region or ""
        category = row.category or ""
        rating = f"{row.rating:.1f}" if row.rating is not None else ""

        # Truncate name based on actual font width for the link rect.
        rendered_name = name
        while (
            rendered_name
            and stringWidth_local(rendered_name, name_font, name_font_size)
            > max_name_width
        ):
            rendered_name = rendered_name[:-1]

        c.setFont(name_font, name_font_size)
        c.drawString(x_name, y, rendered_name)
        name_w = stringWidth_local(rendered_name, name_font, name_font_size)

        if link_url:
            # Underline name to hint it's clickable.
            c.line(x_name, y - 1, x_name + name_w, y - 1)
            # PDF link rectangle: (x1, y1, x2, y2)
            c.linkURL(
                link_url,
                (x_name, y - 3, x_name + name_w, y + 9),
                relative=0,
            )

        c.setFont(body_font, body_font_size)
        c.drawString(x_phone, y, phone[:18])
        c.drawString(x_region, y, region[:14])
        c.drawString(x_category, y, category[:14])
        c.drawString(x_rating, y, rating[:8])
        c.drawString(x_placeid, y, _short_place_id(place_id, max_len=20))

        y -= row_h

    c.save()
    buffer.seek(0)
    return buffer.read()


@router.post("/maps/export")
def post_maps_export(
    payload: schemas.MapsExportPostRequest,
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    rows = product_service.get_businesses_for_export(db, payload.region, payload.category)
    if payload.file_format == "csv":
        output = StringIO()
        output.write("name,phone,website,address,rating,region\n")
        for row in rows:
            output.write(
                f"\"{_esc_maps_csv_cell(row.name)}\",\"{_esc_maps_csv_cell(row.phone)}\","
                f"\"{_esc_maps_csv_cell(row.website)}\",\"{_esc_maps_csv_cell(row.address)}\","
                f"\"{row.rating if row.rating is not None else ''}\",\"{row.region or ''}\"\n"
            )
        content = output.getvalue().encode("utf-8")
        return StreamingResponse(
            BytesIO(content),
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=maps_businesses_export.csv"
            },
        )
    output = StringIO()
    output.write("Name\tPhone\tWebsite\tAddress\tRating\tRegion\n")
    for row in rows:
        output.write(
            f"{row.name}\t{_esc_maps_csv_cell(row.phone)}\t{_esc_maps_csv_cell(row.website)}\t"
            f"{_esc_maps_csv_cell(row.address)}\t"
            f"{row.rating if row.rating is not None else ''}\t{row.region or ''}\n"
        )
    content = output.getvalue().encode("utf-8")
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.ms-excel",
        headers={
            "Content-Disposition": "attachment; filename=maps_businesses_export.xls"
        },
    )

    if payload.file_format == "pdf":
        pdf_bytes = _draw_maps_businesses_pdf(rows)
        return StreamingResponse(
            BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": "attachment; filename=maps_businesses_export.pdf"
            },
        )

    raise HTTPException(status_code=400, detail="Unsupported export format")


@router.get("/maps/export/csv")
def export_csv(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    rows = product_service.get_businesses(db)
    output = StringIO()
    output.write(
        "name,phone,website,address,rating,region,category,contact_status,"
        "review_count,is_converted_to_lead,notes,scraped_at\n"
    )
    for row in rows:
        safe_notes = (row.notes or "").replace('"', "'")
        output.write(
            f"\"{row.name}\",\"{row.phone or ''}\",\"{row.website or ''}\",\"{row.address or ''}\","
            f"\"{row.rating if row.rating is not None else ''}\",\"{row.region or ''}\","
            f"\"{row.category or ''}\",\"{row.contact_status}\","
            f"\"{row.review_count or ''}\",\"{row.is_converted_to_lead}\","
            f"\"{safe_notes}\",\"{row.scraped_at}\"\n"
        )
    content = output.getvalue().encode("utf-8")
    return StreamingResponse(
        BytesIO(content),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=maps_businesses.csv"},
    )


@router.get("/maps/export/excel")
def export_excel(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    rows = product_service.get_businesses(db)
    output = StringIO()
    output.write(
        "Name\tPhone\tAddress\tWebsite\tRating\tReviewCount\tRegion\tCategory\t"
        "ConvertedToLead\tNotes\tScrapedAt\n"
    )
    for row in rows:
        output.write(
            f"{row.name}\t{row.phone or ''}\t{row.address or ''}\t{row.website or ''}\t"
            f"{row.rating if row.rating is not None else ''}\t{row.review_count or ''}\t"
            f"{row.region or ''}\t{row.category or ''}\t{row.is_converted_to_lead}\t"
            f"{row.notes or ''}\t{row.scraped_at}\n"
        )
    content = output.getvalue().encode("utf-8")
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.ms-excel",
        headers={"Content-Disposition": "attachment; filename=maps_businesses.xls"},
    )


@router.get("/maps/export/pdf")
def export_pdf(
    _: str = Depends(auth.get_current_admin),
    db: Session = Depends(get_db),
):
    rows = product_service.get_businesses(db)
    pdf_bytes = _draw_maps_businesses_pdf(rows)
    return StreamingResponse(
        BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=maps_businesses.pdf"},
    )
