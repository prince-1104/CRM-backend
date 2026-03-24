"""Team members CRUD and call counts from leads.called_by."""

from __future__ import annotations

from sqlalchemy import func
from sqlalchemy.orm import Session

import models


def list_members_with_call_counts(db: Session) -> list[dict[str, object]]:
    members = (
        db.query(models.TeamMember).order_by(models.TeamMember.name.asc()).all()
    )
    counts: dict[str, int] = dict(
        db.query(models.Lead.called_by, func.count(models.Lead.id))
        .filter(models.Lead.called_by.isnot(None))
        .group_by(models.Lead.called_by)
        .all()
    )
    out: list[dict[str, object]] = []
    for m in members:
        out.append(
            {
                "id": m.id,
                "name": m.name,
                "phone": m.phone,
                "calls_made": counts.get(m.name, 0),
            }
        )
    return out


def create_member(db: Session, name: str, phone: str) -> models.TeamMember:
    row = models.TeamMember(name=name.strip(), phone=phone.strip())
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_member(
    db: Session, member_id: int, name: str | None, phone: str | None
) -> models.TeamMember | None:
    row = db.query(models.TeamMember).filter(models.TeamMember.id == member_id).first()
    if not row:
        return None
    if name is not None:
        row.name = name.strip()
    if phone is not None:
        row.phone = phone.strip()
    db.commit()
    db.refresh(row)
    return row


def delete_member(db: Session, member_id: int) -> bool:
    row = db.query(models.TeamMember).filter(models.TeamMember.id == member_id).first()
    if not row:
        return False
    db.delete(row)
    db.commit()
    return True
