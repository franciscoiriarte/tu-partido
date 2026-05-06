import { createClient } from "@/utils/supabase/server";
import BuscadorHome from "./BuscadorHome";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: complejos } = await supabase
    .from("complejos")
    .select("id, nombre")
    .order("nombre");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-white px-4 py-12">
      <h1 className="text-3xl font-semibold text-black mb-2">Tu Partido</h1>
      <p className="text-black text-base mb-10">Buscá el video de tu partido</p>
      <BuscadorHome complejos={complejos ?? []} />
    </main>
  );
}
