import os
import uuid
from io import BytesIO

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from PIL import Image, UnidentifiedImageError


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


def _int_env(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc
    if value <= 0:
        raise ValueError(f"{name} must be > 0")
    return value


def _bool_env(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _optimize_image_to_webp(content: bytes) -> bytes:
    max_edge = _int_env("CATALOG_IMAGE_MAX_EDGE", 1600)
    quality = _int_env("CATALOG_IMAGE_WEBP_QUALITY", 80)
    if quality > 100:
        raise ValueError("CATALOG_IMAGE_WEBP_QUALITY must be <= 100")
    lossless = _bool_env("CATALOG_IMAGE_WEBP_LOSSLESS", False)

    try:
        with Image.open(BytesIO(content)) as img:
            frame = img.convert("RGBA" if "A" in img.getbands() else "RGB")
            frame.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
            output = BytesIO()
            frame.save(
                output,
                format="WEBP",
                quality=quality,
                optimize=True,
                method=6,
                lossless=lossless,
            )
            return output.getvalue()
    except UnidentifiedImageError as exc:
        raise ValueError("Uploaded file is not a valid image") from exc
    except OSError as exc:
        raise ValueError("Failed to process image") from exc


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

    optimized = _optimize_image_to_webp(content)
    key = f"catalog/{uuid.uuid4().hex}.webp"
    resolved_content_type = "image/webp"

    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=optimized,
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
