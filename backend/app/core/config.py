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
    GITLEAKS_PATH: str = "C:\\Users\\AD\\Downloads\\gitleaks_8.29.1_windows_x64\\gitleaks.exe"

    class Config:
        env_file = ".env"
     
     
settings = Settings()