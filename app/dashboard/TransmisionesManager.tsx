"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

type Cancha = {
  id: string;
  nombre: string;
  transmitiendo?: boolean;
  titulo_stream?: string | null;
};

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
      <h3 className="text-sm font-medium text-white mb-3">{cancha.nombre}</h3>
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
          {cancha.transmitiendo ? "● En vivo" : "▶ Iniciar stream"}
        </button>
      </div>
    </div>
  );
}

export default function TransmisionesManager({ canchas: initial }: { canchas: Cancha[] }) {
  const [canchas, setCanchas] = useState(initial);

  async function toggleTransmitiendo(id: string, valor: boolean) {
    const supabase = createClient();
    await supabase.from("canchas").update({ transmitiendo: valor }).eq("id", id);
    setCanchas((prev) =>
      prev.map((c) => (c.id === id ? { ...c, transmitiendo: valor } : c))
    );
  }

  if (canchas.length === 0) return null;

  return (
    <section className="mt-12 pt-8 border-t" style={{ borderColor: "var(--border)" }}>
      <h2 className="text-base font-medium text-white mb-1">Transmisiones en directo</h2>
      <p className="text-xs text-white/40 mb-6">
        El recorder de cada cancha detecta el cambio en ~30 segundos.
      </p>
      <div className="space-y-4">
        {canchas.map((cancha) => (
          <CanchaStreamCard key={cancha.id} cancha={cancha} onToggle={toggleTransmitiendo} />
        ))}
      </div>
    </section>
  );
}
