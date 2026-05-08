"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";

const DIAS = [
  { label: "Dom", value: 0 },
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mié", value: 3 },
  { label: "Jue", value: 4 },
  { label: "Vie", value: 5 },
  { label: "Sáb", value: 6 },
];

const HORAS = Array.from({ length: (23 * 60 + 30 - 7 * 60) / 30 + 1 }, (_, i) => {
  const minutos = 7 * 60 + i * 30;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

const DURACIONES = [60, 90, 120];

function horaASegundos(h: string) {
  const [hh, mm] = h.split(":").map(Number);
  return hh * 3600 + mm * 60;
}

function segundosAHora(s: number) {
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

function generarSlots(inicio: string, fin: string, durMin: number) {
  const slots: { inicio: string; fin: string }[] = [];
  let actual = horaASegundos(inicio);
  const finSeg = horaASegundos(fin);
  const dur = durMin * 60;
  while (actual + dur <= finSeg) {
    slots.push({ inicio: segundosAHora(actual), fin: segundosAHora(actual + dur) });
    actual += dur;
  }
  return slots;
}

type Cancha = { id: string; nombre: string };
type HorarioRow = {
  id?: string;
  cancha_id: string;
  dia_semana: number;
  hora_inicio: string;
  hora_fin: string;
  duracion_min: number;
};
type DiaConfig = {
  activo: boolean;
  hora_inicio: string;
  hora_fin: string;
};

function initConfig(horarios: HorarioRow[], canchaId: string): Record<number, DiaConfig> {
  const map: Record<number, DiaConfig> = {};
  for (let i = 0; i <= 6; i++) {
    const h = horarios.find((h) => h.cancha_id === canchaId && h.dia_semana === i);
    map[i] = h
      ? { activo: true, hora_inicio: h.hora_inicio.slice(0, 5), hora_fin: h.hora_fin.slice(0, 5) }
      : { activo: false, hora_inicio: "08:00", hora_fin: "22:00" };
  }
  return map;
}

export default function HorarioManager({
  canchas,
  horarios,
}: {
  canchas: Cancha[];
  horarios: HorarioRow[];
}) {
  return (
    <div className="mt-12 pt-8 border-t" style={{ borderColor: "var(--border)" }}>
      <p className="text-white font-medium mb-1">Horario tipo</p>
      <p className="text-white/40 text-sm mb-6">
        El sistema crea los turnos automáticamente cada día según este horario.
      </p>
      {canchas.map((cancha) => (
        <CanchaHorario
          key={cancha.id}
          cancha={cancha}
          horarios={horarios.filter((h) => h.cancha_id === cancha.id)}
        />
      ))}
    </div>
  );
}

function CanchaHorario({ cancha, horarios }: { cancha: Cancha; horarios: HorarioRow[] }) {
  const [config, setConfig] = useState<Record<number, DiaConfig>>(() =>
    initConfig(horarios, cancha.id)
  );
  const [duracion, setDuracion] = useState(horarios[0]?.duracion_min ?? 90);
  const [estado, setEstado] = useState<"idle" | "guardando" | "ok" | "error">("idle");

  function setDia(dia: number, partial: Partial<DiaConfig>) {
    setConfig((prev) => ({ ...prev, [dia]: { ...prev[dia], ...partial } }));
  }

  async function guardar() {
    setEstado("guardando");
    const supabase = createClient();

    try {
      for (const { value: dia } of DIAS) {
        const d = config[dia];
        if (d.activo) {
          await supabase.from("horarios").upsert(
            {
              cancha_id: cancha.id,
              dia_semana: dia,
              hora_inicio: d.hora_inicio,
              hora_fin: d.hora_fin,
              duracion_min: duracion,
            },
            { onConflict: "cancha_id,dia_semana" }
          );
        } else {
          await supabase
            .from("horarios")
            .delete()
            .eq("cancha_id", cancha.id)
            .eq("dia_semana", dia);
        }
      }

      // Generar turnos de hoy si el día de hoy está activo
      const diaSemanaHoy = new Date().getDay();
      const configHoy = config[diaSemanaHoy];
      if (configHoy?.activo) {
        const hoy = new Date().toLocaleDateString("en-CA");
        const slots = generarSlots(configHoy.hora_inicio, configHoy.hora_fin, duracion);

        const { data: existentes } = await supabase
          .from("turnos")
          .select("hora_inicio")
          .eq("cancha_id", cancha.id)
          .eq("fecha", hoy);

        const horasExistentes = new Set((existentes ?? []).map((t) => t.hora_inicio));
        const nuevos = slots
          .filter((s) => !horasExistentes.has(s.inicio))
          .map((s) => ({ cancha_id: cancha.id, fecha: hoy, hora_inicio: s.inicio, hora_fin: s.fin }));

        if (nuevos.length > 0) {
          await supabase.from("turnos").insert(nuevos);
        }
      }

      setEstado("ok");
      setTimeout(() => {
        setEstado("idle");
        window.location.reload(); // refresca para mostrar los turnos nuevos
      }, 1000);
    } catch {
      setEstado("error");
    }
  }

  return (
    <div className="mb-8">
      <p className="text-white/60 text-sm font-medium mb-3">{cancha.nombre}</p>

      <div className="border rounded-lg overflow-hidden mb-3" style={{ borderColor: "var(--border)" }}>
        {DIAS.map(({ label, value }) => {
          const d = config[value];
          return (
            <div
              key={value}
              className="flex items-center gap-3 px-3 py-2.5 border-b last:border-b-0"
              style={{ borderColor: "var(--border)", background: d.activo ? "var(--surface)" : "transparent" }}
            >
              {/* Checkbox visible */}
              <button
                type="button"
                onClick={() => setDia(value, { activo: !d.activo })}
                className="w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 transition-colors"
                style={
                  d.activo
                    ? { background: "var(--accent)", borderColor: "var(--accent)" }
                    : { background: "transparent", borderColor: "var(--border)" }
                }
              >
                {d.activo && (
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <polyline points="2,5 4,7 8,3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>

              <span className={`w-8 text-xs font-medium flex-shrink-0 ${d.activo ? "text-white" : "text-white/35"}`}>
                {label}
              </span>

              {d.activo ? (
                <>
                  <select
                    value={d.hora_inicio}
                    onChange={(e) => setDia(value, { hora_inicio: e.target.value })}
                    className="px-2 py-1 text-xs text-white outline-none border rounded"
                    style={{ background: "var(--background)", borderColor: "var(--border)" }}
                  >
                    {HORAS.map((h) => (
                      <option key={h} value={h} style={{ background: "#1a1a1a" }}>{h}</option>
                    ))}
                  </select>
                  <span className="text-white/30 text-xs">a</span>
                  <select
                    value={d.hora_fin}
                    onChange={(e) => setDia(value, { hora_fin: e.target.value })}
                    className="px-2 py-1 text-xs text-white outline-none border rounded"
                    style={{ background: "var(--background)", borderColor: "var(--border)" }}
                  >
                    {HORAS.map((h) => (
                      <option key={h} value={h} style={{ background: "#1a1a1a" }}>{h}</option>
                    ))}
                  </select>
                </>
              ) : (
                <span className="text-white/20 text-xs">Cerrado</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Duración */}
      <div className="flex items-center gap-3 mb-4">
        <span className="text-white/40 text-xs">Duración de cada turno:</span>
        <div className="flex gap-1">
          {DURACIONES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDuracion(d)}
              className="px-3 py-1 text-xs border rounded transition-colors"
              style={
                duracion === d
                  ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                  : { background: "transparent", borderColor: "var(--border)", color: "rgba(255,255,255,0.4)" }
              }
            >
              {d} min
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={guardar}
        disabled={estado === "guardando"}
        className="px-5 py-2 text-sm font-medium text-white disabled:opacity-40 rounded"
        style={{ background: "var(--accent)" }}
      >
        {estado === "guardando" ? "Guardando…" : estado === "ok" ? "✓ Guardado" : "Guardar horario"}
      </button>
      {estado === "error" && (
        <p className="text-red-400 text-xs mt-2">Error al guardar. Intentá de nuevo.</p>
      )}
    </div>
  );
}
