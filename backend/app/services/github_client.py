import asyncio
import base64
import os
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.auth_utils import decrypt_github_token, encrypt_github_token
from app.core.config import settings
from app.db.models import User

GITHUB_API_BASE = "https://api.github.com"
GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token"

_GITHUB_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


def _expires_at_from_seconds(seconds: int | None) -> datetime | None:
    if seconds is None:
        return None

    # Apply small skew so we refresh slightly before hard expiry.
    safe_seconds = max(int(seconds) - 30, 0)
    return datetime.now(timezone.utc) + timedelta(seconds=safe_seconds)


async def refresh_github_access_token_for_user(db: Session, user: User) -> str | None:
    """
    Refresh GitHub OAuth access token using stored encrypted refresh token.
    Returns decrypted access token on success, else None.
    """
    if not user.github_refresh_token:
        return None

    now = datetime.now(timezone.utc)
    if user.github_refresh_token_expires_at and user.github_refresh_token_expires_at <= now:
        return None

    try:
        raw_refresh_token = decrypt_github_token(user.github_refresh_token)
    except Exception:
        return None

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            GITHUB_OAUTH_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "grant_type": "refresh_token",
                "refresh_token": raw_refresh_token,
            },
        )

    if not response.is_success:
        return None

    token_data = response.json()
    new_access_token = token_data.get("access_token")
    if not new_access_token:
        return None

    user.github_access_token = encrypt_github_token(new_access_token)
    user.github_token_expires_at = _expires_at_from_seconds(token_data.get("expires_in"))

    new_refresh_token = token_data.get("refresh_token")
    if new_refresh_token:
        user.github_refresh_token = encrypt_github_token(new_refresh_token)

    refresh_expires_in = token_data.get("refresh_token_expires_in")
    if refresh_expires_in is not None:
        user.github_refresh_token_expires_at = _expires_at_from_seconds(refresh_expires_in)

    db.add(user)
    db.commit()
    db.refresh(user)
    return new_access_token


# async def fetch_user_repos(github_token: str, page: int = 1, per_page: int = 50) -> list[dict]:
#     """
#     Fetch repositories owned by the authenticated GitHub user.
#     Returns raw GitHub API data — caller is responsible for filtering fields.

#     Uses 'affiliation=owner' so only repos the user created are returned,
#     not repos they are a collaborator or org member of.
#     """
#     async with httpx.AsyncClient(timeout=10.0) as client:
#         response = await client.get(
#             f"{GITHUB_API_BASE}/user/repos",
#             headers={**_GITHUB_HEADERS, "Authorization": f"Bearer {github_token}"},
#             params={
#                 "affiliation": "owner,collaborator,organization_member",
#                 "sort": "updated",
#                 "direction": "desc",
#                 "per_page": per_page,
#                 "page": page,
#             },
#         )

#     _raise_for_github_error(response)
#     return response.json()


async def verify_repo_access(github_token: str | None, full_name: str) -> dict:
    headers = {**_GITHUB_HEADERS}

    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        response = await client.get(
            f"{GITHUB_API_BASE}/repos/{full_name}",
            headers=headers
        )

    _raise_for_github_error(response, resource="repository")
    return response.json()


async def get_branch_head_sha(
    github_token: str | None,
    full_name: str,
    branch: str,
) -> str | None:
    headers = {**_GITHUB_HEADERS}
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(
                f"{GITHUB_API_BASE}/repos/{full_name}/commits/{branch}",
                headers=headers,
                params={"per_page": 1},
            )
        if response.is_success:
            return response.json().get("sha")
    except Exception:
        pass
    return None

async def fetch_repo_python_files(
    github_token: str | None,
    full_name: str,
    branch: str,
) -> list[dict]:
    """Fetch repository tree and return Python files with raw content."""
    headers = {**_GITHUB_HEADERS}
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    async with httpx.AsyncClient(timeout=20.0) as client:
        tree_res = await client.get(
            f"{GITHUB_API_BASE}/repos/{full_name}/git/trees/{branch}",
            headers=headers,
            params={"recursive": 1},
        )
        _raise_for_github_error(tree_res, resource="repository tree")
        tree_data = tree_res.json()

        tree_entries = tree_data.get("tree", [])
        python_blobs = [
            item
            for item in tree_entries
            if item.get("type") == "blob" and str(item.get("path", "")).endswith(".py")
        ]

        sem = asyncio.Semaphore(2)

        async def _fetch_file(item: dict) -> dict | None:
            path = item.get("path")
            if not path:
                return None

            async with sem:
                content_res = await client.get(
                    f"{GITHUB_API_BASE}/repos/{full_name}/contents/{path}",
                    headers=headers,
                    params={"ref": branch},
                )
                _raise_for_github_error(content_res, resource=f"file content '{path}'")
                body = content_res.json()

            content_text = ""
            encoding = body.get("encoding")
            if encoding == "base64" and body.get("content"):
                raw = body["content"].replace("\n", "")
                content_text = base64.b64decode(raw).decode("utf-8", errors="replace")
            elif body.get("download_url"):
                raw_res = await client.get(body["download_url"], headers=headers)
                _raise_for_github_error(raw_res, resource=f"raw file '{path}'")
                content_text = raw_res.text

            filename = path.rsplit("/", 1)[-1]
            return {
                "filename": filename,
                "path": path,
                "content": content_text,
                "size": int(item.get("size") or len(content_text.encode("utf-8"))),
            }

        files = await asyncio.gather(*[_fetch_file(item) for item in python_blobs])

    return [f for f in files if f is not None]


def read_local_repo_files(repo_path):
    python_files = []
    for root, _, files in os.walk(repo_path):
        for f in files:
            if f.endswith(".py"):
                full_path = os.path.join(root, f)
                with open(full_path, "r", encoding="utf-8", errors="ignore") as file:
                    python_files.append({
                        "filename": f,
                        "path": full_path,
                        "content": file.read()
                    })
    return python_files

def _raise_for_github_error(response: httpx.Response, resource: str = "resource") -> None:
    """Translate GitHub API error responses into clean HTTPExceptions."""
    if response.is_success:
        return
    if response.status_code == 401:
        raise HTTPException(
            status_code=401,
            detail="GitHub token is invalid or expired. Please re-authenticate with GitHub.",
        )
    if response.status_code == 403:
        if "rate limit" in response.text.lower():
            raise HTTPException(status_code=429, detail="rate_limit")
        raise HTTPException(status_code=403, detail="github_forbidden")
    if response.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail=f"The requested {resource} was not found or is not accessible with your GitHub account.",
        )
    raise HTTPException(
        status_code=502,
        detail=f"Unexpected response from GitHub API (HTTP {response.status_code}).",
    )
