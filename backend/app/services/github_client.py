import httpx
from fastapi import HTTPException

GITHUB_API_BASE = "https://api.github.com"

_GITHUB_HEADERS = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
}


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
        raise HTTPException(
            status_code=403,
            detail="GitHub API rate limit exceeded or your token lacks the required permissions.",
        )
    if response.status_code == 404:
        raise HTTPException(
            status_code=404,
            detail=f"The requested {resource} was not found or is not accessible with your GitHub account.",
        )
    raise HTTPException(
        status_code=502,
        detail=f"Unexpected response from GitHub API (HTTP {response.status_code}).",
    )
