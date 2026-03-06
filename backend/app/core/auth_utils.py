from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import Optional
from jose import jwt
from passlib.context import CryptContext
from passlib.hash import argon2
from app.core.config import settings
import secrets
from app.db.database import get_db
from fastapi.security import OAuth2PasswordBearer
from app.db.models import User
import hmac
import hashlib
from cryptography.fernet import Fernet



oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

def hash_password(password: str) -> str:
    # Use argon2 for password hashing
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY,
        algorithm=settings.ALGORITHM
    )
    return encoded_jwt
# JWT verification
def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except jwt.JWTError:
        return None
    
    


def hash_refresh_token(raw_token: str) -> str:
    """
    Use HMAC-SHA256 instead of argon2.
    Refresh tokens are already high entropy.
    """
    return hmac.new(
        settings.SECRET_KEY.encode(),
        raw_token.encode(),
        hashlib.sha256
    ).hexdigest()
    

def create_refresh_token():
    raw_token = secrets.token_urlsafe(64)
    hashed_token = hash_refresh_token(raw_token)
    return raw_token, hashed_token



def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)):
    
    payload = decode_access_token(token)

    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )

    user_id = payload.get("sub")

    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload"
        )

    user = db.query(User).filter(User.id == int(user_id)).first()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )

    return user


def require_role(allowed_roles: list):
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role.value not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to access this resource"
            )
        return current_user
    return role_checker
