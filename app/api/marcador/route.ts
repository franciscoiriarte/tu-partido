import { createAdminClient } from "@/utils/supabase/admin";
import { NextResponse } from "next/server";

function turnoActivo(supabase: ReturnType<typeof createAdminClient>, canchaId: string) {
  const ahora = new Date();
  const hoy = ahora.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const hora = ahora.toLocaleTimeString("en-GB", {
    timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  return supabase
    .from("turnos")
    .select("id")
    .eq("cancha_id", canchaId)
    .eq("fecha", hoy)
    .lte("hora_inicio", hora)
    .gt("hora_fin", hora)
    .single();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const canchaId = searchParams.get("cancha_id");
  if (!canchaId) return NextResponse.json({ error: "Falta cancha_id" }, { status: 400 });

  const supabase = createAdminClient();
  const { data: turno } = await turnoActivo(supabase, canchaId);
  if (!turno) return NextResponse.json({ error: "Sin turno activo" }, { status: 404 });

  const { data: marcador } = await supabase
    .from("marcadores")
    .select("*")
    .eq("turno_id", turno.id)
    .single();

  return NextResponse.json({ turno_id: turno.id, marcador: marcador ?? null });
}

export async function PATCH(request: Request) {
  const { searchParams } = new URL(request.url);
  const canchaId = searchParams.get("cancha_id");
  if (!canchaId) return NextResponse.json({ error: "Falta cancha_id" }, { status: 400 });

  const body = await request.json();
  const supabase = createAdminClient();
  const { data: turno } = await turnoActivo(supabase, canchaId);
  if (!turno) return NextResponse.json({ error: "Sin turno activo" }, { status: 404 });

  const { data, error } = await supabase
    .from("marcadores")
    .upsert({ turno_id: turno.id, ...body })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, marcador: data });
}
