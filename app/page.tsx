"use client";

import { useState } from "react";

export default function HomePage() {
  const [complejo, setComplejo] = useState("");
  const [fecha, setFecha] = useState("");
  const [hora, setHora] = useState("");

  function handleBuscar(e: React.FormEvent) {
    e.preventDefault();
    // La búsqueda real se conecta en la próxima sesión con la base de datos
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white px-4">
      <h1 className="text-3xl font-semibold text-black mb-2">Tu Partido</h1>
      <p className="text-black text-base mb-10">
        Buscá el video de tu partido
      </p>
      <form
        onSubmit={handleBuscar}
        className="flex flex-col gap-4 w-full max-w-sm"
      >
        <input
          type="text"
          placeholder="Complejo"
          value={complejo}
          onChange={(e) => setComplejo(e.target.value)}
          required
          className="border border-black px-4 py-3 text-black text-base outline-none w-full"
        />
        <input
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          required
          className="border border-black px-4 py-3 text-black text-base outline-none w-full"
        />
        <input
          type="time"
          value={hora}
          onChange={(e) => setHora(e.target.value)}
          required
          className="border border-black px-4 py-3 text-black text-base outline-none w-full"
        />
        <button
          type="submit"
          className="bg-black text-white py-3 text-base font-medium"
        >
          Buscar mi partido
        </button>
      </form>
    </main>
  );
}
