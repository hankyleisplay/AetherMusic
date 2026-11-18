import { useEffect, useRef } from "react";
import type { VisualizerStyle } from "../types";

interface SpectrumCanvasProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
  variant?: "stage" | "wide" | "mini";
  mode?: VisualizerStyle;
}

export function SpectrumCanvas({
  analyser,
  isPlaying,
  variant = "stage",
  mode = "bars",
}: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const dims =
    variant === "mini"
      ? { width: 96, height: 26, bars: 18, gap: 2 }
      : variant === "wide"
        ? { width: 520, height: 76, bars: 52, gap: 3 }
        : { width: 320, height: 56, bars: 36, gap: 3 };

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

      if (analyser && dataArray && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
      }

      const barCount = dims.bars;
      const sampleRatio = (i: number): number => {
        if (isPlaying && analyser && dataArray) {
          const binIndex = Math.min(
            dataArray.length - 1,
            Math.floor((i / barCount) * (dataArray.length * 0.68))
          );
          return Math.max(0.08, dataArray[binIndex] / 255);
        }
        if (isPlaying) {
          return Math.max(0.1, 0.22 + 0.18 * Math.sin(Date.now() * 0.006 + i * 0.45));
        }
        return 0.08;
      };

      if (mode === "wave" && variant !== "mini") {
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2.4;
        ctx.fillStyle = `rgba(${rgb2}, 0.18)`;

        const midY = h / 2;
        ctx.beginPath();
        ctx.moveTo(0, midY);
        for (let i = 0; i < barCount; i++) {
          const x = (i / (barCount - 1)) * w;
          const amp = sampleRatio(i) * (h * 0.44);
          const sign = i % 2 === 0 ? -1 : 1;
          ctx.lineTo(x, midY + sign * amp);
        }
        ctx.lineTo(w, midY);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, midY);
        for (let i = 0; i < barCount; i++) {
          const x = (i / (barCount - 1)) * w;
          const amp = sampleRatio(i) * (h * 0.36);
          ctx.lineTo(x, midY - amp);
        }
        for (let i = barCount - 1; i >= 0; i--) {
          const x = (i / (barCount - 1)) * w;
          const amp = sampleRatio(i) * (h * 0.36);
          ctx.lineTo(x, midY + amp);
        }
        ctx.closePath();
        ctx.fill();
      } else if (mode === "aurora" && variant !== "mini") {
        let bassEnergy = 0;
        for (let i = 0; i < Math.min(8, barCount); i++) {
          bassEnergy += sampleRatio(i);
        }
        bassEnergy /= Math.min(8, barCount);

        const glow = ctx.createRadialGradient(
          w * 0.5,
          h * 0.5,
          4,
          w * 0.5,
          h * 0.5,
          w * (0.28 + bassEnergy * 0.3)
        );
        glow.addColorStop(0, `rgba(${rgb2}, ${0.35 + bassEnergy * 0.4})`);
        glow.addColorStop(0.55, `rgba(${rgb1}, ${0.22 + bassEnergy * 0.25})`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < barCount; i++) {
          const x = (i / (barCount - 1)) * w;
          const y = h * 0.5 + Math.sin(Date.now() * 0.004 + i * 0.32) * sampleRatio(i) * (h * 0.42);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = grad;
        const gap = dims.gap;
        const barWidth = Math.max(2, (w - gap * (barCount - 1)) / barCount);

        for (let i = 0; i < barCount; i++) {
          const ratio = sampleRatio(i);
          const barHeight = Math.max(3, ratio * (h - 4));
          const x = i * (barWidth + gap);
          const y = variant === "wide" ? h - barHeight : (h - barHeight) / 2;
          const r = Math.min(3, barWidth / 2);

          ctx.beginPath();
          ctx.roundRect(x, y, barWidth, barHeight, r);
          ctx.fill();
        }
      }

      if (isPlaying) {
        rafId = requestAnimationFrame(draw);
      }
    };

    draw();
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [analyser, isPlaying, dims.bars, dims.gap, variant, mode]);

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
