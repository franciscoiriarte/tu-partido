import { createClient } from "@/utils/supabase/server";
import Image from "next/image";
import BuscadorHome from "./BuscadorHome";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: complejos } = await supabase
    .from("complejos")
    .select("id, nombre")
    .order("nombre");

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-12"
      style={{ background: "var(--background)" }}>
      <Image
        src="/logo.png"
        alt="Tu Partido"
        width={180}
        height={180}
        className="mb-8"
        priority
      />
      <p className="text-white/50 text-sm mb-10 tracking-wide uppercase">
        Encontrá el video de tu partido
      </p>
      <BuscadorHome complejos={complejos ?? []} />
    </main>
  );
}
