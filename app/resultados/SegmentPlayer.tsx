"use client";
import { useState } from "react";

export default function SegmentPlayer({ urls }: { urls: string[] }) {
  const [idx, setIdx] = useState(0);
  return (
    <div>
      <video
        key={idx}
        controls
        autoPlay={idx > 0}
        playsInline
        preload="metadata"
        className="w-full rounded"
        onEnded={() => { if (idx < urls.length - 1) setIdx(idx + 1); }}
      >
        <source src={urls[idx]} type="video/mp4" />
      </video>
      {urls.length > 1 && (
        <div className="flex gap-1 mt-2">
          {urls.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              className="flex-1 py-1 text-xs rounded"
              style={{
                background: i === idx ? "var(--accent)" : "rgba(255,255,255,0.1)",
                color: "#fff",
              }}
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
