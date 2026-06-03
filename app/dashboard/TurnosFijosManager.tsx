"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

const HORAS = Array.from({ length: (24 * 60 - 8 * 60) / 30 + 1 }, (_, i) => {
  const min = 8 * 60 + i * 30;
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

type Turno = { inicio: string; fin: string };
type Cancha = { id: string; nombre: string; turnos_fijos: Turno[] };

function TurnosCancha({ cancha }: { cancha: Cancha }) {
  const [turnos, setTurnos] = useState<Turno[]>(cancha.turnos_fijos ?? []);
  const [inicio, setInicio] = useState("08:00");
  const [fin, setFin] = useState("09:30");
  const [estado, setEstado] = useState<"idle" | "guardando" | "ok" | "error">("idle");

  const horasFin = HORAS.filter((h) => h > inicio || h === "00:00");

  async function guardar(nuevos: Turno[]) {
    setEstado("guardando");
    const supabase = createClient();
    const { error } = await supabase
      .from("canchas")
      .update({ turnos_fijos: nuevos })
      .eq("id", cancha.id);
    if (error) { setEstado("error"); return; }
    setTurnos(nuevos);
    setEstado("ok");
    setTimeout(() => setEstado("idle"), 1500);
  }

  function agregar() {
    if (!inicio || !fin || fin <= inicio) return;
    const nuevo = { inicio, fin };
    const yaExiste = turnos.some((t) => t.inicio === inicio && t.fin === fin);
    if (yaExiste) return;
    const ordenados = [...turnos, nuevo].sort((a, b) => a.inicio.localeCompare(b.inicio));
    guardar(ordenados);
  }

  function eliminar(i: number) {
    guardar(turnos.filter((_, idx) => idx !== i));
  }

  return (
    <div className="mb-8">
      <p className="text-white/70 text-sm font-medium mb-3">{cancha.nombre}</p>

      {turnos.length === 0 ? (
        <p className="text-white/30 text-xs mb-3">Sin turnos configurados.</p>
      ) : (
        <div className="flex flex-wrap gap-2 mb-3">
          {turnos.map((t, i) => (
            <div
              key={i}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-white border"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            >
              <span>{t.inicio.slice(0, 5)} – {t.fin.slice(0, 5)}</span>
              <button
                onClick={() => eliminar(i)}
                className="text-white/30 hover:text-red-400 transition-colors ml-1 leading-none"
                title="Eliminar"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={inicio}
          onChange={(e) => setInicio(e.target.value)}
          className="px-2 py-1.5 text-xs text-white outline-none border rounded-lg"
          style={{ background: "var(--background)", borderColor: "var(--border)" }}
        >
          {HORAS.map((h) => (
            <option key={h} value={h} style={{ background: "#1a1a1a" }}>{h}</option>
          ))}
        </select>
        <span className="text-white/30 text-xs">a</span>
        <select
          value={fin}
          onChange={(e) => setFin(e.target.value)}
          className="px-2 py-1.5 text-xs text-white outline-none border rounded-lg"
          style={{ background: "var(--background)", borderColor: "var(--border)" }}
        >
          {horasFin.map((h) => (
            <option key={h} value={h} style={{ background: "#1a1a1a" }}>{h}</option>
          ))}
        </select>
        <button
          onClick={agregar}
          disabled={estado === "guardando" || !fin || fin <= inicio}
          className="px-3 py-1.5 text-xs font-medium rounded-lg disabled:opacity-40 transition-colors"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {estado === "guardando" ? "…" : estado === "ok" ? "✓" : "+ Agregar"}
        </button>
        {estado === "error" && <span className="text-red-400 text-xs">Error al guardar</span>}
      </div>
    </div>
  );
}

export default function TurnosFijosManager({ canchas }: { canchas: Cancha[] }) {
  return (
    <div className="mt-10 pt-8 border-t" style={{ borderColor: "var(--border)" }}>
      <p className="text-white font-medium mb-1">Turnos por cancha</p>
      <p className="text-white/40 text-sm mb-6">
        Configurá los turnos que se van a mostrar en la búsqueda. Se aplican todos los días.
      </p>
      {canchas.map((c) => (
        <TurnosCancha key={c.id} cancha={c} />
      ))}
    </div>
  );
}
