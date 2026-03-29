import html
import logging
import os

import httpx

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"


class ResendAPIError(Exception):
    """Resend returned a non-success status (e.g. 403 invalid key / domain / recipient)."""

    def __init__(self, message: str, *, status_code: int) -> None:
        self.status_code = status_code
        super().__init__(message)


def _resend_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        msg = data.get("message")
        if isinstance(msg, str) and msg.strip():
            return msg.strip()
    except Exception:
        pass
    text = (response.text or "").strip()
    if text:
        return text[:500]
    return f"Resend API HTTP {response.status_code}"


def send_admin_setup_email(*, to_email: str, setup_url: str) -> None:
    api_key = (os.getenv("RESEND_API_KEY") or "").strip()
    if not api_key:
        raise ValueError("RESEND_API_KEY is not configured")

    from_addr = (os.getenv("RESEND_FROM_EMAIL") or "onboarding@resend.dev").strip()
    safe_url = html.escape(setup_url, quote=True)
    body = (
        "<p>Click the link below to choose a password and activate your admin login.</p>"
        f'<p><a href="{safe_url}">Set up admin account</a></p>'
        "<p>If you did not request this, you can ignore this email.</p>"
    )
    payload: dict = {
        "from": f"Star Uniform <{from_addr}>",
        "to": [to_email],
        "subject": "Finish setting up your Star Uniform admin account",
        "html": body,
    }
    reply_to = os.getenv("RESEND_REPLY_TO")
    if reply_to:
        payload["reply_to"] = reply_to

    with httpx.Client(timeout=30.0) as client:
        r = client.post(
            RESEND_API_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        if r.is_success:
            return
        detail = _resend_error_detail(r)
        logger.warning("Resend API error %s: %s", r.status_code, detail)
        raise ResendAPIError(detail, status_code=r.status_code)
