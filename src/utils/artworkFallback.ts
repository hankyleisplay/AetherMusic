const LUXURY_PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ["#7c5cff", "#0ea5e9", "#ec4899"],
  ["#ec4899", "#f59e0b", "#6366f1"],
  ["#10b981", "#3b82f6", "#8b5cf6"],
  ["#06b6d4", "#6366f1", "#14b8a6"],
  ["#f43f5e", "#a855f7", "#38bdf8"],
  ["#f59e0b", "#ef4444", "#8b5cf6"],
];

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function extractMonogram(title?: string, artist?: string): string {
  const src = (title || artist || "A").trim();
  for (const ch of src) {
    if (/[\p{L}\p{N}]/u.test(ch)) {
      return ch.toUpperCase();
    }
  }
  return "♪";
}

/**
 * Generates an inline SVG vinyl-groove cover data URI so tracks missing artwork
 * or blocked offline still display a crisp, personalized album cover.
 */
export function buildFallbackCoverSvgDataUrl(
  title?: string,
  artist?: string,
  seed?: string
): string {
  const key = (seed || title || artist || "AetherMusic").trim();
  const hash = hashSeed(key);
  const [c1, c2, c3] = LUXURY_PALETTES[hash % LUXURY_PALETTES.length];
  const glyph = escapeXml(extractMonogram(title, artist));
  const idSuffix = (hash % 100000).toString(36);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">
  <defs>
    <linearGradient id="bg-${idSuffix}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${c1}" />
      <stop offset="55%" stop-color="${c2}" />
      <stop offset="100%" stop-color="${c3}" />
    </linearGradient>
    <radialGradient id="glow-${idSuffix}" cx="50%" cy="46%" r="55%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.28" />
      <stop offset="60%" stop-color="#090b14" stop-opacity="0.22" />
      <stop offset="100%" stop-color="#06070d" stop-opacity="0.65" />
    </radialGradient>
  </defs>
  <rect width="240" height="240" fill="url(#bg-${idSuffix})" />
  <rect width="240" height="240" fill="url(#glow-${idSuffix})" />
  <circle cx="120" cy="120" r="88" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="1.5" />
  <circle cx="120" cy="120" r="72" fill="none" stroke="rgba(255,255,255,0.10)" stroke-width="1.2" />
  <circle cx="120" cy="120" r="56" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="1.4" />
  <circle cx="120" cy="120" r="38" fill="rgba(12,15,26,0.52)" stroke="rgba(255,255,255,0.28)" stroke-width="2" />
  <text x="120" y="133" text-anchor="middle" fill="#ffffff" font-family="system-ui,-apple-system,sans-serif" font-size="38" font-weight="700" letter-spacing="1">${glyph}</text>
</svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Returns prioritized artwork URL candidates ending with a guaranteed SVG data URI.
 */
export function getThumbnailCandidates(
  thumbnailUrl?: string,
  videoId?: string,
  title?: string,
  artist?: string
): string[] {
  const candidates: string[] = [];
  const pushUnique = (url: string) => {
    const trimmed = url.trim();
    if (trimmed && !candidates.includes(trimmed)) {
      candidates.push(trimmed);
    }
  };

  if (thumbnailUrl) {
    pushUnique(thumbnailUrl);
    if (thumbnailUrl.includes("=w544-h544-l90-rj")) {
      pushUnique(thumbnailUrl.replace("=w544-h544-l90-rj", "=w226-h226-l90-rj"));
    }
  }

  if (videoId && !videoId.startsWith("local-")) {
    pushUnique(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`);
    pushUnique(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`);
  }

  pushUnique(buildFallbackCoverSvgDataUrl(title, artist, videoId));
  return candidates;
}
