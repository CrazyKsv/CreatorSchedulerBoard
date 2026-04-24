import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_success(client: AsyncClient):
    r = await client.post(
        "/api/auth/register",
        json={
            "email": "new@example.com",
            "password": "secret123",
            "full_name": "New User",
        },
    )
    assert r.status_code == 200
    data = r.json()
    assert data["email"] == "new@example.com"
    assert data["full_name"] == "New User"
    assert "id" in data
    assert "hashed_password" not in data


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={"email": "dup@example.com", "password": "secret123"},
    )
    r = await client.post(
        "/api/auth/register",
        json={"email": "dup@example.com", "password": "other456"},
    )
    assert r.status_code == 400
    assert "already registered" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={"email": "login@example.com", "password": "mypass"},
    )
    r = await client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "mypass"},
    )
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data.get("token_type") == "bearer"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    await client.post(
        "/api/auth/register",
        json={"email": "user@example.com", "password": "correct"},
    )
    r = await client.post(
        "/api/auth/login",
        json={"email": "user@example.com", "password": "wrong"},
    )
    assert r.status_code == 401
    assert "incorrect" in r.json()["detail"].lower()


@pytest.mark.asyncio
async def test_login_unknown_user(client: AsyncClient):
    r = await client.post(
        "/api/auth/login",
        json={"email": "nobody@example.com", "password": "any"},
    )
    assert r.status_code == 401
