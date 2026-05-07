"use client";

import { useState } from "react";

const COMPLEJOS = ["Complejo de Prueba", "Puma Padel", "Runa Padel"];
const DIAS = ["Hoy", "Ayer", "5 may", "4 may"];
const HORAS = ["08:30", "10:00", "12:00", "14:00", "16:00", "18:00", "20:30", "22:00"];

const FEATURES = [
  "Instalación llave en mano sin obra civil",
  "Diferenciate de otros clubes de la zona",
  "Streaming gratis de tus torneos en YouTube",
  "Hardware y mantenimiento sin costo",
  "3 meses de prueba sin compromiso",
];

const STREAMING_FEATS = [
  "Streaming directo al canal de Tu Partido en YouTube",
  "Tanteo y resultado en vivo en pantalla",
  "Hasta 2 partidos en simultáneo",
  "Operación con tablet, sin equipo extra",
];

const STATS = [
  { num: "+40%", lbl: "Retención de socios" },
  { num: "24/7", lbl: "Grabación automática" },
  { num: "48h", lbl: "Disponibilidad video" },
  { num: "$0", lbl: "Costo del jugador" },
];

export default function Home() {
  const [complejo, setComplejo] = useState("Runa Padel");
  const [dia, setDia] = useState("Hoy");
  const [hora, setHora] = useState("20:30");

  return (
    <main className="min-h-screen bg-[#0a1f1a] text-white">
      {/* HERO */}
      <section className="px-6 pt-12 pb-10 text-center">
        <Brand />
        <h1 className="text-3xl font-medium mt-6 mb-2">Reviví tu partido.</h1>
        <p className="text-sm text-white/55 mb-6">
          Encontrá el video de tu turno y compartilo en segundos.
        </p>
        <div className="bg-white/[0.03] border border-white/10 rounded-2xl p-5 max-w-md mx-auto text-left">
          <Label>Complejo</Label>
          <ChipRow items={COMPLEJOS} active={complejo} onSelect={setComplejo} />
          <Label>Día</Label>
          <ChipRow items={DIAS} active={dia} onSelect={setDia} />
          <Label>Hora</Label>
          <select
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className="w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-lg text-white text-sm mb-4 appearance-none"
          >
            {HORAS.map((h) => <option key={h}>{h}</option>)}
          </select>
          <button className="w-full py-3 bg-[#2D9D75] hover:bg-[#1D9E75] rounded-xl font-medium text-sm transition-colors">
            Buscar mi partido
          </button>
        </div>
      </section>

      {/* CÓMO FUNCIONA */}
      <section className="px-6 py-10">
        <SectionLabel>Cómo funciona</SectionLabel>
        <h2 className="text-2xl font-medium text-center mb-6">Tres pasos y listo</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-4xl mx-auto">
          <StepCard icon={<CameraIcon />} num="PASO 01" title="Jugás tu partido"
            desc="Las cámaras graban automático cada turno en el complejo." />
          <StepCard icon={<SearchIcon />} num="PASO 02" title="Buscás tu turno"
            desc="Ingresás complejo, día y hora. Sin registro, sin login." />
          <StepCard icon={<DownloadIcon />} num="PASO 03" title="Lo ves y descargás"
            desc="Mirá tu partido completo y los highlights, gratis." />
        </div>
      </section>

      {/* STREAMING */}
      <section className="px-6 py-10 border-t border-white/5">
        <SectionLabel>Streaming en vivo</SectionLabel>
        <h2 className="text-2xl font-medium text-center mb-6 max-w-xl mx-auto">
          Transmití tus torneos en vivo por YouTube
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center max-w-4xl mx-auto">
          <div>
            <p className="text-sm text-white/75 mb-4 leading-relaxed">
              Llevá tu complejo al siguiente nivel. Te damos la tecnología para streamear tus torneos en directo,
              con el tanteo y los puntos cargándose en tiempo real.
            </p>
            <ul className="space-y-2 mb-5">
              {STREAMING_FEATS.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-white/70">
                  <CheckIcon />{f}
                </li>
              ))}
            </ul>
            <button className="px-5 py-3 bg-[#2D9D75] hover:bg-[#1D9E75] rounded-xl font-medium text-sm transition-colors">
              Sumar streaming →
            </button>
          </div>
          <MockPlayer />
        </div>
      </section>

      {/* PARA COMPLEJOS */}
      <section className="px-6 py-10 border-t border-b border-white/5">
        <SectionLabel>Para complejos</SectionLabel>
        <h2 className="text-2xl font-medium text-center mb-6">Sumá Tu Partido a tu cancha</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center max-w-4xl mx-auto">
          <div>
            <ul className="space-y-3 mb-6">
              {FEATURES.map((feat) => (
                <li key={feat} className="flex items-start gap-2 text-sm text-white/75">
                  <CheckIcon />{feat}
                </li>
              ))}
            </ul>
            <button className="px-6 py-3 bg-[#2D9D75] hover:bg-[#1D9E75] rounded-xl font-medium text-sm transition-colors">
              Quiero más info →
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 p-4 bg-white/[0.03] border border-white/10 rounded-xl">
            {STATS.map((s) => (
              <div key={s.lbl} className="text-center py-2">
                <p className="text-2xl font-medium text-[#5DCAA5] m-0">{s.num}</p>
                <p className="text-xs text-white/50 mt-1">{s.lbl}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="px-6 py-8 flex flex-col items-center gap-4">
        <Brand />
        <div className="flex gap-3">
          <SocialIcon href="https://instagram.com/tupartido"><InstagramIcon /></SocialIcon>
          <SocialIcon href="https://wa.me/5491155551234"><WhatsAppIcon /></SocialIcon>
          <SocialIcon href="mailto:hola@tupartido.com.ar"><MailIcon /></SocialIcon>
        </div>
        <p className="text-xs text-white/40">© 2026 Tu Partido · Hecho en Argentina</p>
      </footer>
    </main>
  );
}

function MockPlayer() {
  return (
    <div className="aspect-video bg-[#1a1a1a] rounded-xl relative overflow-hidden border border-white/10">
      <div className="absolute top-2.5 left-2.5 bg-[#E24B4A] text-white px-2 py-0.5 rounded text-[10px] font-semibold tracking-wider flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        LIVE
      </div>
      <div className="absolute top-2.5 right-2.5 bg-black/50 text-white px-2 py-0.5 rounded text-[10px] flex items-center gap-1">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        142
      </div>
      <div className="absolute inset-0 flex items-center justify-center opacity-15">
        <svg width="120" height="80" viewBox="0 0 120 80" fill="none" stroke="#5DCAA5" strokeWidth="1">
          <rect x="10" y="10" width="100" height="60" rx="2"/>
          <line x1="10" y1="40" x2="110" y2="40"/>
          <line x1="60" y1="10" x2="60" y2="70"/>
          <rect x="35" y="25" width="50" height="30"/>
        </svg>
      </div>
      <div className="absolute bottom-2.5 left-2.5 right-2.5 bg-black/65 backdrop-blur-sm px-2.5 py-2 rounded-md grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[10px] text-white truncate">Juan + Pedro</span>
          <span className="text-[10px] text-white/50 truncate">Set 1: 6-4</span>
        </div>
        <span className="text-lg font-semibold text-[#5DCAA5] tabular-nums px-2">5—3</span>
        <div className="flex flex-col gap-0.5 min-w-0 text-right">
          <span className="text-[10px] text-white truncate">María + Carlos</span>
          <span className="text-[10px] text-white/50 truncate">Cancha 2 · Final</span>
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <div className="inline-flex items-center gap-1">
      <span className="font-serif italic text-2xl">tu</span>
      <span className="text-2xl font-medium tracking-tight">partido</span>
      <span className="inline-block w-3 h-3 rounded-full bg-[#5DCAA5] ml-1" />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] tracking-widest text-white/45 uppercase mb-2 font-medium">{children}</p>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] tracking-widest text-[#5DCAA5] uppercase text-center mb-1 font-medium">{children}</p>;
}

function ChipRow({ items, active, onSelect }: { items: string[]; active: string; onSelect: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {items.map((item) => (
        <button key={item} onClick={() => onSelect(item)}
          className={`px-3 py-2 border rounded-lg text-xs transition-all ${
            active === item
              ? "bg-[#2D9D75] border-[#2D9D75] text-white"
              : "bg-white/[0.04] border-white/10 text-white/70 hover:text-white hover:border-[#5DCAA5]/30"
          }`}>
          {item}
        </button>
      ))}
    </div>
  );
}

function StepCard({ icon, num, title, desc }: { icon: React.ReactNode; num: string; title: string; desc: string }) {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-xl p-5 transition-all hover:border-[#5DCAA5]/40 hover:bg-[#2D9D75]/[0.05] hover:-translate-y-0.5">
      <div className="w-10 h-10 rounded-full bg-[#2D9D75]/15 flex items-center justify-center mb-3">
        {icon}
      </div>
      <p className="text-[11px] text-[#5DCAA5] font-semibold tracking-wider mb-1">{num}</p>
      <p className="text-sm font-medium mb-1">{title}</p>
      <p className="text-xs text-white/55 leading-relaxed">{desc}</p>
    </div>
  );
}

function SocialIcon({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      className="w-9 h-9 rounded-full bg-white/[0.04] border border-white/10 flex items-center justify-center transition-all hover:bg-[#2D9D75]/15 hover:border-[#5DCAA5]/40">
      {children}
    </a>
  );
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#5DCAA5" strokeWidth="3" className="mt-1 flex-shrink-0"><polyline points="20 6 9 17 4 12" /></svg>;
}
function CameraIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5DCAA5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>;
}
function SearchIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5DCAA5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>;
}
function DownloadIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5DCAA5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
}
function InstagramIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>;
}
function WhatsAppIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413"/></svg>;
}
function MailIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>;
}
