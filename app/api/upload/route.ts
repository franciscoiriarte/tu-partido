import { PutObjectCommand } from "@aws-sdk/client-s3";
import { r2, R2_BUCKET } from "@/utils/r2";
import { createAdminClient } from "@/utils/supabase/admin";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const formData = await request.formData();
  const archivo = formData.get("archivo") as File;
  const turnoId = formData.get("turno_id") as string;

  if (!archivo || !turnoId) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const extension = archivo.name.split(".").pop() ?? "mp4";
  const key = `turnos/${turnoId}.${extension}`;
  const buffer = Buffer.from(await archivo.arrayBuffer());

  await r2.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: archivo.type || "video/mp4",
    })
  );

  const videoUrl = `${process.env.R2_ENDPOINT}/${R2_BUCKET}/${key}`;

  const supabase = createAdminClient();
  await supabase.from("turnos").update({ video_url: videoUrl }).eq("id", turnoId);

  return NextResponse.json({ ok: true, video_url: videoUrl });
}
