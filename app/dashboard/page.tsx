import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import TransmisionesManager from "./TransmisionesManager";
import TurnosFijosManager from "./TurnosFijosManager";
import ReconectarCamara from "./ReconectarCamara";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: complejo } = await supabase
    .from("complejos")
    .select("*, canchas(id, nombre, turnos_fijos), recorder_status")
    .eq("user_id", user.id)
    .single();

  if (!complejo) {
    return (
      <main className="min-h-screen px-4 py-8" style={{ background: "var(--background)" }}>
        <p className="text-sm text-white/60 mb-6">
          Tu complejo aún no está configurado. Contactá al administrador.
        </p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-sm text-white/40 underline">
            Cerrar sesión
          </button>
        </form>
      </main>
    );
  }

  const canchas = (complejo.canchas ?? []).sort((a: { nombre: string }, b: { nombre: string }) =>
    a.nombre.localeCompare(b.nombre)
  );

  const status = complejo.recorder_status as {
    ultima_actualizacion?: string;
    grabando?: number;
    camaras?: { id: string; nombre: string; grabando: boolean; reintentos: number }[];
  } | null;

  const hace = status?.ultima_actualizacion
    ? Math.round((Date.now() - new Date(status.ultima_actualizacion).getTime()) / 60000)
    : null;
  const online = hace !== null && hace < 3;

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto" style={{ background: "var(--background)" }}>
      <h1 className="text-2xl font-semibold text-white mb-1">
        {complejo.nombre}
      </h1>

      {/* Estado del recorder */}
      <div className="rounded-xl p-4 mb-8 border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-white">Cámaras</p>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${online ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
            {online ? `${status?.grabando ?? 0}/4 grabando` : hace === null ? "sin datos" : `sin señal hace ${hace} min`}
          </span>
        </div>
        {status?.camaras && (
          <div className="flex flex-col gap-2">
            {status.camaras.map((c) => (
              <div key={c.id} className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.grabando ? "bg-green-400" : "bg-red-400"}`} />
                <span className="text-xs text-white/60 flex-1">{c.nombre}</span>
                {c.reintentos > 0 && <span className="text-xs text-yellow-400">{c.reintentos} reintentos</span>}
                {!c.grabando && <ReconectarCamara canchaId={c.id} nombre={c.nombre} />}
              </div>
            ))}
          </div>
        )}
        {!status && <p className="text-xs text-white/30">Recorder no conectado</p>}
      </div>

      <TurnosFijosManager canchas={canchas} />
      <TransmisionesManager canchas={canchas} />
      <form action="/auth/signout" method="post" className="mt-12">
        <button type="submit" className="text-sm text-white/40 underline">
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
