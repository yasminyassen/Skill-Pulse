from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from fastapi import Depends
# from sqlalchemy.orm import Session
# from app.db.database import get_db
# from app.db import models
from app.api import auth


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

app.include_router(auth.router)