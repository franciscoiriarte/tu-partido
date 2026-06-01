import { createClient } from "@/utils/supabase/server";
import Image from "next/image";
import Link from "next/link";
import ClipStatusPoller from "./ClipStatusPoller";
import ShareButton from "./ShareButton";
import SaveButton from "./SaveButton";

export default async function ResultadosPage({
  searchParams,
}: {
  searchParams: Promise<{ cancha?: string; fecha?: string; inicio?: string; fin?: string }>;
}) {
  const { cancha: canchaId = "", fecha = "", inicio = "", fin = "" } = await searchParams;

  if (!canchaId || !fecha || !inicio || !fin) {
    return (
      <main className="min-h-screen px-4 py-8 max-w-lg mx-auto" style={{ background: "var(--background)" }}>
        <Link href="/" className="text-sm text-white/40 underline mb-8 block">← Volver</Link>
        <p className="text-white">Búsqueda incompleta.</p>
      </main>
    );
  }

  const supabase = await createClient();

  // Cargar datos de la cancha
  const { data: cancha } = await supabase
    .from("canchas")
    .select("id, nombre, complejo_id, complejos(nombre)")
    .eq("id", canchaId)
    .single();

  // Buscar pedido existente (listo o en proceso)
  const { data: pedidoExistente } = await supabase
    .from("clip_requests")
    .select("*")
    .eq("cancha_id", canchaId)
    .eq("fecha", fecha)
    .eq("hora_inicio", inicio)
    .eq("hora_fin", fin)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Si hay uno con error, crear uno nuevo
  let pedido = pedidoExistente?.status !== "error" ? pedidoExistente : null;

  if (!pedido) {
    const { data: nuevo } = await supabase
      .from("clip_requests")
      .insert({ cancha_id: canchaId, fecha, hora_inicio: inicio, hora_fin: fin })
      .select()
      .single();
    pedido = nuevo;
  }

  // @ts-ignore - complejos puede ser array o objeto según la query
  const complejoNombre = cancha?.complejos?.nombre ?? cancha?.complejos?.[0]?.nombre ?? "";
  const canchaNombre   = cancha?.nombre ?? "";

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto" style={{ background: "var(--background)" }}>
      <Link href="/" className="text-sm text-white/40 underline mb-8 block">← Volver a buscar</Link>

      <div className="flex items-center gap-3 mb-8">
        <Image src="/logo.png" alt="Tu Partido" width={40} height={40} />
        <div>
          <p className="text-white font-semibold">{complejoNombre}</p>
          <p className="text-white/40 text-sm">
            {canchaNombre} · {fecha} · {inicio.slice(0, 5)}–{fin.slice(0, 5)}
          </p>
        </div>
      </div>

      {pedido?.status === "ready" && pedido.video_url ? (
        <div>
          <video controls playsInline preload="metadata" className="w-full mb-3 rounded">
            <source src={pedido.video_url} type="video/mp4" />
          </video>
          <div className="flex gap-2">
            <a
              href={`/api/download?url=${encodeURIComponent(pedido.video_url)}&filename=partido-${fecha}.mp4`}
              className="flex-1 block text-center py-3 text-sm font-semibold rounded"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              Descargar video completo
            </a>
            <ShareButton
              url={pedido.video_url}
              text={`Mirá el video de mi partido en Tu Partido 🎾`}
            />
          </div>
        </div>
      ) : (
        <ClipStatusPoller pedidoId={pedido?.id ?? null} initialStatus={pedido?.status ?? "pending"} />
      )}
    </main>
  );
}
