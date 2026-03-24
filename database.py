import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

# Ensure local development config from backend/.env is loaded.
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./star_uniform.db")

if DATABASE_URL.startswith("sqlite"):
    connect_args: dict = {"check_same_thread": False}
else:
    # Neon and most hosted Postgres require TLS; add sslmode=require to DATABASE_URL
    # or rely on the driver default when the URI already includes it.
    connect_args = {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
