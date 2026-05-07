"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/utils/supabase/client";

export default function RegistroPage() {
  const [nombreComplejo, setNombreComplejo] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        data: { role: "club", nombre_complejo: nombreComplejo },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    setDone(true);
    setLoading(false);
  }

  if (done) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4"
        style={{ background: "var(--background)" }}>
        <div className="w-full max-w-sm text-center">
          <p className="text-white text-lg font-medium mb-2">Revisá tu email</p>
          <p className="text-white/50 text-sm">
            Te mandamos un link de confirmación a <strong className="text-white">{email}</strong>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "var(--background)" }}>
      <Image src="/logo.png" alt="Tu Partido" width={120} height={120} className="mb-10" />
      <form onSubmit={handleRegistro} className="flex flex-col gap-4 w-full max-w-sm">
        <input
          type="text"
          placeholder="Nombre del complejo"
          value={nombreComplejo}
          onChange={(e) => setNombreComplejo(e.target.value)}
          required
          className="px-4 py-3 text-white text-base outline-none border"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        />
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="px-4 py-3 text-white text-base outline-none border"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        />
        <input
          type="password"
          placeholder="Contraseña (mínimo 6 caracteres)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
          className="px-4 py-3 text-white text-base outline-none border"
          style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="py-3 text-base font-semibold disabled:opacity-40"
          style={{ background: "var(--accent)", color: "#fff" }}
        >
          {loading ? "Creando cuenta..." : "Crear cuenta"}
        </button>
      </form>
      <p className="mt-6 text-sm text-white/40">
        ¿Ya tenés cuenta?{" "}
        <Link href="/login" className="text-white/70 underline">
          Iniciá sesión
        </Link>
      </p>
    </main>
  );
}
