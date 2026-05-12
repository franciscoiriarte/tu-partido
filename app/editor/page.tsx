"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";

type Phase = "positioning" | "recording" | "done";

function EditorInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const sourceUrl = searchParams.get("url") ?? "";

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cropXRef = useRef(0.34); // ref para usar en el loop de canvas

  const [cropXPct, setCropXPct] = useState(0.34);
  const [cropWidthPct, setCropWidthPct] = useState(0.316);
  const [phase, setPhase] = useState<Phase>("positioning");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [recordingTime, setRecordingTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartCropX = useRef(0);

  const handleVideoLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    const cropW = (v.videoHeight * 9) / 16 / v.videoWidth;
    setCropWidthPct(cropW);
    const initial = (1 - cropW) / 2;
    setCropXPct(initial);
    cropXRef.current = initial;
    setDuration(v.duration);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = Number(e.target.value);
    if (videoRef.current) videoRef.current.currentTime = t;
    setCurrentTime(t);
  };

  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  // ── Drag ──────────────────────────────────────────────────────────────────

  const onDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    dragStartX.current = "touches" in e ? e.touches[0].clientX : e.clientX;
    dragStartCropX.current = cropXRef.current;
  };

  const onDragMove = useCallback(
    (e: MouseEvent | TouchEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const w = containerRef.current.getBoundingClientRect().width;
      const delta = (clientX - dragStartX.current) / w;
      const newX = Math.max(0, Math.min(1 - cropWidthPct, dragStartCropX.current + delta));
      cropXRef.current = newX;
      setCropXPct(newX);
      dragStartX.current = clientX;
      dragStartCropX.current = newX;
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

  // ── Canvas recording ──────────────────────────────────────────────────────

  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const srcX = video.videoWidth * cropXRef.current;
    const srcW = video.videoWidth * cropWidthPct;
    ctx.drawImage(video, srcX, 0, srcW, video.videoHeight, 0, 0, canvas.width, canvas.height);
    animFrameRef.current = requestAnimationFrame(renderFrame);
  }, [cropWidthPct]);

  const iniciarGrabacion = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    chunksRef.current = [];
    setPhase("recording");
    setRecordingTime(0);

    canvas.width = 1080;
    canvas.height = 1920;

    const stream = canvas.captureStream(30);

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : MediaRecorder.isTypeSupported("video/mp4")
      ? "video/mp4"
      : "video/webm";

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setResultUrl(URL.createObjectURL(blob));
      setPhase("done");
    };

    recorder.start(100);
    video.currentTime = 0;
    await video.play();
    setPlaying(true);
    animFrameRef.current = requestAnimationFrame(renderFrame);

    const timer = setInterval(() => setRecordingTime((t) => t + 1), 1000);

    video.onended = () => {
      recorder.stop();
      setPlaying(false);
      clearInterval(timer);
    };
  }, [renderFrame]);

  const detenerGrabacion = () => {
    recorderRef.current?.stop();
    videoRef.current?.pause();
    setPlaying(false);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
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
        <button onClick={() => router.back()} className="text-white/40 text-sm underline mb-4 block text-left">
          ← Volver
        </button>
        <p className="text-white/40 text-xs uppercase tracking-widest mb-3 text-center">
          Editor de clip vertical
        </p>

        {/* Canvas oculto donde se dibuja el recorte */}
        <canvas ref={canvasRef} className="hidden" />

        {(phase === "positioning" || phase === "recording") && (
          <>
            {/* Video con overlay */}
            <div ref={containerRef} className="relative w-full rounded overflow-hidden bg-black">
              <video
                ref={videoRef}
                src={sourceUrl}
                playsInline
                onLoadedMetadata={handleVideoLoaded}
                onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime); }}
                onEnded={() => setPlaying(false)}
                className="w-full block pointer-events-none"
              />

              {/* Zonas oscuras */}
              <div className="absolute inset-y-0 left-0 pointer-events-none" style={{ width: `${cropXPct * 100}%`, background: "rgba(0,0,0,0.6)" }} />
              <div className="absolute inset-y-0 right-0 pointer-events-none" style={{ width: `${(1 - cropXPct - cropWidthPct) * 100}%`, background: "rgba(0,0,0,0.6)" }} />

              {/* Recuadro arrastrable */}
              <div
                className="absolute inset-y-0 border-2 border-white"
                style={{ left: `${cropXPct * 100}%`, width: `${cropWidthPct * 100}%`, touchAction: "none", cursor: "ew-resize" }}
                onMouseDown={onDragStart}
                onTouchStart={onDragStart}
              >
                {phase === "recording" ? (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-red-500 rounded px-2 py-0.5 whitespace-nowrap">
                    <span className="text-white text-xs font-bold">● {fmt(recordingTime)}</span>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-black/50 rounded-full px-3 py-1">
                      <span className="text-white text-sm font-bold select-none">↔</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Controles — solo en modo posicionamiento */}
            {phase === "positioning" && (
              <div className="flex items-center gap-3 mt-2 mb-1">
                <button
                  onClick={togglePlay}
                  className="text-white w-8 h-8 flex items-center justify-center rounded-full flex-shrink-0"
                  style={{ background: "var(--surface)" }}
                >
                  {playing ? "⏸" : "▶"}
                </button>
                <input type="range" min={0} max={duration || 1} step={0.1} value={currentTime} onChange={onSeek} className="flex-1 accent-white" />
                <span className="text-white/40 text-xs flex-shrink-0">{fmt(currentTime)} / {fmt(duration)}</span>
              </div>
            )}

            <p className="text-white/40 text-xs text-center mt-2 mb-5">
              {phase === "positioning"
                ? "Posicioná el recuadro y tocá Grabar. Podés moverlo mientras graba."
                : "Mové el recuadro para seguir la jugada…"}
            </p>

            {phase === "positioning" && (
              <button
                onClick={iniciarGrabacion}
                className="w-full py-4 rounded-xl text-white text-lg font-bold"
                style={{ background: "var(--accent)" }}
              >
                ● Grabar clip
              </button>
            )}

            {phase === "recording" && (
              <button
                onClick={detenerGrabacion}
                className="w-full py-4 rounded-xl text-white text-lg font-bold"
                style={{ background: "#dc2626" }}
              >
                ■ Detener y guardar
              </button>
            )}
          </>
        )}

        {phase === "done" && resultUrl && (
          <div className="space-y-3">
            <p className="text-white/40 text-xs uppercase tracking-widest text-center mb-4">
              Tu clip está listo
            </p>
            <video
              src={resultUrl}
              controls
              playsInline
              className="w-full rounded mx-auto"
              style={{ maxHeight: "65vh" }}
            />
            <a
              href={resultUrl}
              download="highlight-vertical.mp4"
              className="block text-center py-4 rounded-xl text-white font-bold"
              style={{ background: "var(--accent)" }}
            >
              Descargar
            </a>
            {"share" in navigator && (
              <button
                onClick={compartir}
                className="w-full py-4 rounded-xl text-white font-bold"
                style={{ background: "#2563eb" }}
              >
                Compartir en redes
              </button>
            )}
            <button
              onClick={() => { setPhase("positioning"); setResultUrl(null); }}
              className="w-full py-3 rounded-xl text-sm text-white"
              style={{ background: "var(--surface)" }}
            >
              Grabar de nuevo
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
