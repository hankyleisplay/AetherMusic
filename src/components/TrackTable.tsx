import { useState } from "react";
import {
  Download,
  FolderPlus,
  GripVertical,
  Heart,
  ListEnd,
  ListPlus,
  Loader2,
  Play,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { CustomPlaylist, Track } from "../types";
import { AlbumArt } from "./AlbumArt";

interface TrackTableProps {
  tracks: Track[];
  currentVideoId?: string;
  favoriteIds: Set<string>;
  downloadingIds?: Set<string>;
  playlists?: CustomPlaylist[];
  onPlayTrack: (track: Track, index: number) => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onDownloadTrack?: (track: Track) => void;
  onRemoveAt?: (index: number) => void;
  onClickArtist?: (artist: string) => void;
  onClickAlbum?: (album: string, artist: string) => void;
  onAddToPlaylist?: (playlistId: string, track: Track) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  showAutoBadge?: boolean;
}

export function TrackTable({
  tracks,
  currentVideoId,
  favoriteIds,
  downloadingIds,
  playlists,
  onPlayTrack,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  onDownloadTrack,
  onRemoveAt,
  onClickArtist,
  onClickAlbum,
  onAddToPlaylist,
  onReorder,
  showAutoBadge = false,
}: TrackTableProps) {
  const [openMenuIdx, setOpenMenuIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  if (tracks.length === 0) {
    return null;
  }

  return (
    <div className="track-table">
      <div className="track-row header">
        <div className="track-idx">#</div>
        <div>歌曲 / 藝人</div>
        <div className="track-album-col">專輯</div>
        <div className="track-dur">時長</div>
        <div style={{ textAlign: "right" }}>操作</div>
      </div>

      {tracks.map((track, idx) => {
        const isCurrent = track.videoId === currentVideoId;
        const isFav = favoriteIds.has(track.videoId);
        const isDragTarget = dragOverIdx === idx && dragIdx !== null && dragIdx !== idx;

        return (
          <div
            key={`${track.videoId}-${idx}`}
            className={`track-row item ${isCurrent ? "active" : ""} ${isDragTarget ? "drag-over" : ""}`}
            draggable={Boolean(onReorder)}
            onDragStart={() => setDragIdx(idx)}
            onDragOver={(e) => {
              if (!onReorder || dragIdx === null) return;
              e.preventDefault();
              if (dragOverIdx !== idx) setDragOverIdx(idx);
            }}
            onDragLeave={() => {
              if (dragOverIdx === idx) setDragOverIdx(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (onReorder && dragIdx !== null && dragIdx !== idx) {
                onReorder(dragIdx, idx);
              }
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            onDragEnd={() => {
              setDragIdx(null);
              setDragOverIdx(null);
            }}
            onDoubleClick={() => onPlayTrack(track, idx)}
          >
            <div className="track-idx tabular-nums">
              {onReorder ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                  <GripVertical size={12} style={{ opacity: 0.45, cursor: "grab" }} />
                  {isCurrent ? (
                    <Play size={13} fill="currentColor" style={{ color: "#38bdf8" }} />
                  ) : (
                    idx + 1
                  )}
                </span>
              ) : isCurrent ? (
                <Play size={14} fill="currentColor" style={{ color: "#38bdf8" }} />
              ) : (
                idx + 1
              )}
            </div>

            <div className="track-main">
              <AlbumArt
                thumbnailUrl={track.thumbnailUrl}
                videoId={track.videoId}
                title={track.title}
                artist={track.artist}
                className="track-thumb"
              />
              <div className="track-text">
                <div className="track-name truncate" title={track.title}>
                  {track.title}
                </div>
                <div
                  className="track-artist truncate"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  {onClickArtist && track.artist && track.artist !== "未知藝人" ? (
                    <button
                      type="button"
                      className="entity-link truncate"
                      title={`檢視藝人「${track.artist}」`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClickArtist(track.artist);
                      }}
                    >
                      {track.artist}
                    </button>
                  ) : (
                    <span className="truncate">{track.artist}</span>
                  )}
                  {showAutoBadge && track.isAutoRecommended && (
                    <span className="auto-tag">
                      <Sparkles size={10} /> 自動推薦
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="track-album track-album-col truncate" title={track.album}>
              {onClickAlbum && track.album && track.album !== "單曲" ? (
                <button
                  type="button"
                  className="entity-link truncate"
                  title={`檢視專輯「${track.album}」`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClickAlbum(track.album, track.artist);
                  }}
                >
                  {track.album}
                </button>
              ) : (
                track.album || "單曲"
              )}
            </div>

            <div className="track-dur tabular-nums">{track.durationText || "0:00"}</div>

            <div className="track-actions" style={{ position: "relative" }}>
              <button
                type="button"
                className="action-icon-btn"
                title="立即播放"
                onClick={() => onPlayTrack(track, idx)}
              >
                <Play size={14} fill="currentColor" />
              </button>
              <button
                type="button"
                className="action-icon-btn"
                title="下一首播放"
                onClick={() => onPlayNext(track)}
              >
                <ListPlus size={14} />
              </button>
              <button
                type="button"
                className="action-icon-btn"
                title="加入佇列"
                onClick={() => onAddToQueue(track)}
              >
                <ListEnd size={14} />
              </button>
              {playlists && playlists.length > 0 && onAddToPlaylist && (
                <button
                  type="button"
                  className="action-icon-btn"
                  title="加入自訂歌單"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuIdx((prev) => (prev === idx ? null : idx));
                  }}
                >
                  <FolderPlus size={14} />
                </button>
              )}
              {openMenuIdx === idx && playlists && playlists.length > 0 && onAddToPlaylist && (
                <div className="playlist-popover" onClick={(e) => e.stopPropagation()}>
                  <div className="playlist-popover-title">加入至歌單</div>
                  {playlists.map((pl) => (
                    <button
                      key={pl.id}
                      type="button"
                      className="playlist-popover-item truncate"
                      onClick={() => {
                        onAddToPlaylist(pl.id, track);
                        setOpenMenuIdx(null);
                      }}
                    >
                      {pl.name} ({pl.tracks.length})
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                className={`action-icon-btn ${isFav ? "liked" : ""}`}
                title={isFav ? "取消收藏" : "加入收藏"}
                onClick={() => onToggleFavorite(track)}
              >
                <Heart size={14} fill={isFav ? "currentColor" : "none"} />
              </button>
              {onDownloadTrack &&
                !track.localFileUrl &&
                !track.localFilePath &&
                !track.videoId.startsWith("local-") && (
                  <button
                    type="button"
                    className="action-icon-btn"
                    title="下載至本機（含封面與中繼資料）"
                    disabled={downloadingIds?.has(track.videoId)}
                    onClick={() => onDownloadTrack(track)}
                  >
                    {downloadingIds?.has(track.videoId) ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Download size={14} />
                    )}
                  </button>
                )}
              {onRemoveAt && (
                <button
                  type="button"
                  className="action-icon-btn"
                  title="移除"
                  onClick={() => onRemoveAt(idx)}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
