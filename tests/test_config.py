"""設定載入測試。"""

import pytest
from pydantic import ValidationError

from stm.config import Settings


def test_loads_credentials_from_env(monkeypatch):
    monkeypatch.setenv("CLIENT_ID", "cid")
    monkeypatch.setenv("CLIENT_SECRET", "secret")
    settings = Settings(_env_file=None)
    assert settings.client_id == "cid"
    assert settings.client_secret == "secret"


def test_has_sensible_defaults(monkeypatch):
    monkeypatch.setenv("CLIENT_ID", "cid")
    monkeypatch.setenv("CLIENT_SECRET", "secret")
    settings = Settings(_env_file=None)
    assert "user-library-modify" in settings.scope
    assert settings.redirect_uri.startswith("http")


def test_missing_credentials_raises(monkeypatch):
    monkeypatch.delenv("CLIENT_ID", raising=False)
    monkeypatch.delenv("CLIENT_SECRET", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
