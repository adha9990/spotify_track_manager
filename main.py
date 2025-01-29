from spotify_client import sp
from utils import (
    get_favorite_tracks,
    write_tracks_to_file,
    find_duplicate_tracks,
    find_unplayable_tracks,
    delete_duplicate_artist_tracks,
)
import os

favorite_tracks = get_favorite_tracks(sp)

write_tracks_to_file(favorite_tracks, "favorite_tracks.txt", "所有喜愛的歌曲")

duplicate_name_tracks, duplicate_name_artist_tracks = find_duplicate_tracks(
    favorite_tracks
)
write_tracks_to_file(
    [track for tracks in duplicate_name_tracks.values() for track in tracks],
    "duplicate_name_tracks.txt",
    "重複名稱的歌曲",
)

write_tracks_to_file(
    [track for tracks in duplicate_name_artist_tracks.values() for track in tracks],
    "duplicate_name_artist_tracks.txt",
    "重複名稱與演唱者的歌曲",
)

unplayable_tracks = find_unplayable_tracks(favorite_tracks)

write_tracks_to_file(unplayable_tracks, "unplayable_tracks.txt", "已失效的歌曲")

# 刪除重複名稱與演唱者的歌曲只保留一首
if os.getenv("DELETE_DUPLICATE_ARTIST_TRACKS") == "true":
    delete_duplicate_artist_tracks(sp, duplicate_name_artist_tracks)
