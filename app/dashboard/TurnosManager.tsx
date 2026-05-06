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

  return (
    <div>
      <input
        type="date"
        value={fecha}
        onChange={(e) => setFecha(e.target.value)}
        className="border border-black px-4 py-2 text-black text-sm outline-none mb-8"
      />

      {canchas.map((cancha) => (
        <CanchaSection
          key={cancha.id}
          cancha={cancha}
          turnos={turnos.filter((t) => t.cancha_id === cancha.id)}
          onAgregar={(hi, hf) => agregarTurno(cancha.id, hi, hf)}
          onEliminar={eliminarTurno}
        />
      ))}

      {canchas.length === 0 && (
        <p className="text-sm text-black/50">
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
}: {
  cancha: Cancha;
  turnos: Turno[];
  onAgregar: (hi: string, hf: string) => void;
  onEliminar: (id: string) => void;
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
      <h2 className="text-base font-medium text-black mb-3">
        {cancha.nombre}
      </h2>

      <ul className="mb-4">
        {turnos.length === 0 && (
          <li className="text-sm text-black/40 py-2">Sin turnos cargados</li>
        )}
        {turnos.map((turno) => (
          <li
            key={turno.id}
            className="flex items-center justify-between py-2 border-b border-black/10"
          >
            <span className="text-sm text-black">
              {turno.hora_inicio.slice(0, 5)} — {turno.hora_fin.slice(0, 5)}
            </span>
            <button
              onClick={() => onEliminar(turno.id)}
              className="text-xs text-black underline"
            >
              Eliminar
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <select
          value={horaInicio}
          onChange={(e) => setHoraInicio(e.target.value)}
          required
          className="border border-black px-2 py-2 text-sm text-black outline-none"
        >
          <option value="">Inicio</option>
          {HORARIOS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <span className="text-sm text-black">a</span>
        <select
          value={horaFin}
          onChange={(e) => setHoraFin(e.target.value)}
          required
          className="border border-black px-2 py-2 text-sm text-black outline-none"
        >
          <option value="">Fin</option>
          {HORARIOS.map((h) => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>
        <button
          type="submit"
          className="bg-black text-white px-4 py-2 text-sm font-medium"
        >
          +
        </button>
      </form>
    </div>
  );
}
