import re
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import desc, func, nulls_last, or_
from sqlalchemy.orm import Session

import models


def validate_phone(phone: str) -> str:
    """Normalize and validate phone; raises ValueError with user-facing detail."""
    if not phone or not str(phone).strip():
        raise ValueError("Invalid phone format")
    cleaned = str(phone).strip()
    if len(cleaned) > 20:
        raise ValueError("Invalid phone format")
    digits = re.sub(r"\D", "", cleaned)
    if len(digits) < 10 or len(digits) > 15:
        raise ValueError("Invalid phone format")
    return cleaned


def create_website_form_lead(db: Session, name: str, phone: str) -> models.Lead:
    phone_value = validate_phone(phone)
    lead = models.Lead(
        name=name.strip(),
        phone=phone_value,
        source="website_form",
        status="new",
        notes=None,
        called_date=None,
        called_by=None,
        interested=None,
        conversation_details=None,
        business_name=None,
        address=None,
        website=None,
        rating=None,
        review_count=None,
        category=None,
        region=None,
        email=None,
        last_contacted=None,
        next_follow_up_at=None,
    )
    db.add(lead)
    db.commit()
    db.refresh(lead)
    return lead


def get_lead(db: Session, lead_id: int) -> models.Lead | None:
    return db.query(models.Lead).filter(models.Lead.id == lead_id).first()


def update_lead(db: Session, lead_id: int, data: dict[str, Any]) -> models.Lead | None:
    lead = get_lead(db, lead_id)
    if not lead:
        return None
    allowed = {
        "status",
        "notes",
        "called_date",
        "called_by",
        "interested",
        "conversation_details",
        "region",
        "last_contacted",
        "next_follow_up_at",
    }
    updated = False
    for key, value in data.items():
        if key in allowed:
            setattr(lead, key, value)
            updated = True
    if updated:
        lead.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(lead)
    return lead


def bulk_update_leads_status(db: Session, lead_ids: list[int], status: str) -> int:
    n = 0
    for lid in lead_ids:
        lead = get_lead(db, lid)
        if lead:
            lead.status = status
            n += 1
    db.commit()
    return n


def query_leads_paginated(
    db: Session,
    *,
    page: int = 1,
    limit: int = 50,
    status: list[str] | None = None,
    region: str | None = None,
    source: str | None = None,
    called_from: date | None = None,
    called_to: date | None = None,
    interested: str | None = None,
    search: str | None = None,
    sort: str | None = None,
) -> tuple[list[models.Lead], int]:
    q = db.query(models.Lead)

    if status:
        q = q.filter(models.Lead.status.in_(status))
    if region:
        q = q.filter(models.Lead.region == region)
    if source:
        q = q.filter(models.Lead.source == source)
    if called_from:
        q = q.filter(
            models.Lead.called_date.isnot(None),
            models.Lead.called_date
            >= datetime.combine(called_from, datetime.min.time()),
        )
    if called_to:
        q = q.filter(
            models.Lead.called_date.isnot(None),
            models.Lead.called_date
            <= datetime.combine(called_to, datetime.max.time()),
        )
    if interested:
        q = q.filter(models.Lead.interested == interested)
    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(models.Lead.name.ilike(term), models.Lead.phone.ilike(term))
        )

    total = q.count()

    raw_sort = (sort or "-created_at").strip()
    descending = raw_sort.startswith("-")
    sort_key = raw_sort[1:].lower() if descending else raw_sort.lower()
    if not sort_key:
        sort_key = "created_at"
        descending = True

    if sort_key == "name":
        q = q.order_by(
            models.Lead.name.desc() if descending else models.Lead.name.asc()
        )
    elif sort_key == "phone":
        q = q.order_by(
            models.Lead.phone.desc() if descending else models.Lead.phone.asc()
        )
    elif sort_key == "source":
        q = q.order_by(
            models.Lead.source.desc() if descending else models.Lead.source.asc()
        )
    elif sort_key == "status":
        q = q.order_by(
            models.Lead.status.desc() if descending else models.Lead.status.asc()
        )
    elif sort_key == "called_date":
        q = q.order_by(
            nulls_last(desc(models.Lead.called_date))
            if descending
            else nulls_last(models.Lead.called_date.asc())
        )
    elif sort_key == "updated_at":
        q = q.order_by(
            desc(models.Lead.updated_at)
            if descending
            else models.Lead.updated_at.asc()
        )
    else:
        q = q.order_by(
            desc(models.Lead.created_at)
            if descending
            else models.Lead.created_at.asc()
        )

    offset = max(0, (page - 1) * limit)
    rows = q.offset(offset).limit(limit).all()
    return rows, total


def get_lead_stats(db: Session) -> dict[str, Any]:
    total = db.query(func.count(models.Lead.id)).scalar() or 0
    by_status = dict(
        db.query(models.Lead.status, func.count(models.Lead.id))
        .group_by(models.Lead.status)
        .all()
    )
    not_called = (
        db.query(func.count(models.Lead.id))
        .filter(models.Lead.status == "new")
        .scalar()
        or 0
    )
    called = by_status.get("called", 0)
    interested = (
        db.query(func.count(models.Lead.id))
        .filter(models.Lead.interested == "yes")
        .scalar()
        or 0
    )
    closed = by_status.get("closed", 0)
    return {
        "total": total,
        "not_called": not_called,
        "called": called,
        "interested": interested,
        "closed": closed,
        "by_status": by_status,
    }


def list_leads(db: Session, skip: int = 0, limit: int = 50) -> list[models.Lead]:
    return (
        db.query(models.Lead)
        .order_by(models.Lead.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def list_all_leads_for_export(db: Session) -> list[models.Lead]:
    return db.query(models.Lead).order_by(models.Lead.created_at.desc()).all()


def get_leads_daily_stats(db: Session, days: int = 30) -> list[dict[str, Any]]:
    days = min(max(days, 1), 90)
    start = datetime.utcnow() - timedelta(days=days)
    day_expr = func.date(models.Lead.created_at)
    rows = (
        db.query(day_expr, func.count(models.Lead.id))
        .filter(models.Lead.created_at >= start)
        .group_by(day_expr)
        .order_by(day_expr)
        .all()
    )
    out: list[dict[str, Any]] = []
    for d, cnt in rows:
        ds = d.isoformat() if hasattr(d, "isoformat") else str(d)
        out.append({"date": ds, "count": int(cnt)})
    return out


def bulk_delete_leads(db: Session, lead_ids: list[int]) -> int:
    if not lead_ids:
        return 0
    n = (
        db.query(models.Lead)
        .filter(models.Lead.id.in_(lead_ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return int(n)


def bulk_update_leads_by_action(
    db: Session,
    lead_ids: list[int],
    action: str,
    data: dict[str, Any] | None,
) -> int:
    """mark_called | mark_interested | change_status — returns rows updated."""
    payload = data or {}
    n = 0
    for lid in lead_ids:
        lead = get_lead(db, lid)
        if not lead:
            continue
        if action == "mark_called":
            lead.status = "called"
            if payload.get("called_date") is not None:
                lead.called_date = payload["called_date"]
            else:
                lead.called_date = datetime.utcnow()
            if payload.get("called_by") is not None:
                lead.called_by = str(payload["called_by"])
        elif action == "mark_interested":
            interested_val = payload.get("interested", "yes")
            lead.interested = str(interested_val) if interested_val is not None else "yes"
            if payload.get("status") is not None:
                lead.status = str(payload["status"])
        elif action == "change_status":
            if payload.get("status") is not None:
                lead.status = str(payload["status"])
            for key in (
                "notes",
                "called_date",
                "called_by",
                "interested",
                "conversation_details",
                "region",
                "last_contacted",
                "next_follow_up_at",
            ):
                if key in payload and payload[key] is not None:
                    setattr(lead, key, payload[key])
            if payload.get("next_follow_up") is not None:
                lead.next_follow_up_at = payload["next_follow_up"]
        else:
            raise ValueError(f"Unknown action: {action}")
        n += 1
    db.commit()
    return n
