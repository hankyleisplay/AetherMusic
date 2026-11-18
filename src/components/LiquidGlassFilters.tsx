import { useMemo } from "react";

/**
 * Generates a 256x256 sRGB optical displacement map on an offscreen canvas.
 * R channel encodes X displacement, G channel encodes Y displacement (128 = neutral).
 * Uses a rounded-rectangle signed-distance bevel profile so edges refract light
 * like a curved thick glass lens while keeping the center crystal-clear for text.
 */
function buildLensDisplacementDataUrl(
  bevelRatio: number,
  cornerRadiusRatio: number,
  rippleStrength: number
): string {
  if (typeof document === "undefined") return "";
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  const img = ctx.createImageData(size, size);
  const data = img.data;
  const half = 0.5;
  const innerHalf = half - cornerRadiusRatio;

  for (let py = 0; py < size; py++) {
    const v = (py + 0.5) / size;
    const cy = v - half;
    const ay = Math.abs(cy);

    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const cx = u - half;
      const ax = Math.abs(cx);

      // Signed distance inside a rounded square [-0.5, 0.5]^2
      const qx = Math.max(ax - innerHalf, 0);
      const qy = Math.max(ay - innerHalf, 0);
      const outerLen = Math.hypot(qx, qy);
      const insideDist =
        outerLen > 0
          ? cornerRadiusRatio - outerLen
          : Math.min(half - ax, half - ay);

      // Normalized distance inward from the glass edge
      const t = Math.max(0, Math.min(1, 1 - insideDist / bevelRatio));
      // Smooth curved convex glass normal profile (quartic ease-in)
      const bevelMag = t * t * (2 - t * 0.65);

      // Outward/inward normal vector for refraction bending
      let nx = 0;
      let ny = 0;
      if (outerLen > 0.0001) {
        nx = (cx >= 0 ? 1 : -1) * (qx / outerLen);
        ny = (cy >= 0 ? 1 : -1) * (qy / outerLen);
      } else {
        const dx = half - ax;
        const dy = half - ay;
        if (dx < dy) {
          nx = cx >= 0 ? 1 : -1;
        } else {
          ny = cy >= 0 ? 1 : -1;
        }
      }

      // Subtle fluid glass surface undulation
      const rippleX =
        rippleStrength * Math.sin(u * Math.PI * 3.0 + v * Math.PI * 1.5);
      const rippleY =
        rippleStrength * Math.cos(v * Math.PI * 3.0 - u * Math.PI * 1.5);

      // Pull backdrop inward at bevel edges (convex lens refraction)
      const dispX = Math.max(-1, Math.min(1, -nx * bevelMag * 0.88 + rippleX));
      const dispY = Math.max(-1, Math.min(1, -ny * bevelMag * 0.88 + rippleY));

      const idx = (py * size + px) * 4;
      data[idx] = Math.round(128 + dispX * 127);
      data[idx + 1] = Math.round(128 + dispY * 127);
      data[idx + 2] = 128;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/png");
}

export function supportsBackdropSvgRefraction(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // Chromium / Edge / WebView2 / Android WebView reliably support backdrop-filter: url(#svgFilter)
  return /Chrome|Chromium|Edg|Android/i.test(ua) && !/Firefox/i.test(ua);
}

export function LiquidGlassFilters() {
  const { panelMapUrl, pillMapUrl } = useMemo(
    () => ({
      panelMapUrl: buildLensDisplacementDataUrl(0.14, 0.1, 0.035),
      pillMapUrl: buildLensDisplacementDataUrl(0.26, 0.22, 0.045),
    }),
    []
  );

  if (!panelMapUrl || !pillMapUrl) {
    return null;
  }

  return (
    <svg
      className="liquid-svg-defs"
      aria-hidden="true"
      width="0"
      height="0"
      focusable="false"
    >
      <defs>
        {/* Optical Edge Refraction + RGB Cauchy Chromatic Dispersion for Glass Panels */}
        <filter
          id="liquid-refract-panel"
          x="-4%"
          y="-4%"
          width="108%"
          height="108%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={panelMapUrl}
            x="0"
            y="0"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="dispMap"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="dispMap"
            scale="18"
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispR"
          />
          <feColorMatrix
            in="dispR"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="redOnly"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="dispMap"
            scale="25"
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispG"
          />
          <feColorMatrix
            in="dispG"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="greenOnly"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="dispMap"
            scale="33"
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispB"
          />
          <feColorMatrix
            in="dispB"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="blueOnly"
          />
          <feBlend in="redOnly" in2="greenOnly" mode="screen" result="rg" />
          <feBlend in="rg" in2="blueOnly" mode="screen" result="refracted" />
        </filter>

        {/* Stronger Convex Lens Refraction + Dispersion for Floating Pills, Hero & Player Bar */}
        <filter
          id="liquid-refract-pill"
          x="-6%"
          y="-6%"
          width="112%"
          height="112%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={pillMapUrl}
            x="0"
            y="0"
            width="100%"
            height="100%"
            preserveAspectRatio="none"
            result="dispMap"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="dispMap"
            scale="24"
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispR"
          />
          <feColorMatrix
            in="dispR"
            type="matrix"
            values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="redOnly"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="dispMap"
            scale="33"
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispG"
          />
          <feColorMatrix
            in="dispG"
            type="matrix"
            values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
            result="greenOnly"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="dispMap"
            scale="42"
            xChannelSelector="R"
            yChannelSelector="G"
            result="dispB"
          />
          <feColorMatrix
            in="dispB"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
            result="blueOnly"
          />
          <feBlend in="redOnly" in2="greenOnly" mode="screen" result="rg" />
          <feBlend in="rg" in2="blueOnly" mode="screen" result="refracted" />
        </filter>
      </defs>
    </svg>
  );
}
