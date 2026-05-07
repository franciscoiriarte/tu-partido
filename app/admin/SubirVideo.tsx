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

    if (res.ok) {
      setEstado("listo");
      setArchivo(null);
      setTurnoId("");
    } else {
      setEstado("error");
    }
  }

  return (
    <div className="mt-12 border-t border-black/10 pt-8">
      <h2 className="text-lg font-semibold text-black mb-6">Subir video</h2>
      <form onSubmit={handleSubir} className="flex flex-col gap-4">
        <select
          value={turnoId}
          onChange={(e) => setTurnoId(e.target.value)}
          required
          className="border border-black px-4 py-3 text-black text-sm outline-none w-full"
        >
          <option value="">Seleccioná el turno</option>
          {turnos.map((t) => (
            <option key={t.id} value={t.id}>
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
          className="border border-black px-4 py-3 text-black text-sm outline-none w-full"
        />

        {estado === "listo" && (
          <p className="text-sm text-black">Video subido correctamente.</p>
        )}
        {estado === "error" && (
          <p className="text-sm text-red-600">Error al subir. Intentá de nuevo.</p>
        )}

        <button
          type="submit"
          disabled={estado === "subiendo"}
          className="bg-black text-white py-3 text-sm font-medium disabled:opacity-40"
        >
          {estado === "subiendo" ? "Subiendo..." : "Subir video"}
        </button>
      </form>
    </div>
  );
}
