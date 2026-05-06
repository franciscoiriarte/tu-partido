"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";

export default function RegistroPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"jugador" | "club">("jugador");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleRegistro(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError("No se pudo crear la cuenta. Intentá de nuevo.");
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-white px-4">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold text-black mb-4">
            Revisá tu email
          </h1>
          <p className="text-black text-base">
            Te mandamos un link de confirmación a{" "}
            <strong>{email}</strong>. Hacé clic en ese link para activar tu
            cuenta.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-black mb-8">
          Crear cuenta
        </h1>
        <form onSubmit={handleRegistro} className="flex flex-col gap-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setRole("jugador")}
              className={`flex-1 py-3 text-sm font-medium border border-black ${
                role === "jugador"
                  ? "bg-black text-white"
                  : "bg-white text-black"
              }`}
            >
              Soy jugador
            </button>
            <button
              type="button"
              onClick={() => setRole("club")}
              className={`flex-1 py-3 text-sm font-medium border border-black ${
                role === "club" ? "bg-black text-white" : "bg-white text-black"
              }`}
            >
              Soy un club
            </button>
          </div>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="border border-black px-4 py-3 text-black text-base outline-none w-full"
          />
          <input
            type="password"
            placeholder="Contraseña (mínimo 6 caracteres)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="border border-black px-4 py-3 text-black text-base outline-none w-full"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="bg-black text-white py-3 text-base font-medium disabled:opacity-50"
          >
            {loading ? "Creando cuenta..." : "Crear cuenta"}
          </button>
        </form>
        <p className="mt-6 text-sm text-black">
          ¿Ya tenés cuenta?{" "}
          <Link href="/login" className="underline">
            Iniciá sesión
          </Link>
        </p>
      </div>
    </main>
  );
}
