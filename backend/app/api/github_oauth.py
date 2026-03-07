from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.db.models import User, RefreshToken, UserRole
from app.core.auth_utils import create_access_token, create_refresh_token, encrypt_github_token
from app.core.config import settings
from datetime import datetime, timedelta, timezone
import httpx

router = APIRouter(prefix="/auth", tags=["github"])

GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_USER_URL = "https://api.github.com/user"
GITHUB_EMAIL_URL = "https://api.github.com/user/emails"

@router.get("/github")
def github_login():
    """Redirect URL to send user to GitHub OAuth"""
    github_auth_url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={settings.GITHUB_CLIENT_ID}"
        f"&redirect_uri={settings.GITHUB_REDIRECT_URI}"
        f"&scope=user:email"
    )
    return {"url": github_auth_url}


@router.get("/github/callback")
async def github_callback(code: str, response: Response, db: Session = Depends(get_db)):
    """Exchange GitHub code for access token and log user in"""

    # 1. Exchange code for GitHub access token
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            GITHUB_TOKEN_URL,
            headers={"Accept": "application/json"},
            data={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": settings.GITHUB_REDIRECT_URI,
            }
        )
        token_data = token_res.json()

    github_access_token = token_data.get("access_token")
    if not github_access_token:
        raise HTTPException(status_code=400, detail="GitHub OAuth failed")

    # 2. Get GitHub user info
    async with httpx.AsyncClient() as client:
        user_res = await client.get(
            GITHUB_USER_URL,
            headers={"Authorization": f"Bearer {github_access_token}"}
        )
        github_user = user_res.json()

        email_res = await client.get(
            GITHUB_EMAIL_URL,
            headers={"Authorization": f"Bearer {github_access_token}"}
        )
        emails = email_res.json()

    github_id = str(github_user.get("id"))
    username = github_user.get("login")
    full_name = github_user.get("name") or username
    avatar_url = github_user.get("avatar_url")

    # Get primary verified email
    work_email = None
    if isinstance(emails, list):
        for e in emails:
            if e.get("primary") and e.get("verified"):
                work_email = e.get("email")
                break

    if not work_email:
        raise HTTPException(status_code=400, detail="No verified email found on GitHub account")

    # Encrypt token before storing
    encrypted_token = encrypt_github_token(github_access_token)

    # 3. Find or create user
    db_user = db.query(User).filter(User.github_id == github_id).first()

    if not db_user:
        if db.query(User).filter(User.username == username).first():
            username = f"{username}_gh"
        if db.query(User).filter(User.work_email == work_email).first():
            raise HTTPException(status_code=400, detail="Email already registered with a different account")

        db_user = User(
            github_id=github_id,
            username=username,
            full_name=full_name,
            work_email=work_email,
            hashed_password="",
            role=UserRole.developer,
            avatar_url=avatar_url,
            github_access_token=encrypted_token,  # ✅ encrypted
        )
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    else:
        # Update token on every login
        db_user.github_access_token = encrypted_token
        db.commit()

    # 4. Create JWT tokens
    access_token = create_access_token(
        data={"sub": str(db_user.id), "role": db_user.role.value},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )

    raw_refresh_token, hashed_refresh_token = create_refresh_token()
    refresh_expires = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    db_refresh = RefreshToken(
        token=hashed_refresh_token,
        user_id=db_user.id,
        expires_at=refresh_expires
    )
    db.add(db_refresh)
    db.commit()

    # 5. Set HttpOnly refresh token cookie
    response.set_cookie(
        key="refresh_token",
        value=raw_refresh_token,
        httponly=True,
       secure=settings.ENVIRONMENT == "production",
        samesite="lax",
        expires=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    )

    # 6. Redirect to frontend
    frontend_url = f"http://localhost:5173/auth/github/callback?token={access_token}"
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=frontend_url)