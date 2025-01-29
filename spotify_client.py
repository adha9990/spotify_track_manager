import spotipy
from spotipy.oauth2 import SpotifyOAuth
from dotenv import load_dotenv
import os

# 載入 .env 文件中的環境變數
load_dotenv()

# 從環境變數中獲取 Spotify 應用程式的 Client ID 和 Client Secret
CLIENT_ID = os.getenv("CLIENT_ID")
CLIENT_SECRET = os.getenv("CLIENT_SECRET")
REDIRECT_URI = os.getenv("REDIRECT_URI")

# 設定授權範圍
SCOPE = "user-library-read user-library-modify"

# 建立 Spotipy 客戶端
print("正在建立 Spotify 客戶端...")
sp = spotipy.Spotify(
    auth_manager=SpotifyOAuth(
        client_id=CLIENT_ID,
        client_secret=CLIENT_SECRET,
        redirect_uri=REDIRECT_URI,
        scope=SCOPE,
    )
)
print("Spotify 客戶端建立完成")
