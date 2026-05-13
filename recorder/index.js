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
let streamProcess = null; // proceso ffmpeg para stream manual en vivo

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

  const args =
    RTSP_URL === "avfoundation"
      ? ["-f", "avfoundation", "-framerate", "30", "-video_size", "1280x720", "-i", "0:0",
         "-c:v", "libx264", "-preset", "veryfast", "-maxrate", "3000k", "-bufsize", "6000k",
         "-pix_fmt", "yuv420p", "-g", "60",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
         "-movflags", "+faststart", "-y", filePath]
      : ["-rtsp_transport", "tcp", "-i", RTSP_URL,
         "-c:v", "libx264", "-preset", "veryfast", "-maxrate", "3000k", "-bufsize", "6000k",
         "-pix_fmt", "yuv420p", "-g", "60",
         "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
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

// ── Stream manual en vivo ─────────────────────────────────────────────────────

async function setStreamActivo(valor) {
  await supabase.from("canchas").update({ stream_activo: valor }).eq("id", CANCHA_ID);
}

function iniciarStream() {
  if (streamProcess) return;
  if (!YOUTUBE_STREAM_KEY) {
    log("⚠️  Sin YOUTUBE_STREAM_KEY — no se puede iniciar stream");
    return;
  }

  const ytUrl = `rtmp://a.rtmp.youtube.com/live2/${YOUTUBE_STREAM_KEY}`;

  const videoArgs = [
    "-c:v", "libx264", "-preset", "veryfast", "-b:v", "3000k",
    "-maxrate", "3000k", "-bufsize", "6000k",
    "-pix_fmt", "yuv420p", "-g", "60", "-tune", "zerolatency",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-f", "flv", ytUrl,
  ];

  const args =
    RTSP_URL === "avfoundation"
      ? ["-f", "avfoundation", "-framerate", "30", "-video_size", "1280x720", "-i", "0:0", ...videoArgs]
      : ["-rtsp_transport", "tcp", "-i", RTSP_URL, ...videoArgs];

  streamProcess = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

  // Loguear stderr de ffmpeg en tiempo real para diagnóstico
  streamProcess.stderr.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      // Solo loguear líneas relevantes (errores, conexión, frames)
      if (/error|fail|unable|refused|invalid|frame=|fps=|Connection/i.test(line)) {
        log(`[ffmpeg] ${line.trim()}`);
      }
    }
  });

  // Si ffmpeg sigue vivo a los 10 segundos, consideramos que conectó
  const confirmTimer = setTimeout(() => {
    if (streamProcess) {
      setStreamActivo(true);
      log("✅ Stream confirmado → YouTube en vivo");
    }
  }, 10000);

  streamProcess.on("close", (code) => {
    clearTimeout(confirmTimer);
    setStreamActivo(false);
    streamProcess = null;
    if (code !== 0) {
      log(`⚠️  Stream YouTube terminó con error (código ${code}) — revisá los logs de ffmpeg arriba`);
    }
  });

  log("🔴 Conectando a YouTube...");
}

function detenerStream() {
  if (!streamProcess) return;
  streamProcess.kill("SIGTERM");
  streamProcess = null;
  setStreamActivo(false);
  log("⏹️  Stream YouTube detenido");
}

async function verificarStream() {
  if (!YOUTUBE_STREAM_KEY) return;

  const { data: cancha } = await supabase
    .from("canchas")
    .select("transmitiendo")
    .eq("id", CANCHA_ID)
    .single();

  if (!cancha) return;

  if (cancha.transmitiendo && !streamProcess) {
    iniciarStream();
  } else if (!cancha.transmitiendo && streamProcess) {
    detenerStream();
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

async function tieneAudio(filePath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0", filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", () => resolve(out.trim().length > 0));
  });
}

async function normalizarAsset(srcPath) {
  const normPath = srcPath.replace(".mp4", "_norm.mp4");

  // Reutilizar si el archivo normalizado es más nuevo que el original
  if (fs.existsSync(normPath)) {
    if (fs.statSync(normPath).mtimeMs > fs.statSync(srcPath).mtimeMs) return normPath;
  }

  log(`🔧 Normalizando ${path.basename(srcPath)}…`);
  const conAudio = await tieneAudio(srcPath);

  const args = conAudio
    ? ["-i", srcPath,
       "-c:v", "libx264", "-crf", "26", "-preset", "fast",
       "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30",
       "-c:a", "aac", "-ar", "44100", "-ac", "2",
       "-map", "0:v", "-map", "0:a",
       "-movflags", "+faststart", "-y", normPath]
    : ["-i", srcPath,
       "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
       "-c:v", "libx264", "-crf", "26", "-preset", "fast",
       "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30",
       "-c:a", "aac", "-ar", "44100", "-ac", "2",
       "-map", "0:v", "-map", "1:a",
       "-shortest", "-movflags", "+faststart", "-y", normPath];

  await ffmpegRun(args);
  return normPath;
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

  // Normalizar antes de concatenar para garantizar formato compatible
  const introNorm = hasIntro ? await normalizarAsset(introPath) : null;
  const outroNorm = hasOutro ? await normalizarAsset(outroPath) : null;

  const listPath = inputPath.replace(".mp4", "_list.txt");
  const lines = [];
  if (introNorm) lines.push(`file '${introNorm}'`);
  lines.push(`file '${inputPath}'`);
  if (outroNorm) lines.push(`file '${outroNorm}'`);
  fs.writeFileSync(listPath, lines.join("\n"));

  await ffmpegRun([
    "-f", "concat", "-safe", "0",
    "-i", listPath,
    "-c:v", "libx264", "-crf", "26", "-preset", "fast",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart",
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

// ── Clip jobs (editor vertical) ───────────────────────────────────────────────

async function procesarClipJobs() {
  const { data: jobs } = await supabase
    .from("clip_jobs")
    .select("id, source_url, crop_x_pct")
    .eq("status", "pending")
    .order("created_at")
    .limit(1);

  if (!jobs || jobs.length === 0) return;

  const job = jobs[0];
  await supabase.from("clip_jobs").update({ status: "processing" }).eq("id", job.id);
  log(`✂️  Procesando clip vertical ${job.id}…`);

  const tmpInput = path.join(TMP_DIR, `clipjob-${job.id}-in.mp4`);
  const tmpOutput = path.join(TMP_DIR, `clipjob-${job.id}-out.mp4`);

  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });

    // Descargar video fuente
    const res = await fetch(job.source_url);
    const buffer = await res.arrayBuffer();
    fs.writeFileSync(tmpInput, Buffer.from(buffer));

    // Recortar y escalar a vertical 9:16
    await ffmpegRun([
      "-i", tmpInput,
      "-vf", `crop=ih*9/16:ih:iw*${job.crop_x_pct}:0,scale=1080:1920`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "26",
      "-c:a", "aac", "-movflags", "+faststart",
      "-y", tmpOutput,
    ]);

    const resultUrl = await subirR2(`clips/${job.id}.mp4`, tmpOutput);

    await supabase.from("clip_jobs").update({ status: "done", result_url: resultUrl }).eq("id", job.id);
    log(`✅ Clip vertical listo: ${resultUrl}`);
  } catch (err) {
    await supabase.from("clip_jobs").update({ status: "error" }).eq("id", job.id);
    log(`❌ Error en clip job ${job.id}: ${err.message}`);
  } finally {
    if (fs.existsSync(tmpInput)) fs.unlinkSync(tmpInput);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
  }
}

// Crear turnos desde horario tipo y luego programar grabaciones
crearTurnosDesdeHorario().then(programarTurnos);

// Refrescar cada hora por si el club agrega turnos nuevos
setInterval(async () => {
  await crearTurnosDesdeHorario();
  await programarTurnos();
}, 60 * 60 * 1000);

// Procesar clip jobs cada 10 segundos
setInterval(procesarClipJobs, 10 * 1000);

// Verificar stream manual cada 30 segundos
verificarStream();
setInterval(verificarStream, 30 * 1000);
