"use client";

import { useState } from "react";

export default function SaveButton({ url, filename }: { url: string; filename: string }) {
  const [loading, setLoading] = useState(false);

  async function guardar() {
    // Si soporta share con archivos (iOS 15+, Android Chrome) → share nativo → "Guardar en fotos"
    if (navigator.canShare) {
      try {
        setLoading(true);
        const res = await fetch(url);
        const blob = await res.blob();
        const file = new File([blob], filename, { type: "video/mp4" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          setLoading(false);
          return;
        }
      } catch (_) {}
      setLoading(false);
    }
    // Fallback: descarga normal
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  return (
    <button
      onClick={guardar}
      disabled={loading}
      className="flex-1 flex items-center justify-center gap-1 py-2 text-xs font-medium rounded"
      style={{ background: "var(--surface)", color: "white", border: "1px solid var(--border)", opacity: loading ? 0.6 : 1 }}
    >
      {loading ? "Descargando…" : "⬇ Guardar en fotos"}
    </button>
  );
}
