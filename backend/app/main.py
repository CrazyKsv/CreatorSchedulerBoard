import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import init_db
from app.core.publisher import start_publisher, stop_publisher
from app.api import auth, posts, series, stats, agent


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # 006 — auto-publish polling loop. Skip during pytest to keep tests
    # deterministic (test_publisher drives `tick_once` directly).
    if os.environ.get("PYTEST_CURRENT_TEST") is None:
        start_publisher(app)
    try:
        yield
    finally:
        await stop_publisher()


app = FastAPI(
    title="Creator Scheduler API",
    description="API for the Creator Scheduler take-home evaluation.",
    lifespan=lifespan,
)

_cors_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(posts.router, prefix="/api/v1")
app.include_router(series.router, prefix="/api/v1")
app.include_router(stats.router, prefix="/api/v1")
app.include_router(agent.router, prefix="/api/v1")


@app.get("/")
async def root():
    return {"message": "Creator Scheduler API", "docs": "/docs"}
