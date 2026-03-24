from sqlalchemy import Boolean, DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Lead(Base):
    __tablename__ = "leads"
    __table_args__ = (
        Index("idx_leads_phone", "phone"),
        Index("idx_leads_region", "region"),
        Index("idx_leads_status", "status"),
        Index("idx_leads_category", "category"),
        Index("idx_leads_created", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)

    source: Mapped[str] = mapped_column(String(50), nullable=False, default="website_form")
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    status: Mapped[str] = mapped_column(String(50), nullable=False, default="new")

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    called_date: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    called_by: Mapped[str | None] = mapped_column(String(255), nullable=True)
    interested: Mapped[str | None] = mapped_column(String(20), nullable=True)  # yes | no | maybe
    conversation_details: Mapped[str | None] = mapped_column(Text, nullable=True)

    business_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    region: Mapped[str | None] = mapped_column(String(100), nullable=True)

    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_contacted: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    next_follow_up_at: Mapped[DateTime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class MapsBusiness(Base):
    __tablename__ = "maps_businesses"
    __table_args__ = (
        Index("idx_maps_region", "region"),
        Index("idx_maps_category", "category"),
        Index("idx_maps_phone", "phone"),
        Index("idx_maps_created", "scraped_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    google_place_id: Mapped[str | None] = mapped_column(String(255), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(500), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    website: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    review_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    region: Mapped[str | None] = mapped_column(String(100), nullable=True)

    scraped_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    is_converted_to_lead: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    contact_status: Mapped[str] = mapped_column(
        String(50), nullable=False, default="not_contacted"
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(150), unique=True, index=True, nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class TeamMember(Base):
    __tablename__ = "team_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class AppSetting(Base):
    """Key-value JSON blobs for admin UI preferences and last scrape metadata."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")


class CatalogCategoryProfile(Base):
    """Rich catalogue metadata for admin + client showcase (cover, SKU prefix, CTA)."""

    __tablename__ = "catalog_category_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    sku_prefix: Mapped[str] = mapped_column(String(24), nullable=False, default="")
    cover_image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    badge_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    cta_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )


class CatalogProduct(Base):
    __tablename__ = "catalog_products"
    __table_args__ = (
        Index("idx_catalog_products_active", "active"),
        Index("idx_catalog_products_category", "category"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    sku: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
