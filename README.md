# Spotify 歌單管理工具

掃描你的 Spotify 收藏(「我的最愛」或任意 playlist),找出**重複**與**已失效**的歌曲,輸出報表,並可在多重安全機制下自動去除重複歌曲。

## 功能

- **掃描報表(`scan`)**:對歌曲做四種偵測,整理成**單一 Markdown 報表**(各類別為 `##` 分節、附表格)
  - **可信重複**:同名同歌手,或 ISRC 相同(同一錄音)——可被自動去重
  - **同名不同歌手**:標題相同但歌手不同(多為巧合,僅供檢視)
  - **疑似重複(模糊比對)**:名稱相近,例如 remaster / live 版——**僅報告,不自動刪除**
  - **已失效歌曲**:無法播放的歌曲
- **安全去重(`dedupe`)**:對「可信重複」每組只保留一首
  - 預設 **dry-run**,只預覽不刪除;加 `--apply` 才實際刪除
  - 刪除前需**互動確認**(可用 `--yes` 略過)
  - 保留策略可選:`popularity`(預設,保留人氣最高)或 `oldest`(保留最早收藏)
- **支援任意 playlist**:以 `--playlist <id>` 掃描指定歌單,預設為「我的最愛」

## 安裝

需要 Python 3.10+。

```bash
pip install -e .          # 安裝套件與相依
# 或開發模式(含 pytest / ruff)
pip install -e ".[dev]"
```

## 設定

在專案根目錄建立 `.env`(可複製 `.env.example`),填入你的 Spotify API 憑證:

```
CLIENT_ID=your_spotify_client_id
CLIENT_SECRET=your_spotify_client_secret
REDIRECT_URI=http://127.0.0.1:8888/callback
```

憑證可在 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) 建立應用程式後取得,
並把**相同的** `REDIRECT_URI` 加入應用程式的 Redirect URIs 設定(兩邊必須完全一致)。

> Spotify 已不接受 `http://localhost`(視為 insecure redirect URI),請使用回送位址
> `http://127.0.0.1:8888/callback`。`.env` 與 Dashboard 兩處都要設成這個值。

## 使用

```bash
# 掃描「我的最愛」,輸出單一 Markdown 報表 spotify_report.md
stm scan

# 掃描指定 playlist,並指定報表輸出路徑
stm scan --playlist 37i9dQZF1DXcBWIGoYBM5M --output liked_dupes.md

# 預覽去重計畫(不刪除任何東西)
stm dedupe

# 實際去除可信重複,保留人氣最高者(會先要求確認)
stm dedupe --apply

# 保留最早收藏的版本,並略過確認
stm dedupe --apply --keep oldest --yes
```

> 安全提醒:刪除無法復原。建議先跑 `stm dedupe`(dry-run)確認計畫,再加 `--apply`。
> 模糊比對找到的疑似重複**不會**被自動刪除,只會出現在 `scan` 報表中供你人工判斷。

## 專案結構

```
src/stm/
  cli.py        Typer 入口(scan / dedupe 子指令)
  config.py     pydantic-settings 設定與驗證
  client.py     Spotify API 整合(spotipy 薄包裝)
  models.py     Track 值物件(正規化 API 回傳)
  fetch.py      抓取歌曲(分頁)
  detect.py     重複 / 失效偵測(純邏輯)
  dedupe.py     保留策略與刪除計畫
  writers.py    單一 Markdown 報表輸出
tests/          pytest 測試
```

## 開發

```bash
pip install -e ".[dev]"
pytest            # 跑測試
ruff check .      # 靜態檢查
```

核心邏輯(`detect` / `dedupe` / `models`)以 TDD 開發,與 Spotify API 隔離,可離線單元測試。

## 注意事項

- 需要 `user-library-read` 與 `user-library-modify` 權限(程式會自動要求授權)。
- 請勿將 API 憑證或 `.env` 提交到版本控制。
