import { createAdminClient } from "@/utils/supabase/admin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { source_url, crop_x_pct } = await request.json();

  if (!source_url || crop_x_pct === undefined) {
    return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clip_jobs")
    .insert({ source_url, crop_x_pct })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ job_id: data.id });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job_id");
  if (!jobId) return NextResponse.json({ error: "Falta job_id" }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clip_jobs")
    .select("status, result_url")
    .eq("id", jobId)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}
