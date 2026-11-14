"use client";

import { useRef, useState } from "react";
import { VIDEO } from "@/lib/site/config";

/**
 * The tour video. The poster shows first (no autoplay, a fixed 16:9 box so nothing moves when it loads), the video file is not fetched until Play is pressed
 * (preload none), captions are on offer, and plain text covers a browser that cannot play video. The files are rebuilt by scripts/make-web-video.mjs; the paths never change.
 */
export function VideoPlayer() {
  const ref = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const play = () => {
    setStarted(true);
    // The element is already in the page (hidden behind the poster until started), so playing can start in the same click.
    void ref.current?.play().catch(() => undefined);
  };
  return (
    <div>
      <div className="vbox" id="tour">
        <video ref={ref} controls={started} preload="none" playsInline poster={VIDEO.poster} width={1280} height={720} aria-label={VIDEO.title} style={{ visibility: started ? "visible" : "hidden" }}>
          <source src={VIDEO.src720} type="video/mp4" />
          <track kind="captions" src={VIDEO.captions} srcLang="en" label="English" />
          Your browser cannot play this video. It is a four-minute tour of SubSync, and the same things are written out on the Support pages.
        </video>
        {!started && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="vposter" src={VIDEO.poster} alt="" width={1280} height={720} />
        )}
        {!started && (
          <button type="button" className="vplay" onClick={play} aria-label={`Play the video: ${VIDEO.title}`}>
            <span>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
              Watch the 4-minute tour
            </span>
          </button>
        )}
      </div>
      <p className="vcap">Captions are built into the video.</p>
    </div>
  );
}
