"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

export default function ReconectarCamara({ canchaId, nombre }: { canchaId: string; nombre: string }) {
  const [estado, setEstado] = useState<"idle" | "ok" | "enviando">("idle");

  async function reconectar() {
    setEstado("enviando");
    const supabase = createClient();
    // No-op update — dispara el realtime en el recorder
    await supabase.from("canchas").update({ nombre }).eq("id", canchaId);
    setEstado("ok");
    setTimeout(() => setEstado("idle"), 3000);
  }

  return (
    <button
      onClick={reconectar}
      disabled={estado === "enviando"}
      className="text-xs px-2 py-0.5 rounded border transition-colors disabled:opacity-40"
      style={{ borderColor: "var(--border)", color: "rgba(255,255,255,0.5)" }}
    >
      {estado === "enviando" ? "…" : estado === "ok" ? "✓ enviado" : "Reiniciar"}
    </button>
  );
}
