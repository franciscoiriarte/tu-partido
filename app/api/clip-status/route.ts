import { createClient } from "@/utils/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) return Response.json({ error: "Falta id" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clip_requests")
    .select("id, status, video_url, error_msg")
    .eq("id", id)
    .single();

  if (error || !data) return Response.json({ error: "No encontrado" }, { status: 404 });

  return Response.json(data);
}
