import { useEffect, useState } from "react";
import { screensaverArt } from "../lib/screensaverArt";
import { screensaverQuotes } from "../lib/screensaverQuotes";

export function ScreensaverPage({ title, onWake }: { title: string; onWake: () => void }) {
  const [artIndex, setArtIndex] = useState(() => Math.floor(Math.random() * screensaverArt.length));
  const art = screensaverArt[artIndex] ?? screensaverArt[0];
  const quote = screensaverQuotes[artIndex % screensaverQuotes.length] ?? screensaverQuotes[0];

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
      style={{ backgroundColor: "#020506", backgroundImage: art.backgroundImage }}
      onClick={onWake}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onWake();
      }}
      tabIndex={0}
    >
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
