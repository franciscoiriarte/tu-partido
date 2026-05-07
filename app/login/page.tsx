"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/utils/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError("Email o contraseña incorrectos.");
      setLoading(false);
      return;
    }

    const role = data.user?.user_metadata?.role;
    router.push(role === "admin" ? "/admin" : "/dashboard");
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4"
      style={{ background: "var(--background)" }}>
      <Image src="/logo.png" alt="Tu Partido" width={120} height={120} className="mb-10" />
      <form onSubmit={handleLogin} className="flex flex-col gap-4 w-full max-w-sm">
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
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
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
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
      <p className="mt-6 text-sm text-white/40">
        ¿No tenés cuenta?{" "}
        <Link href="/registro" className="text-white/70 underline">
          Registrate
        </Link>
      </p>
    </main>
  );
}
