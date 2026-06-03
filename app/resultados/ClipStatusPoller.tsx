"use client";

import { useEffect, useState } from "react";
import ShareButton from "./ShareButton";
import SegmentPlayer from "./SegmentPlayer";

function parseVideoUrls(url: string): string[] {
  if (url.startsWith("[")) { try { return JSON.parse(url); } catch {} }
  return [url];
}

type Status = "pending" | "processing" | "ready" | "error";

export default function ClipStatusPoller({
  pedidoId,
  initialStatus,
}: {
  pedidoId: string | null;
  initialStatus: Status;
}) {
  const [status, setStatus] = useState<Status>(initialStatus);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!pedidoId || status === "ready" || status === "error") return;

    const interval = setInterval(async () => {
      try {
        const res  = await fetch(`/api/clip-status?id=${pedidoId}`);
        const data = await res.json();
        setStatus(data.status);
        if (data.video_url) setVideoUrl(data.video_url);
        if (data.status === "ready" || data.status === "error") clearInterval(interval);
      } catch (_) {}
    }, 8000);

    return () => clearInterval(interval);
  }, [pedidoId, status]);

  if (status === "ready" && videoUrl) {
    const urls = parseVideoUrls(videoUrl);
    return (
      <div>
        <SegmentPlayer urls={urls} />
        <div className="flex gap-2 mt-3">
          <a
            href={`/api/download?url=${encodeURIComponent(urls[0])}&filename=partido.mp4`}
            className="flex-1 block text-center py-3 text-sm font-semibold rounded"
            style={{ background: "var(--accent)", color: "#fff" }}
          >
            {urls.length > 1 ? "Descargar parte 1" : "Descargar video completo"}
          </a>
          <ShareButton
            url={urls[0]}
            text="Mirá el video de mi partido en Tu Partido 🎾"
          />
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="rounded-xl p-6 text-center" style={{ background: "var(--surface)" }}>
        <p className="text-white/60 text-sm mb-2">No pudimos generar el video.</p>
        <p className="text-white/30 text-xs">Puede que no haya grabación para ese horario. Verificá el horario y volvé a intentar.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl p-8 text-center" style={{ background: "var(--surface)" }}>
      <div className="flex justify-center mb-4">
        <Spinner />
      </div>
      <p className="text-white font-medium mb-1">
        {status === "processing" ? "Generando tu video…" : "En cola…"}
      </p>
      <p className="text-white/40 text-xs">
        {status === "processing"
          ? "Estamos cortando y procesando el video. Tardará unos minutos."
          : "Tu pedido está en cola. Empezará a procesarse en breve."}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin" width="32" height="32" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="white" strokeOpacity="0.15" strokeWidth="3" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="#5DCAA5" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
