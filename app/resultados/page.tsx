import { createClient } from "@/utils/supabase/server";
import Link from "next/link";

export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ complejo?: string; fecha?: string; hora?: string }>;
}) {
  const { complejo = "", fecha = "", hora = "" } = await searchParams;

  if (!complejo || !fecha || !hora) {
    return (
      <main className="min-h-screen bg-white px-4 py-8 max-w-lg mx-auto">
        <Link href="/" className="text-sm text-black underline mb-8 block">
          ← Volver a buscar
        </Link>
        <p className="text-black text-base">Búsqueda incompleta.</p>
      </main>
    );
  }

  const supabase = await createClient();

  // 1. Buscar complejos que coincidan con el nombre
  const { data: complejos } = await supabase
    .from("complejos")
    .select("id, nombre")
    .ilike("nombre", `%${complejo}%`);

  const complejoIds = (complejos ?? []).map((c) => c.id);

  // 2. Buscar canchas de esos complejos
  const { data: canchas } =
    complejoIds.length > 0
      ? await supabase
          .from("canchas")
          .select("id, nombre, complejo_id")
          .in("complejo_id", complejoIds)
      : { data: [] };

  const canchaIds = (canchas ?? []).map((c) => c.id);

  // 3. Buscar turnos que cubran el horario buscado
  const { data: turnos } =
    canchaIds.length > 0
      ? await supabase
          .from("turnos")
          .select("id, hora_inicio, hora_fin, video_url, cancha_id")
          .in("cancha_id", canchaIds)
          .eq("fecha", fecha)
          .lte("hora_inicio", hora)
          .gt("hora_fin", hora)
          .order("hora_inicio")
      : { data: [] };

  const resultados = (turnos ?? []).map((t) => {
    const cancha = (canchas ?? []).find((c) => c.id === t.cancha_id);
    const complejo = (complejos ?? []).find(
      (co) => co.id === cancha?.complejo_id
    );
    return {
      ...t,
      cancha_nombre: cancha?.nombre ?? "",
      complejo_nombre: complejo?.nombre ?? "",
    };
  });

  return (
    <main className="min-h-screen bg-white px-4 py-8 max-w-lg mx-auto">
      <Link href="/" className="text-sm text-black underline mb-8 block">
        ← Volver a buscar
      </Link>

      {resultados.length > 0 && (
        <>
          <h1 className="text-xl font-semibold text-black mb-1">
            {resultados[0].complejo_nombre}
          </h1>
          <p className="text-sm text-black/50 mb-8">
            {fecha} — {hora}
          </p>
        </>
      )}

      {resultados.length === 0 && (
        <p className="text-black text-base">
          No encontramos ningún partido para esa fecha y hora.
        </p>
      )}

      {resultados.map((turno) => (
        <div key={turno.id} className="mb-6 border-b border-black/10 pb-6">
          <p className="text-sm text-black/50 mb-1">{turno.cancha_nombre}</p>
          <p className="text-base font-medium text-black mb-4">
            {turno.hora_inicio.slice(0, 5)} — {turno.hora_fin.slice(0, 5)}
          </p>

          {turno.video_url ? (
            <div>
              <video src={turno.video_url} controls className="w-full mb-3" />
              <a
                href={turno.video_url}
                download
                className="block text-center bg-black text-white py-3 text-sm font-medium"
              >
                Descargar video
              </a>
            </div>
          ) : (
            <p className="text-sm text-black/50">
              El video estará disponible en breve.
            </p>
          )}
        </div>
      ))}
    </main>
  );
}
