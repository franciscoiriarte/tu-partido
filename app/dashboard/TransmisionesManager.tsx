"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";

type Cancha = {
  id: string;
  nombre: string;
  transmitiendo?: boolean;
  stream_activo?: boolean;
  titulo_stream?: string | null;
};

function StatusDot({ transmitiendo, streamActivo }: { transmitiendo?: boolean; streamActivo?: boolean }) {
  if (!transmitiendo) return null;
  if (streamActivo) {
    return <span className="text-xs font-medium" style={{ color: "#22c55e" }}>● Conectado a YouTube</span>;
  }
  return <span className="text-xs" style={{ color: "#facc15" }}>◌ Conectando...</span>;
}

function CanchaStreamCard({
  cancha,
  onToggle,
}: {
  cancha: Cancha;
  onToggle: (id: string, valor: boolean) => void;
}) {
  const [titulo, setTitulo] = useState(cancha.titulo_stream ?? "");

  async function guardarTitulo() {
    const supabase = createClient();
    await supabase.from("canchas").update({ titulo_stream: titulo }).eq("id", cancha.id);
  }

  return (
    <div
      className="p-4 border"
      style={{ borderColor: "var(--border)", background: "var(--surface)" }}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-white">{cancha.nombre}</h3>
        <StatusDot transmitiendo={cancha.transmitiendo} streamActivo={cancha.stream_activo} />
      </div>
      <div className="flex flex-col gap-3">
        <input
          type="text"
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          onBlur={guardarTitulo}
          placeholder="Título del stream (opcional)"
          className="px-3 py-2 text-sm text-white outline-none border w-full"
          style={{ background: "var(--background)", borderColor: "var(--border)" }}
        />
        <button
          onClick={() => onToggle(cancha.id, !cancha.transmitiendo)}
          className="px-4 py-2 text-sm font-medium flex items-center gap-2 w-fit border"
          style={{
            background: cancha.transmitiendo ? "#dc2626" : "var(--surface)",
            color: cancha.transmitiendo ? "#fff" : "rgba(255,255,255,0.5)",
            borderColor: cancha.transmitiendo ? "#dc2626" : "var(--border)",
          }}
        >
          {cancha.transmitiendo ? "■ Detener stream" : "▶ Iniciar stream"}
        </button>
      </div>
    </div>
  );
}

export default function TransmisionesManager({ canchas: initial }: { canchas: Cancha[] }) {
  const [canchas, setCanchas] = useState(initial);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("canchas-stream-status")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "canchas" },
        (payload) => {
          const updated = payload.new as Cancha;
          setCanchas((prev) =>
            prev.map((c) =>
              c.id === updated.id
                ? { ...c, stream_activo: updated.stream_activo, transmitiendo: updated.transmitiendo }
                : c
            )
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  async function toggleTransmitiendo(id: string, valor: boolean) {
    const supabase = createClient();
    await supabase.from("canchas").update({ transmitiendo: valor }).eq("id", id);
    setCanchas((prev) =>
      prev.map((c) => (c.id === id ? { ...c, transmitiendo: valor, stream_activo: valor ? c.stream_activo : false } : c))
    );
  }

  if (canchas.length === 0) return null;

  return (
    <section className="mt-12 pt-8 border-t" style={{ borderColor: "var(--border)" }}>
      <h2 className="text-base font-medium text-white mb-1">Transmisiones en directo</h2>
      <p className="text-xs text-white/40 mb-6">
        El recorder detecta el cambio en ~30 s y confirma la conexión en ~10 s más.
      </p>
      <div className="space-y-4">
        {canchas.map((cancha) => (
          <CanchaStreamCard key={cancha.id} cancha={cancha} onToggle={toggleTransmitiendo} />
        ))}
      </div>
    </section>
  );
}
