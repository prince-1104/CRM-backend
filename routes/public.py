from typing import Any

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import get_db
from services import leads as lead_service
from services import products as product_service

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


@router.get("/products")
def list_products():
    return product_service.list_products()
