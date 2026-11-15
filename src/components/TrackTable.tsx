import { Download, Heart, ListEnd, ListPlus, Loader2, Play, Sparkles, Trash2 } from "lucide-react";
import type { Track } from "../types";
import { AlbumArt } from "./AlbumArt";

interface TrackTableProps {
  tracks: Track[];
  currentVideoId?: string;
  favoriteIds: Set<string>;
  downloadingIds?: Set<string>;
  onPlayTrack: (track: Track, index: number) => void;
  onPlayNext: (track: Track) => void;
  onAddToQueue: (track: Track) => void;
  onToggleFavorite: (track: Track) => void;
  onDownloadTrack?: (track: Track) => void;
  onRemoveAt?: (index: number) => void;
  showAutoBadge?: boolean;
}

export function TrackTable({
  tracks,
  currentVideoId,
  favoriteIds,
  downloadingIds,
  onPlayTrack,
  onPlayNext,
  onAddToQueue,
  onToggleFavorite,
  onDownloadTrack,
  onRemoveAt,
  showAutoBadge = false,
}: TrackTableProps) {
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

        return (
          <div
            key={`${track.videoId}-${idx}`}
            className={`track-row item ${isCurrent ? "active" : ""}`}
            onDoubleClick={() => onPlayTrack(track, idx)}
          >
            <div className="track-idx tabular-nums">
              {isCurrent ? (
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
                <div className="track-artist truncate" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="truncate">{track.artist}</span>
                  {showAutoBadge && track.isAutoRecommended && (
                    <span className="auto-tag">
                      <Sparkles size={10} /> 自動推薦
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="track-album track-album-col truncate" title={track.album}>
              {track.album || "單曲"}
            </div>

            <div className="track-dur tabular-nums">{track.durationText || "0:00"}</div>

            <div className="track-actions">
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
              <button
                type="button"
                className={`action-icon-btn ${isFav ? "liked" : ""}`}
                title={isFav ? "取消收藏" : "加入收藏"}
                onClick={() => onToggleFavorite(track)}
              >
                <Heart size={14} fill={isFav ? "currentColor" : "none"} />
              </button>
              {onDownloadTrack && !track.localFileUrl && !track.videoId.startsWith("local-") && (
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
                  title="從佇列移除"
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
