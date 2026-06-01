require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const TMP = "/tmp/reencode";
fs.mkdirSync(TMP, { recursive: true });

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString("es-AR")}] ${msg}`);
}

function getLevel(filePath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=level",
      "-of", "csv=p=0", filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(parseInt(out.trim()) || 0));
  });
}

function reencode(inputUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", inputUrl,
      "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
      "-pix_fmt", "yuv420p",
      "-crf", "26", "-preset", "fast",
      "-c:a", "aac", "-ar", "44100", "-ac", "2",
      "-movflags", "+faststart",
      "-y", outputPath,
    ], { stdio: ["ignore", "ignore", "inherit"] });
    proc.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg salió con código ${code}`)));
  });
}

async function uploadR2(key, filePath) {
  const body = fs.readFileSync(filePath);
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: body,
    ContentType: "video/mp4",
  }));
}

async function main() {
  // Turnos
  const { data: turnos } = await supabase
    .from("turnos").select("id, video_url").not("video_url", "is", null);

  // Highlights
  const { data: highlights } = await supabase
    .from("highlights").select("id, clip_url").not("clip_url", "is", null);

  const items = [
    ...(turnos ?? []).map((t) => ({ key: `turnos/${t.id}.mp4`, url: t.video_url })),
    ...(highlights ?? []).map((h) => ({ key: `highlights/${h.id}.mp4`, url: h.clip_url })),
  ];

  log(`📋 ${items.length} videos a procesar (${(turnos ?? []).length} turnos + ${(highlights ?? []).length} highlights)`);

  let ok = 0, skip = 0, err = 0;

  for (const [i, item] of items.entries()) {
    const tmpPath = path.join(TMP, `tmp_${i}.mp4`);
    try {
      // Chequear si ya tiene level correcto
      const level = await getLevel(item.url);
      if (level > 0 && level <= 41) {
        log(`⏭  [${i + 1}/${items.length}] ${item.key} — ya OK (level ${level})`);
        skip++;
        continue;
      }
      log(`🔄 [${i + 1}/${items.length}] ${item.key} (level ${level} → 41)…`);
      await reencode(item.url, tmpPath);
      await uploadR2(item.key, tmpPath);
      log(`✅ [${i + 1}/${items.length}] ${item.key} — subido`);
      ok++;
    } catch (e) {
      log(`❌ [${i + 1}/${items.length}] ${item.key}: ${e.message}`);
      err++;
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  log(`\n🏁 Listo: ${ok} re-encodeados, ${skip} ya estaban OK, ${err} errores`);
}

main().catch(console.error);
