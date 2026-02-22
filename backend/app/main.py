from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from fastapi import Depends
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.db import models


app = FastAPI(
    title="SkillPulse API",
    description="AI-assisted developer evaluation platform",
    version="0.1.0"
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check endpoint
@app.get("/health", tags=["System"])
def health_check():
    return {
        "status": "healthy",
        "environment": settings.ENVIRONMENT,
        "version": "0.1.0"
    }

@app.get("/", tags=["System"])
def root():
    return {"message": "Welcome to SkillPulse API"}


@app.get("/users")
def read_users(db: Session = Depends(get_db)):
    return db.query(models.User).all()
