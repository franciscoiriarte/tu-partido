require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
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
const ASSETS_DIR = process.env.ASSETS_DIR || path.join(__dirname, "assets");
const YOUTUBE_STREAM_KEY = process.env.YOUTUBE_STREAM_KEY || "";

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

// ── Marcador en vivo ──────────────────────────────────────────────────────────

const SCORE_FILE = path.join(TMP_DIR, "score.txt");
let pollingMarcador = null;

function formatearMarcador(m) {
  const sets = (m.sets ?? [])
    .slice(0, -1)
    .map((s) => `${s.a}-${s.b}`)
    .join("  ");
  const setActual = (m.sets ?? []).at(-1);
  const juegoActual = setActual ? `${setActual.a}-${setActual.b}` : "";
  const puntos = `${m.puntos_a ?? "0"} - ${m.puntos_b ?? "0"}`;
  const nombres = `${m.equipo_a ?? "A"}  vs  ${m.equipo_b ?? "B"}`;
  return `${nombres}    ${sets}  [${juegoActual}]  ${puntos}`;
}

async function actualizarScoreFile(turnoId) {
  try {
    const { data } = await supabase
      .from("marcadores")
      .select("*")
      .eq("turno_id", turnoId)
      .single();
    if (data) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
      fs.writeFileSync(SCORE_FILE, formatearMarcador(data));
    }
  } catch (_) {}
}

function iniciarPollingMarcador(turnoId) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(SCORE_FILE, "");
  pollingMarcador = setInterval(() => actualizarScoreFile(turnoId), 5000);
}

function detenerPollingMarcador() {
  if (pollingMarcador) {
    clearInterval(pollingMarcador);
    pollingMarcador = null;
  }
}

// ── Grabación ─────────────────────────────────────────────────────────────────

function iniciarGrabacion(turnoId, filePath) {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const ytUrl = YOUTUBE_STREAM_KEY
    ? `rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}`
    : null;

  // Overlay del marcador (solo cuando se transmite a YouTube)
  const scoreFilter = ytUrl
    ? ["-vf", `drawtext=textfile=${SCORE_FILE}:reload=1:fontcolor=white:fontsize=22:box=1:boxcolor=black@0.65:boxborderw=8:x=10:y=10`]
    : [];

  // Salida: solo archivo local, o archivo + YouTube en paralelo con tee
  const output = ytUrl
    ? ["-f", "tee", `[f=mp4:movflags=+faststart]${filePath}|[f=flv]${ytUrl}`]
    : ["-movflags", "+faststart", "-y", filePath];

  const args =
    RTSP_URL === "avfoundation"
      ? // Modo test: cámara + micrófono del Mac
        ["-f", "avfoundation", "-framerate", "30", "-video_size", "1280x720", "-i", "0:0",
         "-c:v", "libx264", "-preset", "veryfast", "-maxrate", "3000k", "-bufsize", "6000k",
         "-pix_fmt", "yuv420p", "-g", "60",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
         ...scoreFilter, ...output]
      : // Modo real: cámara IP via RTSP
        ["-rtsp_transport", "tcp", "-i", RTSP_URL,
         "-c:v", "libx264", "-preset", "veryfast", "-maxrate", "3000k", "-bufsize", "6000k",
         "-pix_fmt", "yuv420p", "-g", "60",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
         ...scoreFilter, ...output];

  iniciarPollingMarcador(turnoId);

  const proc = spawn("ffmpeg", args, { stdio: "ignore" });
  grabaciones[turnoId] = { proceso: proc, filePath, startTime: Date.now() };

  proc.on("close", (code) => {
    if (code !== 0 && grabaciones[turnoId]) {
      log(`⚠️  ffmpeg terminó inesperadamente (turno ${turnoId}, código ${code})`);
    }
  });

  if (ytUrl) {
    log(`🎥 Grabando turno ${turnoId} + transmitiendo en vivo a YouTube`);
  } else {
    log(`🎥 Grabando turno ${turnoId} → ${filePath}`);
  }
}

async function subirR2(key, filePath) {
  const fileStream = fs.createReadStream(filePath);
  const fileSizeMB = Math.round(fs.statSync(filePath).size / 1024 / 1024);
  log(`⬆️  Subiendo ${key} (${fileSizeMB} MB)…`);

  const upload = new Upload({
    client: r2,
    params: {
      Bucket: R2_BUCKET,
      Key: key,
      Body: fileStream,
      ContentType: "video/mp4",
    },
  });

  await upload.done();
  return `${R2_PUBLIC_URL}/${key}`;
}

// ── Branding (intro, zócalo, outro) ──────────────────────────────────────────

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: "ignore" });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg salió con código ${code}`));
      else resolve();
    });
  });
}

async function aplicarZocalo(inputPath, outputPath) {
  const zocaloPath = path.join(ASSETS_DIR, "zocalo.png");
  if (!fs.existsSync(zocaloPath)) {
    fs.renameSync(inputPath, outputPath);
    return;
  }
  log("🎨 Aplicando zócalo…");
  await ffmpegRun([
    "-i", inputPath,
    "-i", zocaloPath,
    "-filter_complex", "[0:v][1:v]overlay=x=0:y=H-h[v]",
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-crf", "26", "-preset", "fast",
    "-c:a", "aac", "-movflags", "+faststart",
    "-y", outputPath,
  ]);
  fs.unlinkSync(inputPath);
}

async function agregarIntroOutro(inputPath, outputPath) {
  const introPath = path.join(ASSETS_DIR, "intro.mp4");
  const outroPath = path.join(ASSETS_DIR, "outro.mp4");
  const hasIntro = fs.existsSync(introPath);
  const hasOutro = fs.existsSync(outroPath);

  if (!hasIntro && !hasOutro) {
    fs.renameSync(inputPath, outputPath);
    return;
  }

  log("🎬 Agregando intro/outro…");
  const listPath = inputPath.replace(".mp4", "_list.txt");
  const lines = [];
  if (hasIntro) lines.push(`file '${introPath}'`);
  lines.push(`file '${inputPath}'`);
  if (hasOutro) lines.push(`file '${outroPath}'`);
  fs.writeFileSync(listPath, lines.join("\n"));

  await ffmpegRun([
    "-f", "concat", "-safe", "0",
    "-i", listPath,
    "-c:v", "libx264", "-crf", "26", "-preset", "fast",
    "-c:a", "aac", "-movflags", "+faststart",
    "-y", outputPath,
  ]);

  fs.unlinkSync(inputPath);
  fs.unlinkSync(listPath);
}

async function procesarBranding(rawPath) {
  const zocaloPath = path.join(ASSETS_DIR, "zocalo.png");
  const introPath = path.join(ASSETS_DIR, "intro.mp4");
  const outroPath = path.join(ASSETS_DIR, "outro.mp4");

  const sinBranding =
    !fs.existsSync(zocaloPath) &&
    !fs.existsSync(introPath) &&
    !fs.existsSync(outroPath);

  if (sinBranding) return rawPath;

  const brandedPath = rawPath.replace(".mp4", "_final.mp4");
  const tempPath = rawPath.replace(".mp4", "_zocalo.mp4");

  await aplicarZocalo(rawPath, tempPath);
  await agregarIntroOutro(tempPath, brandedPath);

  return brandedPath;
}

// ── Highlights ────────────────────────────────────────────────────────────────

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
    const clipRaw = path.join(TMP_DIR, `highlight-${h.id}-raw.mp4`);

    await ffmpegRun([
      "-ss", String(desde),
      "-i", fullVideoPath,
      "-t", "35",
      "-c:v", "libx264", "-crf", "26", "-preset", "fast",
      "-c:a", "aac",
      "-movflags", "+faststart",
      "-y", clipRaw,
    ]);

    if (!fs.existsSync(clipRaw)) {
      log(`⚠️  No se pudo cortar el highlight ${h.id}`);
      continue;
    }

    try {
      const clipPath = await procesarBranding(clipRaw);
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
  detenerPollingMarcador();
  const { filePath, startTime } = rec;
  delete grabaciones[turnoId];

  log(`⏹  Deteniendo grabación del turno ${turnoId}…`);
  await new Promise((r) => setTimeout(r, 4000));

  if (!fs.existsSync(filePath)) {
    log(`❌ No se encontró el archivo: ${filePath}`);
    return;
  }

  const zocaloPath = filePath.replace(".mp4", "_zocalo.mp4");
  const finalPath = filePath.replace(".mp4", "_final.mp4");

  try {
    // Aplicar zócalo al video crudo — los highlights se cortan de este video
    // para que los timestamps sean correctos (sin el desplazamiento del intro)
    await aplicarZocalo(filePath, zocaloPath);

    // Cortar highlights del video con zócalo pero sin intro/outro
    await procesarHighlights(turnoId, zocaloPath, startTime);

    // Agregar intro/outro al video completo y subir
    await agregarIntroOutro(zocaloPath, finalPath);

    const key = `turnos/${turnoId}.mp4`;
    const videoUrl = await subirR2(key, finalPath);
    await supabase.from("turnos").update({ video_url: videoUrl }).eq("id", turnoId);
    log(`✅ Turno ${turnoId} disponible: ${videoUrl}`);

    fs.unlinkSync(finalPath);
  } catch (err) {
    log(`❌ Error procesando turno ${turnoId}: ${err.message}`);
    for (const tmp of [filePath, zocaloPath, finalPath]) {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
  }
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
log(`🎨 Assets: ${ASSETS_DIR}`);

// Crear turnos desde horario tipo y luego programar grabaciones
crearTurnosDesdeHorario().then(programarTurnos);

// Refrescar cada hora por si el club agrega turnos nuevos
setInterval(async () => {
  await crearTurnosDesdeHorario();
  await programarTurnos();
}, 60 * 60 * 1000);
