"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Complejo = { id: string; nombre: string };

const HORARIOS = Array.from(
  { length: (23 * 60 + 30 - 7 * 60) / 30 + 1 },
  (_, i) => {
    const minutos = 7 * 60 + i * 30;
    const h = Math.floor(minutos / 60);
    const m = minutos % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
);

function generarFechas() {
  return Array.from({ length: 4 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const valor = d.toLocaleDateString("en-CA");
    const etiqueta =
      i === 0
        ? "Hoy"
        : i === 1
        ? "Ayer"
        : d.toLocaleDateString("es-AR", { day: "numeric", month: "short" });
    return { valor, etiqueta };
  });
}

export default function BuscadorHome({ complejos }: { complejos: Complejo[] }) {
  const router = useRouter();
  const [complejoId, setComplejoId] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");
  const fechas = generarFechas();

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault();
    const complejo = complejos.find((c) => c.id === complejoId);
    if (!complejo || !fecha || !hora) return;
    router.push(
      `/resultados?complejo=${encodeURIComponent(complejo.nombre)}&fecha=${fecha}&hora=${hora}`
    );
  }

  return (
    <form onSubmit={handleBuscar} className="flex flex-col gap-8 w-full max-w-sm">

      {/* Complejos */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">
          Complejo
        </p>
        <div className="flex flex-wrap gap-2">
          {complejos.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setComplejoId(c.id)}
              className="px-4 py-3 text-sm font-medium border transition-colors"
              style={
                complejoId === c.id
                  ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                  : { background: "transparent", borderColor: "var(--border)", color: "rgba(255,255,255,0.7)" }
              }
            >
              {c.nombre}
            </button>
          ))}
          {complejos.length === 0 && (
            <p className="text-sm text-white/40">Sin complejos disponibles.</p>
          )}
        </div>
      </div>

      {/* Fechas */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">
          Día
        </p>
        <div className="flex gap-2">
          {fechas.map((f) => (
            <button
              key={f.valor}
              type="button"
              onClick={() => setFecha(f.valor)}
              className="px-3 py-2 text-sm font-medium flex-1 border transition-colors"
              style={
                fecha === f.valor
                  ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                  : { background: "transparent", borderColor: "var(--border)", color: "rgba(255,255,255,0.7)" }
              }
            >
              {f.etiqueta}
            </button>
          ))}
        </div>
      </div>

      {/* Hora */}
      <div>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-3">
          Hora
        </p>
        <select
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          required
          className="w-full px-4 py-3 text-sm outline-none border"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border)",
            color: hora ? "#fff" : "rgba(255,255,255,0.4)",
          }}
        >
          <option value="">Seleccioná un horario</option>
          {HORARIOS.map((h) => (
            <option key={h} value={h} style={{ background: "#1a1a1a", color: "#fff" }}>
              {h}
            </option>
          ))}
        </select>
      </div>

      <button
        type="submit"
        disabled={!complejoId || !fecha || !hora}
        className="py-4 text-base font-semibold tracking-wide transition-opacity disabled:opacity-30"
        style={{ background: "var(--accent)", color: "#fff" }}
      >
        Buscar mi partido
      </button>
    </form>
  );
}
