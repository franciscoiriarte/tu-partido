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
        <input
          type="time"
          name="hora"
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
