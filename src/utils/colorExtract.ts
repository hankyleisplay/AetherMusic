/**
 * Extract two dominant accent RGB triplets from an album thumbnail
 * using a tiny 24x24 offscreen canvas for negligible CPU/GPU overhead.
 */
export async function extractAlbumAccentRgb(
  imageUrl: string
): Promise<[string, string] | null> {
  if (!imageUrl) return null;

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    let settled = false;

    const finish = (res: [string, string] | null) => {
      if (!settled) {
        settled = true;
        resolve(res);
      }
    };

    const timer = setTimeout(() => finish(null), 2500);

    img.onload = () => {
      clearTimeout(timer);
      try {
        const size = 24;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          finish(null);
          return;
        }
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;

        let r1 = 0, g1 = 0, b1 = 0, c1 = 0;
        let r2 = 0, g2 = 0, b2 = 0, c2 = 0;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const sat = max === 0 ? 0 : (max - min) / max;
          const lum = (r + g + b) / 3;

          if (lum < 28 || lum > 235) continue;
          if (sat > 0.25) {
            if (i < data.length / 2) {
              r1 += r; g1 += g; b1 += b; c1++;
            } else {
              r2 += r; g2 += g; b2 += b; c2++;
            }
          }
        }

        if (c1 === 0 && c2 === 0) {
          finish(null);
          return;
        }
        const primary = c1 > 0
          ? `${Math.round(r1 / c1)}, ${Math.round(g1 / c1)}, ${Math.round(b1 / c1)}`
          : "124, 92, 255";
        const secondary = c2 > 0
          ? `${Math.round(r2 / c2)}, ${Math.round(g2 / c2)}, ${Math.round(b2 / c2)}`
          : "56, 189, 248";
        finish([primary, secondary]);
      } catch {
        finish(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };

    img.src = imageUrl;
  });
}
