# Production backend image for the Helm / minikube deployment.
#
# Differences from Dockerfile.dev:
#   - No host bind-mount assumed: source is COPY'd into the image.
#   - Uvicorn runs without --reload (gated by UVICORN_RELOAD env in entrypoint).
#   - /app/data is created for the PVC-backed SQLite file
#     (DATABASE_URL is supplied by the backend ConfigMap in the chart).

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY app ./app
COPY scripts ./scripts
COPY docker-entrypoint.sh ./
COPY pytest.ini ./

RUN chmod +x /app/docker-entrypoint.sh \
    && mkdir -p /app/data

EXPOSE 8000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
