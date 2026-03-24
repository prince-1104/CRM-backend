from fastapi import FastAPI

import models
from database import Base, engine
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


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
