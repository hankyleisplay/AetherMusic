import { useEffect, useRef } from "react";

interface SpectrumCanvasProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  variant?: "stage" | "wide" | "mini";
}

export function SpectrumCanvas({
  analyser,
  isPlaying,
  variant = "stage",
}: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const dims =
    variant === "mini"
      ? { width: 96, height: 26, bars: 18, gap: 2 }
      : variant === "wide"
        ? { width: 520, height: 64, bars: 52, gap: 3 }
        : { width: 320, height: 52, bars: 36, gap: 3 };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const style = getComputedStyle(document.documentElement);
      const rgb1 = style.getPropertyValue("--accent-rgb-1").trim() || "124, 92, 255";
      const rgb2 = style.getPropertyValue("--accent-rgb-2").trim() || "56, 189, 248";

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, `rgb(${rgb1})`);
      grad.addColorStop(1, `rgb(${rgb2})`);
      ctx.fillStyle = grad;

      if (analyser && dataArray && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
      }

      const barCount = dims.bars;
      const gap = dims.gap;
      const barWidth = Math.max(2, (w - gap * (barCount - 1)) / barCount);

      for (let i = 0; i < barCount; i++) {
        let ratio = 0.1;
        if (isPlaying && analyser && dataArray) {
          const binIndex = Math.min(
            dataArray.length - 1,
            Math.floor((i / barCount) * (dataArray.length * 0.68))
          );
          const raw = dataArray[binIndex] / 255;
          ratio = Math.max(0.1, raw);
        } else if (isPlaying) {
          ratio = 0.16 + 0.14 * Math.sin(Date.now() * 0.006 + i * 0.45);
        }

        const barHeight = Math.max(3, ratio * (h - 4));
        const x = i * (barWidth + gap);
        const y = variant === "wide" ? h - barHeight : (h - barHeight) / 2;
        const r = Math.min(3, barWidth / 2);

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, r);
        ctx.fill();
      }

      if (isPlaying) {
        rafId = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [analyser, isPlaying, dims.bars, dims.gap, variant]);

  const cls =
    variant === "mini"
      ? "visualizer-canvas mini"
      : variant === "wide"
        ? "visualizer-canvas wide"
        : "visualizer-canvas";

  return (
    <canvas
      ref={canvasRef}
      width={dims.width}
      height={dims.height}
      className={cls}
    />
  );
}
