from fastapi import FastAPI
import models
from database import Base, engine
from db_schema_ensure import ensure_maps_business_ai_columns, ensure_maps_business_geo_columns
from routes import admin, public

app = FastAPI(
    title="Star Uniform API",
    description="Lead generation backend for Star Uniform platform.",
    version="0.1.0",
)

app.include_router(public.router, prefix="/api/public", tags=["public"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])


@app.on_event("startup")
def startup() -> None:
    # Keep schema creation simple for scaffold/dev mode.
    Base.metadata.create_all(bind=engine)
    ensure_maps_business_geo_columns(engine)
    ensure_maps_business_ai_columns(engine)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
