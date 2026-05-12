"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

type Set = { a: number; b: number };

type Marcador = {
  equipo_a: string;
  equipo_b: string;
  puntos_a: string;
  puntos_b: string;
  sets: Set[];
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const PUNTOS = ["0", "15", "30", "40"];

const defaultMarcador = (): Marcador => ({
  equipo_a: "Equipo A",
  equipo_b: "Equipo B",
  puntos_a: "0",
  puntos_b: "0",
  sets: [{ a: 0, b: 0 }],
});

function nextPuntos(mio: string, rival: string): { nuevoMio: string; nuevoRival: string; gano: boolean } {
  if (mio === "0") return { nuevoMio: "15", nuevoRival: rival, gano: false };
  if (mio === "15") return { nuevoMio: "30", nuevoRival: rival, gano: false };
  if (mio === "30") return { nuevoMio: "40", nuevoRival: rival, gano: false };
  if (mio === "40") {
    if (rival === "A") return { nuevoMio: "40", nuevoRival: "40", gano: false }; // saca ventaja al rival
    if (rival === "40") return { nuevoMio: "A", nuevoRival: "40", gano: false }; // ventaja
    return { nuevoMio: "0", nuevoRival: "0", gano: true }; // gana juego
  }
  if (mio === "A") return { nuevoMio: "0", nuevoRival: "0", gano: true }; // gana juego con ventaja
  return { nuevoMio: "0", nuevoRival: rival, gano: false };
}

function ganarJuego(sets: Set[], equipo: "a" | "b"): Set[] {
  const nuevos = sets.map((s) => ({ ...s }));
  const actual = nuevos[nuevos.length - 1];
  actual[equipo]++;

  const rival = equipo === "a" ? "b" : "a";
  const ganoPorGames = actual[equipo] >= 6 && actual[equipo] - actual[rival] >= 2;
  const ganoPorTiebreak = actual[equipo] === 7 && actual[rival] === 6;

  if (ganoPorGames || ganoPorTiebreak) {
    nuevos.push({ a: 0, b: 0 });
  }

  return nuevos;
}

function MarcadorInner() {
  const searchParams = useSearchParams();
  const canchaId = searchParams.get("cancha_id") ?? "";

  const [marcador, setMarcador] = useState<Marcador>(defaultMarcador());
  const [guardando, setGuardando] = useState(false);
  const [estado, setEstado] = useState<"idle" | "ok" | "error">("idle");
  const [historial, setHistorial] = useState<Marcador[]>([]);

  useEffect(() => {
    if (!canchaId) return;
    fetch(`/api/marcador?cancha_id=${canchaId}`)
      .then((r) => r.json())
      .then(({ marcador }) => {
        if (marcador) setMarcador(marcador);
      });
  }, [canchaId]);

  const guardar = useCallback(
    async (nuevo: Marcador) => {
      if (!canchaId) return;
      setGuardando(true);
      try {
        await fetch(`/api/marcador?cancha_id=${canchaId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(nuevo),
        });
        setEstado("ok");
      } catch {
        setEstado("error");
      } finally {
        setGuardando(false);
        setTimeout(() => setEstado("idle"), 1500);
      }
    },
    [canchaId]
  );

  const punto = (equipo: "a" | "b") => {
    const mio = equipo === "a" ? marcador.puntos_a : marcador.puntos_b;
    const rival = equipo === "a" ? marcador.puntos_b : marcador.puntos_a;
    const { nuevoMio, nuevoRival, gano } = nextPuntos(mio, rival);

    let nuevoMarcador: Marcador;
    if (gano) {
      const nuevosSets = ganarJuego(marcador.sets, equipo);
      nuevoMarcador = { ...marcador, puntos_a: "0", puntos_b: "0", sets: nuevosSets };
    } else {
      nuevoMarcador = {
        ...marcador,
        puntos_a: equipo === "a" ? nuevoMio : nuevoRival,
        puntos_b: equipo === "b" ? nuevoMio : nuevoRival,
      };
    }

    setHistorial((h) => [...h.slice(-19), marcador]);
    setMarcador(nuevoMarcador);
    guardar(nuevoMarcador);
  };

  const deshacer = () => {
    if (historial.length === 0) return;
    const anterior = historial[historial.length - 1];
    setHistorial((h) => h.slice(0, -1));
    setMarcador(anterior);
    guardar(anterior);
  };

  const setsFinalizados = marcador.sets.slice(0, -1);
  const setActual = marcador.sets[marcador.sets.length - 1];

  if (!canchaId) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--background)" }}>
        <p className="text-white/60">Falta ?cancha_id= en la URL</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col px-4 py-6 max-w-sm mx-auto" style={{ background: "var(--background)" }}>
      <p className="text-white/40 text-xs text-center mb-6 uppercase tracking-widest">Marcador en vivo</p>

      {/* Nombres */}
      <div className="flex gap-2 mb-6">
        {(["a", "b"] as const).map((e) => (
          <input
            key={e}
            value={e === "a" ? marcador.equipo_a : marcador.equipo_b}
            onChange={(ev) => {
              const nuevo = { ...marcador, [`equipo_${e}`]: ev.target.value };
              setMarcador(nuevo);
            }}
            onBlur={() => guardar(marcador)}
            placeholder={e === "a" ? "Equipo A" : "Equipo B"}
            className="flex-1 text-center text-sm font-semibold rounded px-2 py-2 text-white outline-none"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          />
        ))}
      </div>

      {/* Sets finalizados */}
      {setsFinalizados.length > 0 && (
        <div className="flex justify-center gap-4 mb-4">
          {setsFinalizados.map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-white/30 text-xs mb-1">Set {i + 1}</p>
              <p className="text-white font-bold text-lg">{s.a} - {s.b}</p>
            </div>
          ))}
        </div>
      )}

      {/* Set actual */}
      <div className="text-center mb-2">
        <p className="text-white/30 text-xs mb-1">Set {marcador.sets.length}</p>
        <p className="text-white font-bold text-5xl tracking-wider">
          {setActual.a} - {setActual.b}
        </p>
      </div>

      {/* Puntos */}
      <div className="text-center mb-8">
        <p className="text-white/50 text-2xl font-mono">
          {marcador.puntos_a} — {marcador.puntos_b}
        </p>
      </div>

      {/* Botones de punto */}
      <div className="flex gap-3 mb-4">
        <button
          onClick={() => punto("a")}
          className="flex-1 py-8 rounded-xl text-white text-xl font-bold active:scale-95 transition-transform"
          style={{ background: "var(--accent)" }}
        >
          Punto {marcador.equipo_a.split(" ")[0]}
        </button>
        <button
          onClick={() => punto("b")}
          className="flex-1 py-8 rounded-xl text-white text-xl font-bold active:scale-95 transition-transform"
          style={{ background: "#2563eb" }}
        >
          Punto {marcador.equipo_b.split(" ")[0]}
        </button>
      </div>

      {/* Deshacer */}
      <button
        onClick={deshacer}
        disabled={historial.length === 0}
        className="w-full py-3 rounded-xl text-sm font-semibold transition-opacity disabled:opacity-30"
        style={{ background: "var(--surface)", color: "var(--text-muted, white)" }}
      >
        ↩ Deshacer
      </button>

      {/* Estado */}
      <p className="text-center mt-4 text-xs" style={{ color: estado === "ok" ? "#22c55e" : estado === "error" ? "#ef4444" : "transparent" }}>
        {estado === "ok" ? "Guardado" : estado === "error" ? "Error al guardar" : "."}
      </p>
      {guardando && <p className="text-center text-white/30 text-xs">Guardando…</p>}
    </main>
  );
}

export default function MarcadorPage() {
  return (
    <Suspense>
      <MarcadorInner />
    </Suspense>
  );
}
