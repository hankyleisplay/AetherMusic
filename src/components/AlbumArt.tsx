import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { buildFallbackCoverSvgDataUrl, getThumbnailCandidates } from "../utils/artworkFallback";

interface AlbumArtProps {
  thumbnailUrl?: string;
  videoId?: string;
  title?: string;
  artist?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  loading?: "lazy" | "eager";
}

export function AlbumArt({
  thumbnailUrl,
  videoId,
  title,
  artist,
  className,
  style,
  onClick,
  loading = "lazy",
}: AlbumArtProps) {
  const candidates = useMemo(
    () => getThumbnailCandidates(thumbnailUrl, videoId, title, artist),
    [thumbnailUrl, videoId, title, artist]
  );
  const fallbackBg = useMemo(
    () => buildFallbackCoverSvgDataUrl(title, artist, videoId),
    [title, artist, videoId]
  );

  const [candidateIdx, setCandidateIdx] = useState(0);

  useEffect(() => {
    setCandidateIdx(0);
  }, [thumbnailUrl, videoId, title, artist]);

  const activeSrc = candidates[Math.min(candidateIdx, candidates.length - 1)] || fallbackBg;

  return (
    <img
      src={activeSrc}
      alt={title || "Album Art"}
      className={className}
      loading={loading}
      referrerPolicy="no-referrer"
      onClick={onClick}
      onError={() => {
        setCandidateIdx((prev) => (prev + 1 < candidates.length ? prev + 1 : prev));
      }}
      style={{
        backgroundImage: `url("${fallbackBg}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        ...style,
      }}
    />
  );
}
