import { useEffect, useState } from "react";
import { Disc3, Radio, Sparkles, Waves } from "lucide-react";

interface StartupSplashProps {
  onFinish: () => void;
}

const BOOT_STEPS = [
  "啟動本地 HTTP Range 音訊代理...",
  "連線 YTMAPI 與跨平臺串流核心...",
  "載入 32-bit Float 無損 DSP 與 AI DJ Mix...",
];

export function StartupSplash({ onFinish }: StartupSplashProps) {
  const [stepIdx, setStepIdx] = useState(0);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setStepIdx(1), 420);
    const t2 = setTimeout(() => setStepIdx(2), 920);
    const t3 = setTimeout(() => setExiting(true), 1480);
    const t4 = setTimeout(() => onFinish(), 1880);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  }, [onFinish]);

  return (
    <div
      className={`startup-splash ${exiting ? "exiting" : ""}`}
      onClick={() => {
        setExiting(true);
        setTimeout(onFinish, 260);
      }}
      role="presentation"
    >
      <div className="splash-aurora" />
      <div className="splash-core">
        <div className="splash-orbit-ring">
          <div className="splash-logo-disc">
            <Disc3 size={38} color="#fff" />
          </div>
        </div>

        <div className="splash-brand">AetherMusic</div>
        <div className="splash-tagline">
          <Sparkles size={13} />
          <span>Hi-Res Lossless DSP · AI DJ Mix · Cross-Platform</span>
        </div>

        <div className="splash-progress-track">
          <div
            className="splash-progress-fill"
            style={{ width: `${((stepIdx + 1) / BOOT_STEPS.length) * 100}%` }}
          />
        </div>

        <div className="splash-step-row">
          {stepIdx === 0 && <Radio size={13} />}
          {stepIdx === 1 && <Waves size={13} />}
          {stepIdx === 2 && <Sparkles size={13} />}
          <span>{BOOT_STEPS[stepIdx]}</span>
        </div>
      </div>
    </div>
  );
}
