"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";

function EditorInner() {
  const searchParams = useSearchParams();
  const sourceUrl = searchParams.get("url") ?? "";

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [cropXPct, setCropXPct] = useState(0.34);
  const [cropWidthPct, setCropWidthPct] = useState(0.316);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartCropX = useRef(0);

  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "waiting" | "done" | "error">("idle");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleVideoLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    const cropW = (v.videoHeight * 9) / 16 / v.videoWidth;
    setCropWidthPct(cropW);
    setCropXPct((1 - cropW) / 2);
    setDuration(v.duration);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const onTimeUpdate = () => {
    if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // Drag handlers — solo sobre el recuadro, no el video
  const onDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    dragStartX.current = "touches" in e ? e.touches[0].clientX : e.clientX;
    dragStartCropX.current = cropXPct;
  };

  const onDragMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const containerW = containerRef.current.getBoundingClientRect().width;
      const delta = (clientX - dragStartX.current) / containerW;
      setCropXPct((prev) => Math.max(0, Math.min(1 - cropWidthPct, prev + delta)));
      dragStartX.current = clientX;
    },
    [cropWidthPct]
  );

  const onDragEnd = useCallback(() => { isDragging.current = false; }, []);

  useEffect(() => {
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("touchmove", onDragMove, { passive: false });
    window.addEventListener("touchend", onDragEnd);
    return () => {
      window.removeEventListener("mousemove", onDragMove);
      window.removeEventListener("mouseup", onDragEnd);
      window.removeEventListener("touchmove", onDragMove);
      window.removeEventListener("touchend", onDragEnd);
    };
  }, [onDragMove, onDragEnd]);

  // Polling del job
  useEffect(() => {
    if (!jobId || status !== "waiting") return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/clip-vertical?job_id=${jobId}`);
      const data = await res.json();
      if (data.status === "done") {
        setStatus("done");
        setResultUrl(data.result_url);
      } else if (data.status === "error") {
        setStatus("error");
        setErrorMsg("Error procesando el clip. Intentá de nuevo.");
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [jobId, status]);

  const generarClip = async () => {
    setStatus("waiting");
    setErrorMsg(null);
    try {
      const res = await fetch("/api/clip-vertical", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_url: sourceUrl, crop_x_pct: cropXPct }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setJobId(data.job_id);
    } catch (err: unknown) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Error");
    }
  };

  const compartir = async () => {
    if (!resultUrl || !navigator.share) return;
    const blob = await fetch(resultUrl).then((r) => r.blob());
    const file = new File([blob], "highlight.mp4", { type: "video/mp4" });
    await navigator.share({ files: [file] });
  };

  if (!sourceUrl) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <p className="text-white/60">Falta el parámetro url</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-6" style={{ background: "var(--background)" }}>
      <div className="w-full max-w-lg">
        <Link href="javascript:history.back()" className="text-white/40 text-sm underline mb-4 block">← Volver</Link>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-3 text-center">Editor de clip vertical</p>

        {status !== "done" && (
          <>
            {/* Video SIN controles nativos — el overlay maneja el drag */}
            <div ref={containerRef} className="relative w-full rounded overflow-hidden bg-black">
              <video
                ref={videoRef}
                src={sourceUrl}
                playsInline
                onLoadedMetadata={handleVideoLoaded}
                onTimeUpdate={onTimeUpdate}
                onEnded={() => setPlaying(false)}
                className="w-full block pointer-events-none"
              />

              {/* Zona oscura izquierda */}
              <div
                className="absolute inset-y-0 left-0 pointer-events-none"
                style={{ width: `${cropXPct * 100}%`, background: "rgba(0,0,0,0.6)" }}
              />
              {/* Zona oscura derecha */}
              <div
                className="absolute inset-y-0 right-0 pointer-events-none"
                style={{ width: `${(1 - cropXPct - cropWidthPct) * 100}%`, background: "rgba(0,0,0,0.6)" }}
              />

              {/* Recuadro arrastrable — cubre todo el alto */}
              <div
                className="absolute inset-y-0 border-2 border-white"
                style={{ left: `${cropXPct * 100}%`, width: `${cropWidthPct * 100}%`, cursor: "ew-resize", touchAction: "none" }}
                onMouseDown={onDragStart}
                onTouchStart={onDragStart}
              >
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="bg-black/50 rounded-full px-3 py-1">
                    <span className="text-white text-sm font-bold select-none">↔</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Controles de video propios */}
            <div className="flex items-center gap-3 mt-2 mb-1">
              <button
                onClick={togglePlay}
                className="text-white text-lg w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0"
                style={{ background: "var(--surface)" }}
              >
                {playing ? "⏸" : "▶"}
              </button>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.1}
                value={currentTime}
                onChange={onSeek}
                className="flex-1 accent-white"
              />
              <span className="text-white/40 text-xs flex-shrink-0">{fmt(currentTime)} / {fmt(duration)}</span>
            </div>

            <p className="text-white/40 text-xs text-center mb-5">
              Reproducí el video, posicioná el recuadro donde está la acción y tocá Generar
            </p>

            <button
              onClick={generarClip}
              disabled={status === "waiting"}
              className="w-full py-4 rounded-xl text-white text-lg font-bold disabled:opacity-60"
              style={{ background: "var(--accent)" }}
            >
              {status === "waiting" ? "Generando… (~20 seg)" : "Generar clip vertical"}
            </button>

            {status === "waiting" && (
              <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: "var(--surface)" }}>
                <div className="h-full rounded-full animate-pulse" style={{ width: "100%", background: "var(--accent)" }} />
              </div>
            )}

            {status === "error" && (
              <p className="text-red-400 text-sm text-center mt-3">{errorMsg}</p>
            )}
          </>
        )}

        {status === "done" && resultUrl && (
          <div className="space-y-3">
            <p className="text-white/40 text-xs uppercase tracking-widest text-center mb-4">Tu clip está listo</p>
            <video src={resultUrl} controls playsInline className="w-full rounded mx-auto" style={{ maxHeight: "65vh" }} />
            <a
              href={`/api/download?url=${encodeURIComponent(resultUrl)}&filename=highlight-vertical.mp4`}
              className="block text-center py-4 rounded-xl text-white font-bold"
              style={{ background: "var(--accent)" }}
            >
              Descargar
            </a>
            {"share" in navigator && (
              <button onClick={compartir} className="w-full py-4 rounded-xl text-white font-bold" style={{ background: "#2563eb" }}>
                Compartir en redes
              </button>
            )}
            <button
              onClick={() => { setStatus("idle"); setResultUrl(null); setJobId(null); }}
              className="w-full py-3 rounded-xl text-sm text-white"
              style={{ background: "var(--surface)" }}
            >
              Editar de nuevo
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function EditorPage() {
  return (
    <Suspense>
      <EditorInner />
    </Suspense>
  );
}
