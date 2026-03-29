from datetime import date, datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field, computed_field, field_serializer, field_validator


class LeadResponse(BaseModel):
    id: int
    name: str
    phone: str
    source: str
    created_at: datetime
    updated_at: datetime | None
    status: str
    notes: str | None
    called_date: datetime | None
    called_by: str | None
    interested: str | None
    conversation_details: str | None
    business_name: str | None
    address: str | None
    website: str | None
    rating: float | None
    review_count: int | None
    category: str | None
    region: str | None
    email: str | None
    last_contacted: datetime | None
    next_follow_up_at: datetime | None

    model_config = {"from_attributes": True}


LeadUpdatePutStatus = Literal["called", "qualified", "closed", "not_interested"]
LeadUpdatePutInterested = Literal["yes", "no", "maybe"]


class LeadUpdate(BaseModel):
    """Body for PUT /api/admin/leads/{id} — narrow enums; all fields optional."""

    status: LeadUpdatePutStatus | None = None
    notes: str | None = None
    called_date: datetime | None = None
    called_by: str | None = None
    interested: LeadUpdatePutInterested | None = None


class LeadUpdateSuccessResponse(BaseModel):
    status: Literal["success"] = "success"
    data: LeadResponse


class LeadUpdateRequest(BaseModel):
    status: str | None = None
    notes: str | None = None
    called_date: datetime | None = None
    called_by: str | None = None
    interested: str | None = None
    conversation_details: str | None = None
    region: str | None = None
    last_contacted: datetime | None = None
    next_follow_up_at: datetime | None = Field(
        None,
        validation_alias=AliasChoices("next_follow_up_at", "next_follow_up"),
    )


class LeadBulkStatusRequest(BaseModel):
    lead_ids: list[int] = Field(..., min_length=1)
    status: str


class LeadBulkUpdateRequest(BaseModel):
    lead_ids: list[int] = Field(..., min_length=1)
    action: Literal["mark_called", "mark_interested", "change_status"]
    data: dict[str, Any] | None = None


class LeadBulkIdsRequest(BaseModel):
    lead_ids: list[int] = Field(..., min_length=1)


class PaginationMeta(BaseModel):
    page: int
    limit: int
    total: int
    pages: int


class LeadPaginatedResponse(BaseModel):
    data: list[LeadResponse]
    pagination: PaginationMeta


class LeadStatsResponse(BaseModel):
    total: int
    not_called: int
    called: int
    interested: int
    closed: int
    by_status: dict[str, int]


class AdminLoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)


class AdminBootstrapRequest(BaseModel):
    """One-time first admin: requires ADMIN_BOOTSTRAP_SECRET; only works while no admins exist."""

    bootstrap_secret: str = Field(..., min_length=1)
    email: EmailStr


class AdminBootstrapCompleteRequest(BaseModel):
    token: str = Field(..., min_length=20)
    password: str = Field(..., min_length=8)


class BootstrapRequestResponse(BaseModel):
    status: Literal["sent"] = "sent"
    detail: str = "If the request was valid, a setup link was sent to that address."


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MapsBusinessResponse(BaseModel):
    id: int
    google_place_id: str | None
    latitude: float | None = None
    longitude: float | None = None
    name: str
    address: str | None
    phone: str | None
    website: str | None
    rating: float | None
    review_count: int | None
    category: str | None
    region: str | None
    scraped_at: datetime
    updated_at: datetime
    is_converted_to_lead: bool
    contact_status: str
    notes: str | None
    ai_confidence: float | None = None
    ai_type: str | None = None
    lead_score: float | None = None
    ai_last_updated: datetime | None = None

    model_config = {"from_attributes": True}

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_hot_lead(self) -> bool:
        if (self.ai_confidence or 0) < 70:
            return False
        ai_type = self.ai_type or ""
        if (
            ai_type.startswith("rejected:")
            or ai_type.startswith("rejected_type:")
            or ai_type == "filtered_junk"
        ):
            return False
        return (self.lead_score or 0) > 90


class ConvertedToLeadRequest(BaseModel):
    is_converted_to_lead: bool


class MapsContactStatusRequest(BaseModel):
    contact_status: str = Field(
        ...,
        description="not_contacted | contacted | interested | not_interested | converted",
    )


class MapsBulkContactRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)
    contact_status: str


class MapsBulkNotesRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)
    note: str = Field(..., max_length=5000)


class MapsBulkIdsRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1)


class NotesUpdateRequest(BaseModel):
    notes: str = Field(default="", max_length=5000)


class MapsCollectionScrapeRequest(BaseModel):
    region: str | None = Field(default=None, min_length=2, max_length=100)
    category: str = Field(..., min_length=2, max_length=100)
    radius_km: int = Field(default=15, ge=5, le=50)
    lat: float | None = None
    lng: float | None = None

    @field_validator("lat", "lng")
    @classmethod
    def _finite_coords(cls, v: float | None) -> float | None:
        if v is None:
            return None
        if v != v:  # NaN
            raise ValueError("Coordinate must be finite")
        return float(v)

    @field_validator("region")
    @classmethod
    def _strip_region(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        return s or None

    @field_validator("category")
    @classmethod
    def _strip_category(cls, v: str) -> str:
        return str(v).strip()

    @field_validator("radius_km")
    @classmethod
    def _round_radius_km(cls, v: int) -> int:
        return int(v)

    @field_validator("lng", mode="after")
    @classmethod
    def _require_region_or_coords(cls, lng: float | None, info):
        data = info.data or {}
        lat = data.get("lat")
        region = data.get("region")
        if region is None and (lat is None or lng is None):
            raise ValueError("Provide either region, or lat+lng")
        if (lat is None) != (lng is None):
            raise ValueError("Provide both lat and lng together")
        return lng


class MapsBusinessPutRequest(BaseModel):
    is_converted_to_lead: bool | None = None
    notes: str | None = None
    contact_status: str | None = Field(
        None,
        description="not_contacted | contacted | interested | not_interested | converted",
    )


class MapsExportPostRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    region: str | None = None
    category: str | None = None
    file_format: Literal["csv", "excel", "pdf"] = Field(default="csv", alias="format")


class MapsRegionResponse(BaseModel):
    name: str
    lat: float
    lng: float
    last_scrape: str | None
    count: int


class MapsBusinessPaginatedResponse(BaseModel):
    data: list[MapsBusinessResponse]
    pagination: PaginationMeta


class TeamMemberResponse(BaseModel):
    id: int
    name: str
    phone: str
    calls_made: int


class TeamMemberCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: str = Field(..., min_length=3, max_length=40)


class TeamMemberUpdateRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    phone: str | None = Field(None, min_length=3, max_length=40)


class LeadDailyPoint(BaseModel):
    date: str
    count: int


class AIScoringRequest(BaseModel):
    region: str | None = None
    category: str | None = None


class AIScoringResponse(BaseModel):
    status: str
    ai_validated: int
    total_processed: int
    message: str


class MapsTestConnectionResponse(BaseModel):
    ok: bool
    message: str


class AccountInfoResponse(BaseModel):
    email: str


class AdminSettingsResponse(BaseModel):
    maps: dict
    business: dict
    export: dict
    account: AccountInfoResponse
    team: list[TeamMemberResponse]


class AdminSettingsPatchRequest(BaseModel):
    maps_defaults: dict | None = None
    business: dict | None = None
    export: dict | None = None


class StorefrontPublicResponse(BaseModel):
    """Safe subset of business info for the public marketing site."""

    business_name: str = ""
    phone: str = ""
    whatsapp: str = ""
    email: str = ""
    address: str = ""


class CatalogProductBase(BaseModel):
    sku: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=255)
    category: str | None = Field(None, max_length=100)
    description: str | None = Field(None, max_length=5000)
    image_url: str | None = Field(None, max_length=1024)
    active: bool = True


def _strip_optional_category(v: object) -> str | None:
    if v is None:
        return None
    if isinstance(v, str) and not v.strip():
        return None
    s = str(v).strip()
    if len(s) > 100:
        raise ValueError("Category must be at most 100 characters")
    return s


class CatalogProductCreateRequest(CatalogProductBase):
    @field_validator("category", mode="before")
    @classmethod
    def normalize_category_create(cls, v: object) -> str | None:
        return _strip_optional_category(v)


class CatalogProductUpdateRequest(BaseModel):
    sku: str | None = Field(None, min_length=1, max_length=100)
    name: str | None = Field(None, min_length=1, max_length=255)
    category: str | None = Field(None, max_length=100)
    description: str | None = Field(None, max_length=5000)
    image_url: str | None = Field(None, max_length=1024)
    active: bool | None = None

    @field_validator("category", mode="before")
    @classmethod
    def normalize_category_update(cls, v: object) -> str | None:
        return _strip_optional_category(v)


class CatalogCategoryCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)


class CatalogCategoryResponse(BaseModel):
    name: str
    categories: list[str]


class CatalogueCardResponse(BaseModel):
    """Single catalogue for admin grid + public showcase."""

    id: int | None = None
    name: str
    sku_prefix: str
    cover_image_url: str | None = None
    badge_label: str | None = None
    cta_label: str | None = None
    sort_order: int = 0
    product_count: int = 0
    preview_product_names: list[str] = Field(default_factory=list)


class CatalogueUpsertRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    sku_prefix: str = Field("", max_length=24)
    cover_image_url: str | None = Field(None, max_length=1024)
    badge_label: str | None = Field(None, max_length=80)
    cta_label: str | None = Field(None, max_length=80)
    sort_order: int = 0


class CatalogProductResponse(CatalogProductBase):
    id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}

    @field_serializer("category")
    def serialize_category(self, value: str | None) -> str | None:
        from catalog_categories import display_category

        return display_category(value)


class CatalogImageUploadResponse(BaseModel):
    key: str
    url: str
