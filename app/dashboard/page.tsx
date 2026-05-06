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
      <main className="min-h-screen bg-white px-4 py-8">
        <p className="text-sm text-black mb-6">
          Tu complejo aún no está configurado. Contactá al administrador.
        </p>
        <form action="/auth/signout" method="post">
          <button type="submit" className="text-sm text-black underline">
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
    <main className="min-h-screen bg-white px-4 py-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold text-black mb-1">
        {complejo.nombre}
      </h1>
      <p className="text-sm text-black/50 mb-8">Gestión de turnos</p>
      <TurnosManager canchas={canchas} />
      <form action="/auth/signout" method="post" className="mt-12">
        <button type="submit" className="text-sm text-black underline">
          Cerrar sesión
        </button>
      </form>
    </main>
  );
}
