"use client";

import { useState } from "react";

type Turno = {
  id: string;
  fecha: string;
  hora_inicio: string;
  hora_fin: string;
  cancha_nombre: string;
};

export default function SubirVideo({ turnos }: { turnos: Turno[] }) {
  const [turnoId, setTurnoId] = useState("");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [estado, setEstado] = useState<"idle" | "subiendo" | "listo" | "error">("idle");

  async function handleSubir(e: React.FormEvent) {
    e.preventDefault();
    if (!archivo || !turnoId) return;

    setEstado("subiendo");

    const formData = new FormData();
    formData.append("archivo", archivo);
    formData.append("turno_id", turnoId);

    const res = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await res.json();

    if (res.ok) {
      setEstado("listo");
      setArchivo(null);
      setTurnoId("");
    } else {
      console.error("Upload error:", data);
      setEstado("error");
    }
  }

  return (
    <div className="mt-12 pt-8 border-t" style={{ borderColor: "var(--border)" }}>
      <h2 className="text-lg font-semibold text-white mb-6">Subir video</h2>
      <form onSubmit={handleSubir} className="flex flex-col gap-4">
        <select
          value={turnoId}
          onChange={(e) => setTurnoId(e.target.value)}
          required
          className="px-4 py-3 text-white text-sm outline-none w-full border"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        >
          <option value="" style={{ background: "#1a1a1a" }}>Seleccioná el turno</option>
          {turnos.map((t) => (
            <option key={t.id} value={t.id} style={{ background: "#1a1a1a" }}>
              {t.fecha} — {t.cancha_nombre} — {t.hora_inicio.slice(0, 5)} a{" "}
              {t.hora_fin.slice(0, 5)}
            </option>
          ))}
        </select>

        <input
          type="file"
          accept="video/*"
          required
          onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
          className="px-4 py-3 text-white/60 text-sm outline-none w-full border"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        />

        {estado === "listo" && (
          <p className="text-sm text-white/60">Video subido correctamente.</p>
        )}
        {estado === "error" && (
          <p className="text-sm text-red-400">Error al subir. Intentá de nuevo.</p>
        )}

        <button
          type="submit"
          disabled={estado === "subiendo"}
          className="py-3 text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: "var(--accent)" }}
        >
          {estado === "subiendo" ? "Subiendo..." : "Subir video"}
        </button>
      </form>
    </div>
  );
}
