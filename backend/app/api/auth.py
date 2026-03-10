from operator import or_
import re
from fastapi import APIRouter, Depends, HTTPException, Response, Cookie , status
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from app.db.database import get_db
from app.db.models import User, RefreshToken
from app.core.auth_utils import hash_password, verify_password, create_access_token, create_refresh_token, hash_refresh_token, decode_access_token, get_current_user
from passlib.hash import argon2
from app.db.models import UserRole
from app.core.config import settings
from datetime import datetime, timedelta, timezone
from fastapi import Request
from slowapi.util import get_remote_address
from app.core.rate_limiter import limiter
from pydantic import BaseModel, EmailStr, Field, validator

router = APIRouter(prefix="/auth", tags=["auth"])

class UserRegister(BaseModel):
    username: str = Field(..., min_length=3, max_length=20, pattern=r"^[a-zA-Z0-9_-]+$")
    full_name: str = Field(..., min_length=3, max_length=100)
    work_email: EmailStr
    role: UserRole
    
    password: str = Field(..., min_length=8)

    
    @validator('full_name')
    def name_must_not_be_empty(cls, v):
        if not v.strip():
            raise ValueError('Full name cannot be empty spaces')
        return v.title()
    @validator('password')
    def password_strength(cls, v):
        if not re.search(r"\d", v):
            raise ValueError('Password must contain at least one digit (0-9)')
        if not re.search(r"[A-Z]", v):
            raise ValueError('Password must contain at least one uppercase letter (A-Z)')
        if not re.search(r"[a-z]", v):
            raise ValueError('Password must contain at least one lowercase letter (a-z)')
        if not re.search(r"[ !@#$%^&*()_+\-=\[\]{};':\"\\|,.<>\/?]", v):
            raise ValueError('Password must contain at least one special character (@#$%...)')
        return v
class UserLogin(BaseModel):
    username: str
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str

class RoleUpdate(BaseModel):
        role: UserRole


@router.patch("/role")
def update_role(data: RoleUpdate, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    current_user.role = data.role
    db.commit()
    return {"message": "Role updated", "role": data.role.value}


@router.get("/whoami-full")
def whoami_full(current_user=Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "full_name": current_user.full_name,
        "work_email": current_user.work_email,
        "avatar_url": getattr(current_user, "avatar_url", None),
        "role": current_user.role.value if current_user.role else None 
    }


@router.post("/register")
@limiter.limit("3/minute")
def register(request: Request, user: UserRegister, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == user.username).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already registered"
        )
    if db.query(User).filter(User.work_email == user.work_email).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    new_user = User(
        full_name=user.full_name,
        username=user.username,
        work_email=user.work_email,
        hashed_password=hash_password(user.password),
        role=user.role
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {"message": "User registered successfully", "user_id": new_user.id}


@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
def login(
    request: Request,
    user: UserLogin,
    response: Response,
    db: Session = Depends(get_db)
):
    db_user = db.query(User).filter(
        or_(User.username == user.username, User.work_email.ilike( user.username))
    ).first()
    
    if not db_user or not verify_password(user.password, db_user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid credentials")

    access_token = create_access_token(
        data={
            "sub": str(db_user.id),
            "role": db_user.role.value
        },
        expires_delta=timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    )

    raw_refresh_token, hashed_refresh_token = create_refresh_token()
    refresh_expires = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )

    db_refresh = RefreshToken(
        token=hashed_refresh_token,
        user_id=db_user.id,
        expires_at=refresh_expires
    )

    db.add(db_refresh)
    db.commit()

    response.set_cookie(
        key="refresh_token",
        value=raw_refresh_token,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",        
        samesite="strict",
        expires=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    )

    return {
        "access_token": access_token,
        "token_type": "bearer"
    }
    

@router.post("/refresh")
def refresh(
    response: Response,
    refresh_token: str = Cookie(None),
    db: Session = Depends(get_db)
):

    if not refresh_token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    

    # Cleanup expired tokens
    db.query(RefreshToken).filter(
        RefreshToken.expires_at < datetime.now(timezone.utc)
    ).delete()
    db.commit()

    hashed_incoming = hash_refresh_token(refresh_token)

    db_token = db.query(RefreshToken).filter(
        RefreshToken.token == hashed_incoming
    ).first()

    if not db_token:
        # Possible reuse attack
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    # Check if expired
    if db_token.expires_at < datetime.now(timezone.utc):
        db.delete(db_token)
        db.commit()
        raise HTTPException(status_code=401, detail="Refresh token expired")

    user_id = db_token.user_id

    # Token Rotation
    db.delete(db_token)

    new_raw_refresh_token, new_hashed_refresh_token = create_refresh_token()
    new_expiry = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )

    new_db_token = RefreshToken(
        token=new_hashed_refresh_token,
        user_id=user_id,
        expires_at=new_expiry
    )

    db.add(new_db_token)
    db.commit()

    # Create new access token
    user = db.query(User).filter(User.id == user_id).first()

    new_access_token = create_access_token(
        data={
            "sub": str(user_id),
            "role": user.role.value
        },
        expires_delta=timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )
    )

    # Update Cookie
    response.set_cookie(
        key="refresh_token",
        value=new_raw_refresh_token,
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="strict",
        expires=settings.REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60
    )

    return {
        "access_token": new_access_token,
        "token_type": "bearer"
    }

@router.post("/logout")
def logout(
    response: Response,
    refresh_token: str = Cookie(None),
    db: Session = Depends(get_db)
):

    if refresh_token:
        hashed_incoming = hash_refresh_token(refresh_token)

        db_token = db.query(RefreshToken).filter(
            RefreshToken.token == hashed_incoming
        ).first()

        if db_token:
            db.delete(db_token)
            db.commit()

    response.delete_cookie(
        key="refresh_token",
        httponly=True,
        secure=settings.ENVIRONMENT == "production",
        samesite="strict"
    )

    return {"message": "Logged out successfully"}


@router.get("/whoami")
def who_am_i(current_user = Depends(get_current_user)):
    return {
        "id": current_user.id,
        "username": current_user.username,
        "role": current_user.role.value if current_user.role else None
    }
    
    
