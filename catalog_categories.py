"""Canonical product catalogue segments for the public catalog and admin."""

# Display order: hospitality groups first, then food & beverage roles.
PRODUCT_CATALOG_CATEGORIES: tuple[str, ...] = (
    "Hotels",
    "Restaurants",
    "Catering",
)

# Map older seeded / free-text values to the canonical label on read/write.
_LEGACY_TO_CANONICAL: dict[str, str] = {
    "hotel": "Hotels",
    "hotels": "Hotels",
    "restaurant": "Restaurants",
    "restaurants": "Restaurants",
    "bar": "Catering",
    "chef": "Catering",
    "catering": "Catering",
}


def display_category(value: str | None) -> str | None:
    """Normalize category for API responses (legacy DB rows, consistent UI labels)."""
    if value is None or not str(value).strip():
        return None
    s = str(value).strip()
    if s in PRODUCT_CATALOG_CATEGORIES:
        return s
    mapped = _LEGACY_TO_CANONICAL.get(s.lower())
    if mapped:
        return mapped
    return s


def validate_catalog_category(value: str | None) -> str | None:
    """
    Accept only canonical categories (or legacy aliases that map to them).
    Empty string clears the category.
    """
    if value is None:
        return None
    if not str(value).strip():
        return None
    s = str(value).strip()
    if s in PRODUCT_CATALOG_CATEGORIES:
        return s
    mapped = _LEGACY_TO_CANONICAL.get(s.lower())
    if mapped:
        return mapped
    allowed = ", ".join(PRODUCT_CATALOG_CATEGORIES)
    raise ValueError(f"Invalid category. Use one of: {allowed}")
