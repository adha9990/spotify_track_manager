"""應用程式設定:從環境變數 / .env 載入並驗證。"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Spotify 憑證與輸出設定;缺少必填項會在啟動時就報錯。"""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    client_id: str
    client_secret: str
    redirect_uri: str = "http://localhost:8888/callback"
    output_dir: Path = Path("output")
    scope: str = "user-library-read user-library-modify"
