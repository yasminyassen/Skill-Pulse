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

router = APIRouter(prefix="/auth", tags=["auth"])

class UserRegister(BaseModel):
    username: str
    full_name: str
    work_email: EmailStr
    role: UserRole
    password: str
    
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
        "role": current_user.role.value
    }


@router.post("/register")
def register(user: UserRegister, db: Session = Depends(get_db)):
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
def login(
    user: UserLogin,
    response: Response,
    db: Session = Depends(get_db)
):
    print(f"DEBUG — received: username='{user.username}' password='{user.password}'")  # ← add this
    db_user = db.query(User).filter(User.username == user.username).first()
    if not db_user:
        raise HTTPException(status_code=400, detail="Invalid credentials")

    if not verify_password(user.password, db_user.hashed_password):
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
        "role": current_user.role.value
    }
    
    
