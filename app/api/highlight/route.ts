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

  const { data: highlight, error } = await supabase
    .from("highlights")
    .insert({ cancha_id: canchaId, marcado_en: new Date().toISOString() })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, highlight_id: highlight.id });
}
