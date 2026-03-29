import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt

SECRET_KEY = os.getenv("JWT_SECRET_KEY", "change_me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
ADMIN_SETUP_TOKEN_TYPE = "admin_setup"
ADMIN_SETUP_EXPIRE_MINUTES = int(os.getenv("ADMIN_SETUP_TOKEN_MINUTES", "60"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/login")


def hash_password(password: str) -> str:
    # bcrypt rejects secrets > 72 bytes; admin passwords from the UI stay well under this.
    pw = password.encode("utf-8")
    if len(pw) > 72:
        raise ValueError("Password is too long")
    hashed = bcrypt.hashpw(pw, bcrypt.gensalt())
    return hashed.decode("ascii")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        pw = plain_password.encode("utf-8")
        if len(pw) > 72:
            return False
        return bcrypt.checkpw(pw, hashed_password.encode("ascii"))
    except (ValueError, TypeError):
        return False


def create_access_token(subject: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_admin_setup_token(email: str, expires_delta: timedelta | None = None) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=ADMIN_SETUP_EXPIRE_MINUTES)
    )
    payload = {
        "sub": email.strip().lower(),
        "typ": ADMIN_SETUP_TOKEN_TYPE,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_admin_setup_token(token: str) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired setup link",
        ) from exc
    if payload.get("typ") != ADMIN_SETUP_TOKEN_TYPE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired setup link",
        )
    subject = payload.get("sub")
    if not subject or not isinstance(subject, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired setup link",
        )
    return subject.strip().lower()


def decode_access_token(token: str) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        subject = payload.get("sub")
        if subject is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
            )
        return str(subject)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        ) from exc


def get_current_admin(token: str = Depends(oauth2_scheme)) -> str:
    return decode_access_token(token)
