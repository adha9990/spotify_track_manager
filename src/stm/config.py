"""應用程式設定:從環境變數 / .env 載入並驗證。"""

from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Spotify 憑證設定;缺少必填項會在啟動時就報錯。"""

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    client_id: str
    client_secret: str
    redirect_uri: str = "http://127.0.0.1:8888/callback"
    scope: str = (
        "user-library-read user-library-modify "
        "user-modify-playback-state user-read-playback-state"
    )
    # 選填:web player 的 sp_dc cookie,設了才會抓非官方播放次數 + 本地化名稱(serve)
    sp_dc: str | None = None
    # 取本地化歌名 / 歌手用的語系(與你的 Spotify app 顯示一致);沿用 Accept-Language
    locale: str = "zh-TW"
