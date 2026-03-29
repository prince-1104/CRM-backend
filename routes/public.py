import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from fastapi.responses import JSONResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import schemas
from database import get_db
from services import leads as lead_service
from services import products as product_service
from services import catalog_category_list as catalog_category_list_service
from services import catalog_category_profiles as catalog_category_profiles_service
from services import app_settings as app_settings_service
from services import r2_storage as r2_storage_service

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/submit-lead")
def submit_lead(
    payload: dict[str, Any] = Body(...),
    db: Session = Depends(get_db),
):
    """
    Website quote form: accepts `name` + `phone`, or `full_name` + `phone` (Next.js proxy).
    Persists lead only; no WhatsApp, Gemini, or Maps.
    """
    name = (payload.get("name") or payload.get("full_name") or "").strip()
    phone_raw = payload.get("phone")

    if not name or len(name) < 2:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "detail": "Invalid name"},
        )

    if phone_raw is None or (isinstance(phone_raw, str) and not phone_raw.strip()):
        return JSONResponse(
            status_code=400,
            content={"status": "error", "detail": "Invalid phone format"},
        )

    try:
        lead = lead_service.create_website_form_lead(db, name=name, phone=str(phone_raw))
    except ValueError as exc:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "detail": str(exc)},
        )
    except IntegrityError:
        db.rollback()
        return JSONResponse(
            status_code=400,
            content={
                "status": "error",
                "detail": "This phone number is already registered",
            },
        )

    return JSONResponse(
        status_code=200,
        content={
            "status": "success",
            "lead_id": lead.id,
            "message": "Quote request received. Our team will contact you shortly.",
        },
    )


@router.get("/storefront", response_model=schemas.StorefrontPublicResponse)
def get_storefront_public(db: Session = Depends(get_db)) -> schemas.StorefrontPublicResponse:
    raw = app_settings_service.get_setting_dict(
        db, "business_info", app_settings_service.DEFAULT_BUSINESS_INFO
    )

    def s(key: str) -> str:
        v = raw.get(key)
        return str(v).strip() if v is not None else ""

    return schemas.StorefrontPublicResponse(
        business_name=s("business_name"),
        phone=s("phone"),
        whatsapp=s("whatsapp"),
        email=s("email"),
        address=s("address"),
    )


@router.get("/catalog-categories")
def list_catalog_categories(db: Session = Depends(get_db)) -> list[str]:
    return catalog_category_list_service.list_merged_catalog_categories(db)


@router.get(
    "/catalog/catalogues",
    response_model=list[schemas.CatalogueCardResponse],
)
def list_catalogue_cards_public(
    db: Session = Depends(get_db),
) -> list[schemas.CatalogueCardResponse]:
    rows = catalog_category_profiles_service.list_catalogue_cards(
        db, only_active_products=True
    )
    return [schemas.CatalogueCardResponse.model_validate(r) for r in rows]


@router.get("/products", response_model=list[schemas.CatalogProductResponse])
def list_products(db: Session = Depends(get_db)) -> list[schemas.CatalogProductResponse]:
    rows = product_service.list_products(db)
    return [schemas.CatalogProductResponse.model_validate(r) for r in rows]


@router.get("/catalog/media/{key:path}")
def get_public_catalog_media(key: str) -> Response:
    """
    Serve catalog images without exposing R2 credentials to the browser.
    Use when the r2.dev / public URL returns 401 (bucket not public).
    """
    try:
        body, content_type = r2_storage_service.get_catalog_object(key)
    except ValueError as exc:
        msg = str(exc)
        if "is not configured" in msg:
            raise HTTPException(
                status_code=503,
                detail="Image storage is not configured",
            ) from exc
        raise HTTPException(status_code=400, detail=msg) from exc
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Image not found") from None
    except Exception:
        logger.exception("public catalog media fetch failed")
        raise HTTPException(status_code=500, detail="Failed to load image") from None

    return Response(
        content=body,
        media_type=content_type or "application/octet-stream",
        headers={"Cache-Control": "public, max-age=600"},
    )
