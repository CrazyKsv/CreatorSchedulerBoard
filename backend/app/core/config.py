from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    app_name: str = "Creator Scheduler API"
    debug: bool = True
    # SQLite: use file in project root for easy access and persistence
    database_url: str = "sqlite+aiosqlite:///./scheduler.db"
    secret_key: str = "change-me-in-production-use-env-var"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 24 hours
    # Comma-separated list of allowed CORS origins. In the docker-compose
    # dev stack the defaults cover the Vite dev server; in the Helm /
    # minikube deploy the frontend is served same-origin via ingress so
    # CORS never fires, but we still expose CORS_ORIGINS for overrides.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    # ── Moonshot (Kimi) — used by /api/v1/agent/chat ──
    # The API key has no default; the agent endpoint will refuse to
    # call upstream until it's set. Put the real key in backend/.env
    # (gitignored) — never commit it.
    moonshot_api_key: str = ""
    moonshot_base: str = "https://api.moonshot.ai/v1"
    moonshot_model: str = "kimi-k2.5"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        # SEED_ON_EMPTY and other shell-only keys may live in .env for
        # the docker entrypoint; ignore them here instead of erroring.
        extra = "ignore"


settings = Settings()
