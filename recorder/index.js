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

// ── Generador de slots ────────────────────────────────────────────────────────

function horaASegundos(horaStr) {
  const [h, m, s] = horaStr.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function segundosAHora(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function generarSlots(horaInicio, horaFin, duracionMin) {
  const slots = [];
  let actual = horaASegundos(horaInicio);
  const fin = horaASegundos(horaFin);
  const dur = duracionMin * 60;
  while (actual + dur <= fin) {
    slots.push({ inicio: segundosAHora(actual), fin: segundosAHora(actual + dur) });
    actual += dur;
  }
  return slots;
}

async function crearTurnosDesdeHorario() {
  const hoy = new Date().toLocaleDateString("en-CA");
  const diaSemana = new Date().getDay(); // 0=domingo, 1=lunes...

  const { data: horario } = await supabase
    .from("horarios")
    .select("hora_inicio, hora_fin, duracion_min")
    .eq("cancha_id", CANCHA_ID)
    .eq("dia_semana", diaSemana)
    .single();

  if (!horario) {
    log("📅 Sin horario tipo para hoy — solo se grabarán turnos cargados manualmente");
    return;
  }

  const slots = generarSlots(horario.hora_inicio, horario.hora_fin, horario.duracion_min);

  const { data: existentes } = await supabase
    .from("turnos")
    .select("hora_inicio")
    .eq("cancha_id", CANCHA_ID)
    .eq("fecha", hoy);

  const horasExistentes = new Set((existentes ?? []).map((t) => t.hora_inicio));

  const nuevos = slots
    .filter((s) => !horasExistentes.has(s.inicio))
    .map((s) => ({
      cancha_id: CANCHA_ID,
      fecha: hoy,
      hora_inicio: s.inicio,
      hora_fin: s.fin,
    }));

  if (nuevos.length > 0) {
    await supabase.from("turnos").insert(nuevos);
    log(`📅 Creados ${nuevos.length} turno(s) automáticos desde horario tipo`);
  } else {
    log("📅 Turnos del horario tipo ya estaban cargados");
  }
}

// ── Estado ────────────────────────────────────────────────────────────────────

const grabaciones = {}; // turnoId → { proceso, filePath, startTime }
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
      ? // Modo test: cámara + micrófono del Mac
        ["-f", "avfoundation", "-framerate", "30", "-i", "0:0",
         "-c:v", "libx264", "-preset", "ultrafast",
         "-movflags", "+faststart", "-y", filePath]
      : // Modo real: cámara IP via RTSP
        ["-rtsp_transport", "tcp", "-i", RTSP_URL,
         "-c:v", "copy", "-c:a", "aac",
         "-movflags", "+faststart", "-y", filePath];

  const proc = spawn("ffmpeg", args, { stdio: "ignore" });
  grabaciones[turnoId] = { proceso: proc, filePath, startTime: Date.now() };

  proc.on("close", (code) => {
    if (code !== 0 && grabaciones[turnoId]) {
      log(`⚠️  ffmpeg terminó inesperadamente (turno ${turnoId}, código ${code})`);
    }
  });

  log(`🎥 Grabando turno ${turnoId} → ${filePath}`);
}

async function subirR2(key, filePath) {
  const buffer = fs.readFileSync(filePath);
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: "video/mp4",
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function procesarHighlights(turnoId, fullVideoPath, startTime) {
  const { data: highlights } = await supabase
    .from("highlights")
    .select("id, marcado_en")
    .eq("turno_id", turnoId)
    .is("clip_url", null);

  if (!highlights || highlights.length === 0) return;

  log(`✂️  Procesando ${highlights.length} highlight(s)…`);

  for (const h of highlights) {
    const offsetSeg = (new Date(h.marcado_en).getTime() - startTime) / 1000;
    const desde = Math.max(0, offsetSeg - 30);
    const clipPath = path.join(TMP_DIR, `highlight-${h.id}.mp4`);

    await new Promise((resolve) => {
      const proc = spawn("ffmpeg", [
        "-ss", String(desde),
        "-i", fullVideoPath,
        "-t", "35",
        "-c:v", "libx264", "-preset", "ultrafast",
        "-c:a", "aac",
        "-movflags", "+faststart",
        "-y", clipPath,
      ], { stdio: "ignore" });
      proc.on("close", resolve);
    });

    if (!fs.existsSync(clipPath)) {
      log(`⚠️  No se pudo cortar el highlight ${h.id}`);
      continue;
    }

    try {
      const clipUrl = await subirR2(`highlights/${h.id}.mp4`, clipPath);
      await supabase.from("highlights").update({ clip_url: clipUrl }).eq("id", h.id);
      fs.unlinkSync(clipPath);
      log(`🎬 Highlight ${h.id} subido`);
    } catch (err) {
      log(`❌ Error subiendo highlight ${h.id}: ${err.message}`);
    }
  }
}

async function detenerYSubir(turnoId) {
  const rec = grabaciones[turnoId];
  if (!rec) return;

  rec.proceso.kill("SIGINT");
  const { filePath, startTime } = rec;
  delete grabaciones[turnoId];

  log(`⏹  Deteniendo grabación del turno ${turnoId}…`);
  await new Promise((r) => setTimeout(r, 4000));

  if (!fs.existsSync(filePath)) {
    log(`❌ No se encontró el archivo: ${filePath}`);
    return;
  }

  // Subir video completo
  const key = `turnos/${turnoId}.mp4`;
  log(`⬆️  Subiendo video completo a R2…`);

  try {
    const videoUrl = await subirR2(key, filePath);
    await supabase.from("turnos").update({ video_url: videoUrl }).eq("id", turnoId);
    log(`✅ Turno ${turnoId} disponible: ${videoUrl}`);
  } catch (err) {
    log(`❌ Error subiendo a R2: ${err.message}`);
    fs.unlinkSync(filePath);
    return;
  }

  // Procesar highlights antes de borrar el video local
  await procesarHighlights(turnoId, filePath, startTime);

  fs.unlinkSync(filePath);
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

// Crear turnos desde horario tipo y luego programar grabaciones
crearTurnosDesdeHorario().then(programarTurnos);

// Refrescar cada hora por si el club agrega turnos nuevos
setInterval(async () => {
  await crearTurnosDesdeHorario();
  await programarTurnos();
}, 60 * 60 * 1000);
