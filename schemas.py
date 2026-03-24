from datetime import date, datetime
from typing import Any, Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, EmailStr, Field


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


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class MapsBusinessResponse(BaseModel):
    id: int
    google_place_id: str | None
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

    model_config = {"from_attributes": True}


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
    region: str = Field(..., min_length=2, max_length=100)
    category: str = Field(..., min_length=2, max_length=100)
    radius_km: int = Field(default=15, ge=5, le=50)


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
    file_format: Literal["csv", "excel"] = Field(default="csv", alias="format")


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
