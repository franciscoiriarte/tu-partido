import { createClient } from "@/utils/supabase/server";
import Image from "next/image";
import Link from "next/link";

export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ complejo?: string; fecha?: string; hora?: string }>;
}) {
  const { complejo = "", fecha = "", hora = "" } = await searchParams;

  if (!complejo || !fecha || !hora) {
    return (
      <main className="min-h-screen px-4 py-8 max-w-lg mx-auto" style={{ background: "var(--background)" }}>
        <Link href="/" className="text-sm text-white/40 underline mb-8 block">← Volver</Link>
        <p className="text-white">Búsqueda incompleta.</p>
      </main>
    );
  }

  const supabase = await createClient();

  const { data: complejos } = await supabase
    .from("complejos")
    .select("id, nombre")
    .ilike("nombre", `%${complejo}%`);

  const complejoIds = (complejos ?? []).map((c) => c.id);

  const { data: canchas } =
    complejoIds.length > 0
      ? await supabase.from("canchas").select("id, nombre, complejo_id").in("complejo_id", complejoIds)
      : { data: [] };

  const canchaIds = (canchas ?? []).map((c) => c.id);

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

  const turnoIds = (turnos ?? []).map((t) => t.id);

  const { data: highlights } =
    turnoIds.length > 0
      ? await supabase
          .from("highlights")
          .select("id, turno_id, clip_url")
          .in("turno_id", turnoIds)
          .not("clip_url", "is", null)
          .order("created_at")
      : { data: [] };

  const resultados = (turnos ?? []).map((t) => {
    const cancha = (canchas ?? []).find((c) => c.id === t.cancha_id);
    const comp = (complejos ?? []).find((co) => co.id === cancha?.complejo_id);
    const clips = (highlights ?? []).filter((h) => h.turno_id === t.id);
    return { ...t, cancha_nombre: cancha?.nombre ?? "", complejo_nombre: comp?.nombre ?? "", clips };
  });

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto" style={{ background: "var(--background)" }}>
      <Link href="/" className="text-sm text-white/40 underline mb-8 block">← Volver a buscar</Link>

      <div className="flex items-center gap-3 mb-8">
        <Image src="/logo.png" alt="Tu Partido" width={40} height={40} />
        {resultados.length > 0 && (
          <div>
            <p className="text-white font-semibold">{resultados[0].complejo_nombre}</p>
            <p className="text-white/40 text-sm">{fecha} — {hora}</p>
          </div>
        )}
      </div>

      {resultados.length === 0 && (
        <p className="text-white/60 text-base">
          No encontramos ningún partido para esa fecha y hora.
        </p>
      )}

      {resultados.map((turno) => (
        <div key={turno.id} className="mb-8 pb-8 border-b" style={{ borderColor: "var(--border)" }}>
          <p className="text-white/40 text-sm mb-1">{turno.cancha_nombre}</p>
          <p className="text-white font-medium mb-4">
            {turno.hora_inicio.slice(0, 5)} — {turno.hora_fin.slice(0, 5)}
          </p>

          {turno.video_url ? (
            <div>
              <video src={turno.video_url} controls className="w-full mb-3 rounded" />
              <a
                href={`/api/download?url=${encodeURIComponent(turno.video_url)}&filename=partido-${turno.id}.mp4`}
                className="block text-center py-3 text-sm font-semibold rounded"
                style={{ background: "var(--accent)", color: "#fff" }}
              >
                Descargar video completo
              </a>
            </div>
          ) : (
            <p className="text-white/40 text-sm">El video estará disponible en breve.</p>
          )}

          {/* Highlights */}
          {turno.clips.length > 0 && (
            <div className="mt-6">
              <p className="text-white/40 text-xs uppercase tracking-widest mb-3">
                Highlights · {turno.clips.length} jugada{turno.clips.length > 1 ? "s" : ""}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {turno.clips.map((clip, i) => (
                  <div key={clip.id} className="rounded overflow-hidden" style={{ background: "var(--surface)" }}>
                    <video
                      src={clip.clip_url!}
                      controls
                      playsInline
                      className="w-full"
                    />
                    <div className="flex items-center justify-between px-2 py-1">
                      <p className="text-white/40 text-xs">#{i + 1}</p>
                      <a
                        href={`/api/download?url=${encodeURIComponent(clip.clip_url!)}&filename=highlight-${i + 1}.mp4`}
                        className="text-xs font-semibold"
                        style={{ color: "var(--accent)" }}
                      >
                        Descargar
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
