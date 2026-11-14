"use client";

import { useState } from "react";
import { VIDEO } from "@/lib/site/config";

type Which = "tour" | "welcome";

/**
 * A video from YouTube that loads only after Play is pressed. Until then the page shows our own poster in a fixed 16:9 box (nothing moves, nothing is
 * fetched from YouTube), and the privacy-enhanced domain is used so YouTube sets no cookies before the visitor presses Play.
 * The captions are built into the video. Plain text covers a browser that cannot play video.
 */
export function VideoPlayer({ which = "tour" }: { which?: Which }) {
  const v = VIDEO[which];
  const [started, setStarted] = useState(false);
  return (
    <div>
      <div className="vbox" id={which === "tour" ? "tour" : undefined}>
        {started ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${v.youtubeId}?autoplay=1&rel=0&modestbranding=1`}
            title={v.title}
            width={1280}
            height={720}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="vposter" src={v.poster} alt="" width={1280} height={720} />
            <button type="button" className="vplay" onClick={() => setStarted(true)} aria-label={`Play the video: ${v.title}`}>
              <span>
                <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
                {v.button}
              </span>
            </button>
          </>
        )}
      </div>
      <p className="vcap">Captions are built into the video. It plays from YouTube when you press Play.</p>
    </div>
  );
}
