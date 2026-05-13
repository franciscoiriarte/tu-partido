"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/utils/supabase/client";

const HORARIOS = Array.from({ length: (23 * 60 + 30 - 7 * 60) / 30 + 1 }, (_, i) => {
  const minutos = 7 * 60 + i * 30;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

type Cancha = { id: string; nombre: string };
type Turno = {
  id: string;
  hora_inicio: string;
  hora_fin: string;
  cancha_id: string;
  transmitir: boolean;
};

function fechaHoy() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function TurnosManager({ canchas }: { canchas: Cancha[] }) {
  const [fecha, setFecha] = useState(fechaHoy());
  const [turnos, setTurnos] = useState<Turno[]>([]);

  const fetchTurnos = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("turnos")
      .select("*")
      .in(
        "cancha_id",
        canchas.map((c) => c.id)
      )
      .eq("fecha", fecha)
      .order("hora_inicio");
    setTurnos(data ?? []);
  }, [fecha, canchas]);

  useEffect(() => {
    fetchTurnos();
  }, [fetchTurnos]);

  async function agregarTurno(
    canchaId: string,
    horaInicio: string,
    horaFin: string
  ) {
    const supabase = createClient();
    await supabase.from("turnos").insert({
      cancha_id: canchaId,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
    });
    fetchTurnos();
  }

  async function eliminarTurno(id: string) {
    const supabase = createClient();
    await supabase.from("turnos").delete().eq("id", id);
    setTurnos((prev) => prev.filter((t) => t.id !== id));
  }

  async function toggleTransmitir(id: string, valor: boolean) {
    const supabase = createClient();
    await supabase.from("turnos").update({ transmitir: valor }).eq("id", id);
    setTurnos((prev) => prev.map((t) => t.id === id ? { ...t, transmitir: valor } : t));
  }

  return (
    <div>
      <input
        type="date"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
        className="px-4 py-2 text-white text-sm outline-none mb-8 border"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      />

      {canchas.map((cancha) => (
        <CanchaSection
          key={cancha.id}
          cancha={cancha}
          turnos={turnos.filter((t) => t.cancha_id === cancha.id)}
          onAgregar={(hi, hf) => agregarTurno(cancha.id, hi, hf)}
          onEliminar={eliminarTurno}
          onToggleTransmitir={toggleTransmitir}
        />
      ))}

      {canchas.length === 0 && (
        <p className="text-sm text-white/40">
          No hay canchas configuradas. Contactá al administrador.
        </p>
      )}
    </div>
  );
}

function CanchaSection({
  cancha,
  turnos,
  onAgregar,
  onEliminar,
  onToggleTransmitir,
}: {
  cancha: Cancha;
  turnos: Turno[];
  onAgregar: (hi: string, hf: string) => void;
  onEliminar: (id: string) => void;
  onToggleTransmitir: (id: string, valor: boolean) => void;
}) {
  const [horaInicio, setHoraInicio] = useState("");
  const [horaFin, setHoraFin] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!horaInicio || !horaFin) return;
    onAgregar(horaInicio, horaFin);
    setHoraInicio("");
    setHoraFin("");
  }

  return (
    <div className="mb-8">
      <h2 className="text-base font-medium text-white mb-3">
        {cancha.nombre}
      </h2>

      <ul className="mb-4">
        {turnos.length === 0 && (
          <li className="text-sm text-white/40 py-2">Sin turnos cargados</li>
        )}
        {turnos.map((turno) => (
          <li
            key={turno.id}
            className="flex items-center justify-between py-2 border-b"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="text-sm text-white">
              {turno.hora_inicio.slice(0, 5)} — {turno.hora_fin.slice(0, 5)}
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => onToggleTransmitir(turno.id, !turno.transmitir)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded"
                style={{
                  background: turno.transmitir ? "#dc2626" : "var(--surface)",
                  color: turno.transmitir ? "#fff" : "rgba(255,255,255,0.4)",
                  border: "1px solid var(--border)",
                }}
                title={turno.transmitir ? "Dejar de transmitir" : "Transmitir en YouTube"}
              >
                ▶ {turno.transmitir ? "En vivo" : "YouTube"}
              </button>
              <button
                onClick={() => onEliminar(turno.id)}
                className="text-xs text-white/40 underline"
              >
                Eliminar
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <select
          value={horaInicio}
          onChange={(e) => setHoraInicio(e.target.value)}
          required
          className="px-2 py-2 text-sm text-white outline-none border"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <option value="">Inicio</option>
          {HORARIOS.map((h) => (
            <option key={h} value={h} style={{ background: "#1a1a1a" }}>{h}</option>
          ))}
        </select>
        <span className="text-sm text-white/40">a</span>
        <select
          value={horaFin}
          onChange={(e) => setHoraFin(e.target.value)}
          required
          className="px-2 py-2 text-sm text-white outline-none border"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <option value="">Fin</option>
          {HORARIOS.map((h) => (
            <option key={h} value={h} style={{ background: "#1a1a1a" }}>{h}</option>
          ))}
        </select>
        <button
          type="submit"
          className="px-4 py-2 text-sm font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          +
        </button>
      </form>
    </div>
  );
}
