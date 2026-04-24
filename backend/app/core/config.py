from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    ENVIRONMENT: str = "development"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7


    # GitHub OAuth
    GITHUB_CLIENT_ID: str = ""
    GITHUB_CLIENT_SECRET: str = ""
    GITHUB_REDIRECT_URI: str = "http://127.0.0.1:8000/auth/github/callback"
    ENVIRONMENT: str = "development"
    # Encryption for GitHub tokens
    ENCRYPTION_KEY: str = "V4b5gxkYREWRMc3NDzwbPzypjCtasGVSKzdNiSn8xSQ="
    GITLEAKS_PATH: str = "D:\Skillpulse Downloads\gitleaks_8.29.1_windows_x64"

    ai_mode: str = "openrouter"
    ollama_base_url: str = "http://localhost:11434/v1"
    ollama_model: str = "qwen3:14b"
    openrouter_api_key: str = "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"
    openrouter_model: str = "qwen/qwen3-14b"
    class Config:
        env_file = ".env"
     
     
settings = Settings()
