import { createClient } from "@/utils/supabase/server";
import Image from "next/image";
import Link from "next/link";
import BuscadorHome from "./BuscadorHome";

export default async function HomePage() {
  const supabase = await createClient();
  const { data: complejos } = await supabase
    .from("complejos")
    .select("id, nombre")
    .order("nombre");

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--background)" }}>

      {/* Hero */}
      <section
        className="relative flex flex-col items-center justify-center px-4 pt-24 pb-20 min-h-screen"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -5%, rgba(61,124,101,0.28) 0%, transparent 70%)",
        }}
      >
        <Image
          src="/logo.png"
          alt="Tu Partido"
          width={150}
          height={150}
          className="mb-6 drop-shadow-lg"
          priority
        />
        <p
          className="text-white/40 text-xs mb-14 tracking-[0.35em] uppercase"
        >
          Encontrá el video de tu partido
        </p>

        <BuscadorHome complejos={complejos ?? []} />

        {/* scroll hint */}
        <div className="absolute bottom-8 flex flex-col items-center gap-2 animate-bounce">
          <span className="text-white/20 text-xs tracking-widest uppercase">Ver más</span>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 5l6 6 6-6" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </section>

      {/* Cómo funciona */}
      <section
        className="px-6 py-20 max-w-lg mx-auto w-full"
      >
        <p className="text-white/30 text-xs uppercase tracking-[0.3em] mb-10 text-center">
          Cómo funciona
        </p>
        <div className="flex flex-col gap-8">
          {[
            { num: "01", titulo: "Jugás tu partido", desc: "Las cámaras graban automáticamente cada turno en el complejo." },
            { num: "02", titulo: "Buscás tu turno", desc: "Ingresás el complejo, el día y la hora en que jugaste." },
            { num: "03", titulo: "Descargás el video", desc: "Encontrás tu partido y lo descargás directo al celular." },
          ].map((paso) => (
            <div key={paso.num} className="flex items-start gap-5">
              <span
                className="text-3xl font-bold leading-none shrink-0"
                style={{ color: "var(--accent)", opacity: 0.6 }}
              >
                {paso.num}
              </span>
              <div>
                <p className="text-white font-medium mb-1">{paso.titulo}</p>
                <p className="text-white/40 text-sm leading-relaxed">{paso.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA complejos */}
      <section
        className="px-6 py-20 text-center border-t"
        style={{
          borderColor: "var(--border)",
          background:
            "radial-gradient(ellipse 80% 60% at 50% 100%, rgba(61,124,101,0.18) 0%, transparent 70%)",
        }}
      >
        <p className="text-white/30 text-xs uppercase tracking-[0.3em] mb-5">
          Para complejos
        </p>
        <h2 className="text-2xl font-semibold text-white mb-4 leading-snug">
          ¿Querés integrar<br />TU PARTIDO a tu complejo?
        </h2>
        <p className="text-white/45 text-sm mb-10 max-w-xs mx-auto leading-relaxed">
          Instalamos las cámaras, configuramos el sistema y tus jugadores pueden ver y descargar sus partidos automáticamente.
        </p>
        <a
          href="mailto:franniriarte@gmail.com"
          className="inline-block px-8 py-3 text-sm font-semibold text-white"
          style={{ background: "var(--accent)" }}
        >
          Contactanos
        </a>
      </section>

      {/* Footer */}
      <footer
        className="py-8 text-center border-t"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-center gap-4">
          <Image src="/logo.png" alt="Tu Partido" width={24} height={24} />
          <p className="text-white/20 text-xs">© 2025 Tu Partido</p>
        </div>
        <Link href="/login" className="text-white/15 text-xs mt-3 block hover:text-white/30 transition-colors">
          Acceso complejos
        </Link>
      </footer>
    </main>
  );
}
