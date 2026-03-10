from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import auth
from app.api import github_oauth
from app.api import analysis
from app.api import security_report

# import SlowAPI rate limiting tools
from app.core.rate_limiter import limiter
from slowapi.middleware import SlowAPIMiddleware
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler


app = FastAPI(
    title="SkillPulse API",
    description="AI-assisted developer evaluation platform",
    version="0.1.0"
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