import { useEffect, useState, type CSSProperties } from "react";
import { screensaverArt } from "../lib/screensaverArt";
import { screensaverQuotes } from "../lib/screensaverQuotes";

const screensaverPlacements = [
  { panelX: -26, panelY: -18, artPosition: "18% 38%" },
  { panelX: 28, panelY: -12, artPosition: "82% 40%" },
  { panelX: -18, panelY: 22, artPosition: "22% 72%" },
  { panelX: 34, panelY: 18, artPosition: "78% 70%" },
  { panelX: -36, panelY: 8, artPosition: "14% 56%" },
  { panelX: 20, panelY: -28, artPosition: "74% 28%" },
  { panelX: 8, panelY: 30, artPosition: "50% 78%" },
  { panelX: -12, panelY: -32, artPosition: "46% 24%" },
  { panelX: 38, panelY: 4, artPosition: "86% 54%" },
  { panelX: -30, panelY: 26, artPosition: "18% 78%" },
  { panelX: 16, panelY: 24, artPosition: "68% 76%" },
  { panelX: -8, panelY: -24, artPosition: "32% 30%" },
  { panelX: 30, panelY: -30, artPosition: "84% 24%" },
  { panelX: -40, panelY: -4, artPosition: "12% 48%" },
  { panelX: 4, panelY: 34, artPosition: "52% 84%" }
] as const;

export function ScreensaverPage({ title, onWake }: { title: string; onWake: () => void }) {
  const [artIndex, setArtIndex] = useState(() => Math.floor(Math.random() * screensaverArt.length));
  const art = screensaverArt[artIndex] ?? screensaverArt[0];
  const quote = screensaverQuotes[artIndex % screensaverQuotes.length] ?? screensaverQuotes[0];
  const placement = screensaverPlacements[artIndex % screensaverPlacements.length] ?? screensaverPlacements[0];
  const style = {
    backgroundColor: "#020506",
    "--screensaver-drift-x": `${placement.panelX}px`,
    "--screensaver-drift-y": `${placement.panelY}px`
  } as CSSProperties;
  const artStyle = {
    backgroundImage: art.backgroundImage,
    backgroundPosition: placement.artPosition,
    "--screensaver-art-drift-x": `${Math.round(placement.panelX * -1.8)}px`,
    "--screensaver-art-drift-y": `${Math.round(placement.panelY * -1.4)}px`
  } as CSSProperties;

  useEffect(() => {
    const interval = window.setInterval(() => {
      setArtIndex((current) => (current + 1) % screensaverArt.length);
    }, 45000);
    return () => window.clearInterval(interval);
  }, []);

  return (
    <main
      className="screensaver"
      aria-label="Screensaver mode"
      style={style}
      onClick={onWake}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onWake();
      }}
      tabIndex={0}
    >
      <div className="screensaver-art" aria-hidden="true" style={artStyle} />
      <div className="screensaver-panel">
        <span className="eyebrow">Machine sleeping</span>
        <h1>WorkFlow</h1>
        <p className="screensaver-subtitle">{quote}</p>
        <button
          type="button"
          className="ghost-button"
          onClick={(event) => {
            event.stopPropagation();
            onWake();
          }}
        >
          Tap the screen to wake
        </button>
      </div>
    </main>
  );
}
