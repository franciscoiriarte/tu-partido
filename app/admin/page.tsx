import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { agregarCancha, eliminarCancha, cambiarPassword } from "./actions";

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

  const emailsPorComplejo: Record<string, string> = {};
  for (const c of complejos ?? []) {
    if (!c.user_id) continue;
    const { data } = await admin.auth.admin.getUserById(c.user_id);
    if (data?.user?.email) emailsPorComplejo[c.id] = data.user.email;
  }

  return (
    <main className="min-h-screen px-4 py-8 max-w-lg mx-auto" style={{ background: "var(--background)" }}>
      <h1 className="text-2xl font-semibold text-white mb-8">Panel admin</h1>

      {complejos?.length === 0 && (
        <p className="text-sm text-white/40">
          No hay complejos registrados todavía.
        </p>
      )}

      {complejos?.map((complejo) => (
        <div key={complejo.id} className="mb-10">
          <h2 className="text-lg font-medium text-white mb-1">
            {complejo.nombre}
          </h2>
          {emailsPorComplejo[complejo.id] && (
            <p className="text-xs text-white/40 mb-3">
              {emailsPorComplejo[complejo.id]}
            </p>
          )}

          <ul className="mb-4">
            {complejo.canchas?.length === 0 && (
              <li className="text-sm text-white/40 py-2">Sin canchas</li>
            )}
            {complejo.canchas?.map(
              (cancha: { id: string; nombre: string }) => (
                <li
                  key={cancha.id}
                  className="flex items-center justify-between py-2 border-b"
                  style={{ borderColor: "var(--border)" }}
                >
                  <span className="text-sm text-white">{cancha.nombre}</span>
                  <form action={eliminarCancha}>
                    <input type="hidden" name="id" value={cancha.id} />
                    <button
                      type="submit"
                      className="text-xs text-white/40 underline"
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
              className="px-3 py-2 text-sm text-white outline-none flex-1 border"
              style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            />
            <button
              type="submit"
              className="px-4 py-2 text-sm font-semibold text-white"
              style={{ background: "var(--accent)" }}
            >
              Agregar
            </button>
          </form>

          {complejo.user_id && (
            <form action={cambiarPassword} className="flex gap-2 mt-3">
              <input type="hidden" name="user_id" value={complejo.user_id} />
              <input
                type="text"
                name="password"
                placeholder="Nueva contraseña"
                required
                minLength={6}
                className="px-3 py-2 text-sm text-white outline-none flex-1 border"
                style={{ background: "var(--surface)", borderColor: "var(--border)" }}
              />
              <button
                type="submit"
                className="px-4 py-2 text-sm font-semibold text-white/70 border"
                style={{ borderColor: "var(--border)" }}
              >
                Cambiar contraseña
              </button>
            </form>
          )}
        </div>
      ))}
    </main>
  );
}
