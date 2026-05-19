#config
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ENVIRONMENT: str = "development"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    COOKIE_SAMESITE: str = "lax"
    COOKIE_SECURE: bool = False


    # GitHub OAuth
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_REDIRECT_URI: str = "http://localhost:8000/auth/github/callback"
    FRONTEND_URL: str = "http://localhost:5173"
    ENVIRONMENT: str = "development"
    # Encryption for GitHub tokens
    ENCRYPTION_KEY: str = "V4b5gxkYREWRMc3NDzwbPzypjCtasGVSKzdNiSn8xSQ="
    GITLEAKS_PATH: str = "gitleaks"
    SEMGREP_PATH: str = "semgrep"
    ai_mode: str = "openrouter"
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model: str = "qwen3:14b"
    openrouter_api_key: str = ""
    openrouter_model: str = "qwen/qwen3-14b"
    openrouter_api_url: str = "https://openrouter.ai/api/v1"
    llm_max_retries: int = 1
    llm_context_limit: int = 32000

    class Config:
        env_file = ".env"
     
     
settings = Settings()
