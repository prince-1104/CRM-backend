import os

import google.generativeai as genai

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


def score_lead(message: str | None) -> int:
    if not message:
        return 30

    if not GEMINI_API_KEY:
        return min(100, 40 + len(message) // 6)

    try:
        model = genai.GenerativeModel("gemini-pro")
        prompt = (
            "Score this lead intent from 1 to 100 for school uniform purchase readiness. "
            "Return only an integer.\n\nLead message:\n"
            f"{message}"
        )
        response = model.generate_content(prompt)
        text = (response.text or "").strip()
        value = int("".join(ch for ch in text if ch.isdigit()) or "50")
        return max(1, min(100, value))
    except Exception:
        return min(100, 40 + len(message) // 6)
