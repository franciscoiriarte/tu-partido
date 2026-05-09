import { createAdminClient } from "@/utils/supabase/admin";
import { NextResponse } from "next/server";

// Acepta GET y POST para compatibilidad con Shelly button (usa GET por defecto)
export async function GET(request: Request) {
  return handleHighlight(request);
}

export async function POST(request: Request) {
  return handleHighlight(request);
}

async function handleHighlight(request: Request) {
  const { searchParams } = new URL(request.url);
  const canchaId = searchParams.get("cancha_id");

  if (!canchaId) {
    return NextResponse.json({ error: "Falta cancha_id" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Fecha y hora actual en Argentina (UTC-3)
  const ahora = new Date();
  const hoy = ahora.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const horaActual = ahora.toLocaleTimeString("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  // Buscar turno activo en este momento para esta cancha
  const { data: turno } = await supabase
    .from("turnos")
    .select("id")
    .eq("cancha_id", canchaId)
    .eq("fecha", hoy)
    .lte("hora_inicio", horaActual)
    .gt("hora_fin", horaActual)
    .single();

  if (!turno) {
    return NextResponse.json({ error: "No hay turno activo en este momento" }, { status: 404 });
  }

  const { data: highlight, error } = await supabase
    .from("highlights")
    .insert({ turno_id: turno.id })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, highlight_id: highlight.id });
}
