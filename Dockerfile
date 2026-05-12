# ── Stage 1: dependency builder ──────────────────────────────────────────────
FROM python:3.11-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install only Python deps in this stage (cache-friendly layer)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# ── Stage 2: runtime image ────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    # Cloud Run injects PORT (default 8080). Uvicorn reads this at startup.
    PORT=8080

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application source (respects .dockerignore)
COPY . .

# Run as non-root for Cloud Run security best-practices
RUN adduser --disabled-password --gecos "" appuser \
 && chown -R appuser:appuser /app
USER appuser

# Cloud Run listens on $PORT. Using exec-form CMD so SIGTERM reaches uvicorn.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
