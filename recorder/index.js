require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// ── Clientes ──────────────────────────────────────────────────────────────────

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const r2 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const CANCHA_ID = process.env.CANCHA_ID;
const RTSP_URL = process.env.RTSP_URL;
const TMP_DIR = process.env.TMP_DIR || "/tmp/tu-partido";
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

// ── Estado ────────────────────────────────────────────────────────────────────

const grabaciones = {}; // turnoId → { proceso, filePath }
let timeouts = [];      // para cancelar al refrescar

// ── Utilidades de tiempo ──────────────────────────────────────────────────────

function horaAMs(horaStr) {
  // "20:00:00" → milisegundos desde medianoche
  const [h, m, s] = horaStr.split(":").map(Number);
  return (h * 3600 + m * 60 + (s || 0)) * 1000;
}

function msHastaHora(horaStr) {
  const ahora = Date.now();
  const medianoche = new Date();
  medianoche.setHours(0, 0, 0, 0);
  return medianoche.getTime() + horaAMs(horaStr) - ahora;
}

function log(msg) {
  const hora = new Date().toLocaleTimeString("es-AR");
  console.log(`[${hora}] ${msg}`);
}

// ── Grabación ─────────────────────────────────────────────────────────────────

function iniciarGrabacion(turnoId, filePath) {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const args =
    RTSP_URL === "avfoundation"
      ? // Modo test: cámara integrada del Mac
        ["-f", "avfoundation", "-framerate", "30", "-i", "0:none",
         "-c:v", "libx264", "-preset", "ultrafast", "-y", filePath]
      : // Modo real: cámara IP via RTSP
        ["-rtsp_transport", "tcp", "-i", RTSP_URL,
         "-c", "copy", "-y", filePath];

  const proc = spawn("ffmpeg", args, { stdio: "ignore" });
  grabaciones[turnoId] = { proceso: proc, filePath };

  proc.on("close", (code) => {
    if (code !== 0 && grabaciones[turnoId]) {
      log(`⚠️  ffmpeg terminó inesperadamente (turno ${turnoId}, código ${code})`);
    }
  });

  log(`🎥 Grabando turno ${turnoId} → ${filePath}`);
}

async function detenerYSubir(turnoId) {
  const rec = grabaciones[turnoId];
  if (!rec) return;

  // Detener ffmpeg limpiamente
  rec.proceso.kill("SIGINT");
  delete grabaciones[turnoId];

  log(`⏹  Deteniendo grabación del turno ${turnoId}…`);
  await new Promise((r) => setTimeout(r, 4000)); // esperar cierre del archivo

  if (!fs.existsSync(rec.filePath)) {
    log(`❌ No se encontró el archivo: ${rec.filePath}`);
    return;
  }

  // Subir a R2
  const key = `turnos/${turnoId}.mp4`;
  log(`⬆️  Subiendo a R2: ${key}`);

  try {
    const buffer = fs.readFileSync(rec.filePath);
    await r2.send(
      new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "video/mp4",
      })
    );
  } catch (err) {
    log(`❌ Error subiendo a R2: ${err.message}`);
    return;
  }

  // Actualizar Supabase
  const videoUrl = `${R2_PUBLIC_URL}/${key}`;
  await supabase.from("turnos").update({ video_url: videoUrl }).eq("id", turnoId);

  // Borrar archivo local
  fs.unlinkSync(rec.filePath);

  log(`✅ Turno ${turnoId} disponible: ${videoUrl}`);
}

// ── Scheduling ────────────────────────────────────────────────────────────────

async function getTurnosHoy() {
  const hoy = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD
  const { data, error } = await supabase
    .from("turnos")
    .select("id, hora_inicio, hora_fin")
    .eq("cancha_id", CANCHA_ID)
    .eq("fecha", hoy)
    .is("video_url", null) // omitir los que ya tienen video
    .order("hora_inicio");

  if (error) {
    log(`❌ Error leyendo turnos: ${error.message}`);
    return [];
  }
  return data ?? [];
}

async function programarTurnos() {
  // Cancelar timeouts anteriores
  timeouts.forEach(clearTimeout);
  timeouts = [];

  const turnos = await getTurnosHoy();
  log(`📋 ${turnos.length} turno(s) pendiente(s) para hoy`);

  for (const turno of turnos) {
    const msInicio = msHastaHora(turno.hora_inicio);
    const msFin = msHastaHora(turno.hora_fin);
    const filePath = path.join(TMP_DIR, `${turno.id}.mp4`);

    if (msFin <= 0) continue; // turno ya terminó

    if (msInicio > 0) {
      // Todavía falta: programar inicio
      log(`⏰ Turno ${turno.id} arranca en ${Math.round(msInicio / 60000)} min`);
      timeouts.push(setTimeout(() => iniciarGrabacion(turno.id, filePath), msInicio));
    } else {
      // Ya empezó: grabar ahora (el script se inició tarde o turno en curso)
      iniciarGrabacion(turno.id, filePath);
    }

    // Programar fin en todos los casos
    timeouts.push(setTimeout(() => detenerYSubir(turno.id), msFin));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!CANCHA_ID) {
  console.error("❌ Falta CANCHA_ID en .env");
  process.exit(1);
}
if (!RTSP_URL) {
  console.error("❌ Falta RTSP_URL en .env");
  process.exit(1);
}

log(`🚀 Recorder iniciado — Cancha: ${CANCHA_ID}`);
log(`📷 Fuente de video: ${RTSP_URL}`);

programarTurnos();
// Refrescar cada hora por si el club agrega turnos nuevos
setInterval(programarTurnos, 60 * 60 * 1000);
