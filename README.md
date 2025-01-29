# Spotify 歌單管理工具

這是一個用於管理 Spotify 歌單的工具，提供多種功能來幫助您整理和管理您的音樂收藏。

## 功能

- **列出所有歌曲列表**：從您的 Spotify 帳戶中獲取並列出所有喜愛的歌曲。
- **列出所有重複歌曲與歌手列表**：找出並列出所有名稱和演唱者都重複的歌曲。
- **列出所有重複歌曲列表**：找出並列出所有名稱重複的歌曲。
- **列出所有已失效歌曲列表**：找出並列出所有已失效的歌曲。
- **刪除重複名稱與演唱者的歌曲**：自動刪除重複名稱與演唱者的歌曲，只保留一首。

## 使用方法

1. **環境設置**：
   - 確保您已經安裝了 Python 和 pip。
   - 使用 `pip install -r requirements.txt` 安裝所需的 Python 套件。
   - 在專案根目錄下創建一個 `.env` 文件，並填入您的 Spotify API 憑證：
     ```
     CLIENT_ID=your_spotify_client_id
     CLIENT_SECRET=your_spotify_client_secret
     REDIRECT_URI=your_redirect_uri
     DELETE_DUPLICATE_ARTIST_TRACKS=true
     ```

2. **運行程式**：
   - 執行 `main.py` 來使用這個工具。
   - 程式將自動生成並輸出各種歌曲列表到 `output/` 目錄中。

## 文件結構

- `main.py`：主程式文件，負責調用各種功能。
- `utils.py`：包含各種輔助函數，如獲取歌曲、寫入文件等。
- `spotify_client.py`：負責與 Spotify API 進行交互。

## 注意事項

- 請確保您的 Spotify 帳戶中有足夠的權限來讀取和修改您的音樂庫。
- 請勿將您的 API 憑證洩露給他人。

## 貢獻

歡迎對本專案進行貢獻！如有任何問題或建議，請提交 issue 或 pull request。 