import { useEffect, useRef } from "react";

interface SpectrumCanvasProps {
  analyser: AnalyserNode | null;
  isPlaying: boolean;
}

export function SpectrumCanvas({ analyser, isPlaying }: SpectrumCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let rafId = 0;
    const barCount = 36;
    const dataArray = analyser ? new Uint8Array(analyser.frequencyBinCount) : null;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, "#7c5cff");
      grad.addColorStop(1, "#38bdf8");
      ctx.fillStyle = grad;

      if (analyser && dataArray && isPlaying) {
        analyser.getByteFrequencyData(dataArray);
      }

      const gap = 3;
      const barWidth = (w - gap * (barCount - 1)) / barCount;

      for (let i = 0; i < barCount; i++) {
        let ratio = 0.08;
        if (isPlaying && analyser && dataArray) {
          const binIndex = Math.min(
            dataArray.length - 1,
            Math.floor((i / barCount) * (dataArray.length * 0.65))
          );
          const raw = dataArray[binIndex] / 255;
          ratio = Math.max(0.08, raw);
        } else if (isPlaying) {
          // Subtle fallback pulse if analyser wasn't attached
          ratio = 0.14 + 0.12 * Math.sin(Date.now() * 0.006 + i * 0.45);
        }

        const barHeight = Math.max(4, ratio * (h - 8));
        const x = i * (barWidth + gap);
        const y = (h - barHeight) / 2;
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
  }, [analyser, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={48}
      className="visualizer-canvas"
    />
  );
}
