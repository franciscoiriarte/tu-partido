import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { agregarCancha, eliminarCancha } from "./actions";
import SubirVideo from "./SubirVideo";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.user_metadata?.role !== "admin") redirect("/dashboard");

  const admin = createAdminClient();
  const { data: complejos } = await admin
    .from("complejos")
    .select("*, canchas(*)")
    .order("nombre");

  const { data: turnosRecientes } = await admin
    .from("turnos")
    .select("id, fecha, hora_inicio, hora_fin, canchas(nombre)")
    .order("fecha", { ascending: false })
    .order("hora_inicio", { ascending: false })
    .limit(30);

  const turnos = (turnosRecientes ?? []).map((t: any) => ({
    id: t.id,
    fecha: t.fecha,
    hora_inicio: t.hora_inicio,
    hora_fin: t.hora_fin,
    cancha_nombre: t.canchas?.nombre ?? "",
  }));

  return (
    <main className="min-h-screen bg-white px-4 py-8 max-w-lg mx-auto">
      <h1 className="text-2xl font-semibold text-black mb-8">Panel admin</h1>

      {complejos?.length === 0 && (
        <p className="text-sm text-black/50">
          No hay complejos registrados todavía.
        </p>
      )}

      {complejos?.map((complejo) => (
        <div key={complejo.id} className="mb-10">
          <h2 className="text-lg font-medium text-black mb-3">
            {complejo.nombre}
          </h2>

          <ul className="mb-4">
            {complejo.canchas?.length === 0 && (
              <li className="text-sm text-black/40 py-2">Sin canchas</li>
            )}
            {complejo.canchas?.map(
              (cancha: { id: string; nombre: string }) => (
                <li
                  key={cancha.id}
                  className="flex items-center justify-between py-2 border-b border-black/10"
                >
                  <span className="text-sm text-black">{cancha.nombre}</span>
                  <form action={eliminarCancha}>
                    <input type="hidden" name="id" value={cancha.id} />
                    <button
                      type="submit"
                      className="text-xs text-black underline"
                    >
                      Eliminar
                    </button>
                  </form>
                </li>
              )
            )}
          </ul>

          <form action={agregarCancha} className="flex gap-2">
            <input type="hidden" name="complejo_id" value={complejo.id} />
            <input
              type="text"
              name="nombre"
              placeholder="Nombre de la cancha"
              required
              className="border border-black px-3 py-2 text-sm text-black outline-none flex-1"
            />
            <button
              type="submit"
              className="bg-black text-white px-4 py-2 text-sm font-medium"
            >
              Agregar
            </button>
          </form>
        </div>
      ))}

      <SubirVideo turnos={turnos} />
    </main>
  );
}
