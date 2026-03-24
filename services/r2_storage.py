import os
import uuid
from pathlib import Path

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


def _required_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise ValueError(f"{name} is not configured")
    return value


def _public_base_url(account_id: str) -> str:
    custom = (os.getenv("R2_PUBLIC_BASE_URL") or "").strip().rstrip("/")
    if custom:
        return custom
    return f"https://pub-{account_id}.r2.dev"


def _content_type(filename: str, fallback: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if ext == ".png":
        return "image/png"
    if ext == ".webp":
        return "image/webp"
    if ext == ".gif":
        return "image/gif"
    return fallback or "application/octet-stream"


def upload_catalog_image(content: bytes, filename: str, content_type: str | None) -> dict[str, str]:
    account_id = _required_env("R2_ACCOUNT_ID")
    bucket = _required_env("R2_BUCKET_NAME")
    access_key = _required_env("R2_ACCESS_KEY_ID")
    secret_key = _required_env("R2_SECRET_ACCESS_KEY")

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    ext = Path(filename).suffix.lower() or ".bin"
    key = f"catalog/{uuid.uuid4().hex}{ext}"
    resolved_content_type = _content_type(filename, content_type or "")

    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=content,
        ContentType=resolved_content_type,
    )

    base = _public_base_url(account_id)
    return {"key": key, "url": f"{base}/{key}"}


def get_catalog_object(key: str) -> tuple[bytes, str | None]:
    """
    Fetch an object from R2 using API credentials (works even when the bucket
    is not exposed via a public r2.dev / custom URL).
    """
    if not key.startswith("catalog/") or "\x00" in key or ".." in key.split("/"):
        raise ValueError("Invalid object key")

    account_id = _required_env("R2_ACCOUNT_ID")
    bucket = _required_env("R2_BUCKET_NAME")
    access_key = _required_env("R2_ACCESS_KEY_ID")
    secret_key = _required_env("R2_SECRET_ACCESS_KEY")

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"
    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )

    try:
        response = client.get_object(Bucket=bucket, Key=key)
    except ClientError as exc:  # pragma: no cover - network
        code = (exc.response or {}).get("Error", {}).get("Code", "")
        if code in ("NoSuchKey", "404", "NotFound"):
            raise FileNotFoundError(key) from exc
        raise

    body = response["Body"].read()
    content_type = response.get("ContentType")
    return body, content_type
