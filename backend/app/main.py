import sys
import os


_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_CWD = os.path.abspath(os.getcwd())

for _p in [_BACKEND_DIR, _CWD]:
    if _p not in sys.path:
        sys.path.insert(0, _p)

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import auth
from app.api import github_oauth
from app.api import analysis
from app.api import security_report
from app.api import repos

from app.core.rate_limiter import limiter
from slowapi.middleware import SlowAPIMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler

from ai_services.rag.rag_seeder import seed_standards
from ai_services.learning.resource_seeder import seed_learning_resources

from app.api.profile import router as profile_router



 


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_standards()
    seed_learning_resources()
    yield


app = FastAPI(
    title="SkillPulse API",
    description="AI-assisted developer evaluation platform",
    version="0.1.0",
    lifespan=lifespan,
)

# attach limiter to app state so routers can access it
app.state.limiter = limiter

# handle rate limit exceeded errors
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# activate rate limiting middleware
app.add_middleware(SlowAPIMiddleware)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# routers
app.include_router(auth.router)
app.include_router(github_oauth.router)
app.include_router(analysis.router)
app.include_router(security_report.router)
app.include_router(repos.router)
app.include_router(profile_router)
