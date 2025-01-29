from collections import defaultdict
import os


def get_favorite_tracks(sp):
    """獲取使用者的喜愛歌曲"""
    print("正在獲取使用者的喜愛歌曲...")
    results = sp.current_user_saved_tracks()
    tracks = []
    while results:
        for item in results["items"]:
            track = item["track"]
            tracks.append(track)
        results = sp.next(results) if results["next"] else None
    print(f"已獲取 {len(tracks)} 首歌曲")
    return tracks


def write_tracks_to_file(tracks, filename, header):
    """將歌曲列表寫入文件，並包含歌曲 ID"""
    output_dir = os.getenv("OUTPUT_DIR", "output/")
    os.makedirs(output_dir, exist_ok=True)  # 確保目錄存在
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(f"{header} (共 {len(tracks)} 首歌曲)\n")
        for track in tracks:
            f.write(
                f"  - {track['name']} by {track['artists'][0]['name']} (ID: {track['id']})\n"
            )
    print(f"已寫入 {filepath}")


def find_duplicate_tracks(tracks):
    """找出重複名稱的歌曲，並進一步分類"""
    print("正在找出重複名稱的歌曲...")
    track_names = defaultdict(list)
    track_name_artist = defaultdict(list)

    for track in tracks:
        track_names[track["name"]].append(track)
        track_name_artist[(track["name"], track["artists"][0]["name"])].append(track)

    # 找出重複名稱與演唱者的歌曲
    duplicate_name_artist_tracks = {
        (name, artist): t
        for (name, artist), t in track_name_artist.items()
        if len(t) > 1
    }

    # 找出僅重複名稱的歌曲，排除重複名稱與演唱者的歌曲
    duplicate_name_tracks = {
        name: [
            track
            for track in t
            if (name, track["artists"][0]["name"]) not in duplicate_name_artist_tracks
        ]
        for name, t in track_names.items()
        if len(t) > 1
    }

    # 移除空的項目
    duplicate_name_tracks = {name: t for name, t in duplicate_name_tracks.items() if t}

    print(f"找到 {len(duplicate_name_tracks)} 個重複名稱的歌曲")
    print(f"找到 {len(duplicate_name_artist_tracks)} 個重複名稱與演唱者的歌曲")

    return duplicate_name_tracks, duplicate_name_artist_tracks


def find_unplayable_tracks(tracks):
    """找出已失效的歌曲"""
    print("正在找出已失效的歌曲...")
    unplayable_tracks = [track for track in tracks if not track["is_playable"]]
    print(f"找到 {len(unplayable_tracks)} 個已失效的歌曲")
    return unplayable_tracks


def delete_track(sp, track_id):
    """刪除指定的單首歌曲，並顯示刪除的歌曲名稱和歌手資訊"""
    print(f"正在刪除歌曲 ID: {track_id}...")
    try:
        # 獲取要刪除的歌曲資訊
        track_info = sp.track(track_id)

        # 刪除歌曲
        sp.current_user_saved_tracks_delete([track_id])

        print(
            f"已刪除: {track_info['name']} by {track_info['artists'][0]['name']} (ID: {track_info['id']})"
        )

    except Exception as e:
        print(f"刪除歌曲時發生錯誤: {e}")


def delete_duplicate_artist_tracks(sp, duplicate_name_artist_tracks):
    """刪除重複名稱與演唱者的歌曲，只保留每組中的一首"""
    print("正在刪除重複名稱與演唱者的歌曲，只保留每組中的一首...")

    # 使用 defaultdict 將同樣的歌曲名稱和歌手分類為一組
    grouped_tracks = defaultdict(list)
    for (name, artist), tracks in duplicate_name_artist_tracks.items():
        grouped_tracks[(name, artist)].extend(tracks)

    # 遍歷每組，保留第一首，刪除其餘的
    for (name, artist), tracks in grouped_tracks.items():
        for track in tracks[1:]:
            delete_track(sp, track["id"])

    print(f"以刪除 {len(grouped_tracks)} 個重複名稱與演唱者的歌曲")
