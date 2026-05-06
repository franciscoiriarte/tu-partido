export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white px-4">
      <h1 className="text-3xl font-semibold text-black mb-2">Tu Partido</h1>
      <p className="text-black text-base mb-10">Buscá el video de tu partido</p>
      <form
        action="/resultados"
        method="get"
        className="flex flex-col gap-4 w-full max-w-sm"
      >
        <input
          type="text"
          name="complejo"
          placeholder="Complejo"
          required
          className="border border-black px-4 py-3 text-black text-base outline-none w-full"
        />
        <input
          type="date"
          name="fecha"
          required
          className="border border-black px-4 py-3 text-black text-base outline-none w-full"
        />
        <select
          name="hora"
          required
          defaultValue=""
          className="border border-black px-4 py-3 text-black text-base outline-none w-full"
        >
          <option value="" disabled>Hora del turno</option>
          {Array.from({ length: (23 * 60 + 30 - 7 * 60) / 30 + 1 }, (_, i) => {
            const minutos = 7 * 60 + i * 30;
            const h = Math.floor(minutos / 60);
            const m = minutos % 60;
            return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
          }).map((hora) => (
            <option key={hora} value={hora}>{hora}</option>
          ))}
        </select>
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
