import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import TurnosManager from "./TurnosManager";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: complejo } = await supabase
    .from("complejos")
    .select("*, canchas(*)")
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

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto" style={{ background: "var(--background)" }}>
      <h1 className="text-2xl font-semibold text-white mb-1">
        {complejo.nombre}
      </h1>
      <p className="text-sm text-white/40 mb-8">Gestión de turnos</p>
      <TurnosManager canchas={canchas} />
      <form action="/auth/signout" method="post" className="mt-12">
        <button type="submit" className="text-sm text-white/40 underline">
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
