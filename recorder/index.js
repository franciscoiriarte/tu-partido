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

const COMPLEJO_ID = process.env.COMPLEJO_ID;
const TMP_DIR = process.env.TMP_DIR || "/tmp/tu-partido";
const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;
const ASSETS_DIR = process.env.ASSETS_DIR || path.join(__dirname, "assets");

// ── Estado ────────────────────────────────────────────────────────────────────

let canchas = []; // cargadas desde Supabase al iniciar
const grabaciones = {}; // turnoId → { proceso, filePath, startTime }
const streamProcesses = {}; // canchaId → { proceso, confirmTimer }
let timeouts = [];

// ── Utilidades ────────────────────────────────────────────────────────────────

function log(msg) {
  const hora = new Date().toLocaleTimeString("es-AR");
  console.log(`[${hora}] ${msg}`);
}

function horaASegundos(horaStr) {
  const [h, m, s] = horaStr.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function segundosAHora(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}

function horaAMs(horaStr) {
  const [h, m, s] = horaStr.split(":").map(Number);
  return (h * 3600 + m * 60 + (s || 0)) * 1000;
}

function msHastaHora(horaStr) {
  const ahora = Date.now();
  const medianoche = new Date();
  medianoche.setHours(0, 0, 0, 0);
  return medianoche.getTime() + horaAMs(horaStr) - ahora;
}

function ffmpegArgs(rtspUrl, output) {
  const encode = [
    "-c:v", "libx264", "-preset", "veryfast", "-maxrate", "1500k", "-bufsize", "3000k",
    "-pix_fmt", "yuv420p", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    ...output,
  ];
  return rtspUrl === "avfoundation"
    ? ["-f", "avfoundation", "-framerate", "30", "-video_size", "1280x720", "-i", "0:0", ...encode]
    : ["-rtsp_transport", "tcp", "-i", rtspUrl, ...encode];
}

// ── Cargar canchas ────────────────────────────────────────────────────────────

async function cargarCanchas() {
  const { data, error } = await supabase
    .from("canchas")
    .select("id, nombre, rtsp_url, youtube_stream_key")
    .eq("complejo_id", COMPLEJO_ID);

  if (error) {
    log(`❌ Error cargando canchas: ${error.message}`);
    return;
  }
  canchas = data ?? [];
  log(`🏟️  ${canchas.length} cancha(s) cargadas: ${canchas.map((c) => c.nombre).join(", ")}`);
}

// ── Generador de turnos desde horario tipo ────────────────────────────────────

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
  const diaSemana = new Date().getDay();

  for (const cancha of canchas) {
    const { data: horario } = await supabase
      .from("horarios")
      .select("hora_inicio, hora_fin, duracion_min")
      .eq("cancha_id", cancha.id)
      .eq("dia_semana", diaSemana)
      .single();

    if (!horario) continue;

    const slots = generarSlots(horario.hora_inicio, horario.hora_fin, horario.duracion_min);

    const { data: existentes } = await supabase
      .from("turnos")
      .select("hora_inicio")
      .eq("cancha_id", cancha.id)
      .eq("fecha", hoy);

    const horasExistentes = new Set((existentes ?? []).map((t) => t.hora_inicio));
    const nuevos = slots
      .filter((s) => !horasExistentes.has(s.inicio))
      .map((s) => ({ cancha_id: cancha.id, fecha: hoy, hora_inicio: s.inicio, hora_fin: s.fin }));

    if (nuevos.length > 0) {
      await supabase.from("turnos").insert(nuevos);
      log(`📅 [${cancha.nombre}] Creados ${nuevos.length} turno(s) automáticos`);
    }
  }
}

// ── Marcador ──────────────────────────────────────────────────────────────────

const SCORE_FILE = path.join(TMP_DIR, "score.txt");
let pollingMarcador = null;

function formatearMarcador(m) {
  const sets = (m.sets ?? []).slice(0, -1).map((s) => `${s.a}-${s.b}`).join("  ");
  const setActual = (m.sets ?? []).at(-1);
  const juegoActual = setActual ? `${setActual.a}-${setActual.b}` : "";
  const puntos = `${m.puntos_a ?? "0"} - ${m.puntos_b ?? "0"}`;
  const nombres = `${m.equipo_a ?? "A"}  vs  ${m.equipo_b ?? "B"}`;
  return `${nombres}    ${sets}  [${juegoActual}]  ${puntos}`;
}

async function actualizarScoreFile(turnoId) {
  try {
    const { data } = await supabase.from("marcadores").select("*").eq("turno_id", turnoId).single();
    if (data) {
      fs.mkdirSync(TMP_DIR, { recursive: true });
      fs.writeFileSync(SCORE_FILE, formatearMarcador(data));
    }
  } catch (_) {}
}

function detenerPollingMarcador() {
  if (pollingMarcador) { clearInterval(pollingMarcador); pollingMarcador = null; }
}

// ── Grabación ─────────────────────────────────────────────────────────────────

function iniciarGrabacion(turnoId, filePath, rtspUrl) {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const args = ffmpegArgs(rtspUrl, ["-movflags", "+faststart", "-y", filePath]);
  const proc = spawn("ffmpeg", args, { stdio: "ignore" });
  grabaciones[turnoId] = { proceso: proc, filePath, startTime: Date.now() };

  proc.on("close", (code) => {
    if (code !== 0 && grabaciones[turnoId]) {
      log(`⚠️  ffmpeg terminó inesperadamente (turno ${turnoId}, código ${code})`);
    }
  });

  log(`🎥 Grabando turno ${turnoId}`);
}

// ── Stream manual en vivo ─────────────────────────────────────────────────────

async function setStreamActivo(canchaId, valor) {
  await supabase.from("canchas").update({ stream_activo: valor }).eq("id", canchaId);
}

function iniciarStream(cancha) {
  if (streamProcesses[cancha.id]) return;
  if (!cancha.youtube_stream_key) {
    log(`⚠️  [${cancha.nombre}] Sin youtube_stream_key — configuralo en Supabase`);
    return;
  }

  const ytUrl = `rtmp://a.rtmp.youtube.com/live2/${cancha.youtube_stream_key}`;
  const rtspUrl = cancha.rtsp_url || "avfoundation";

  const args = ffmpegArgs(rtspUrl, [
    "-b:v", "1500k", "-tune", "zerolatency", "-f", "flv", ytUrl,
  ]);

  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

  proc.stderr.on("data", (chunk) => {
    const lines = chunk.toString().split("\n").filter((l) => l.trim());
    for (const line of lines) {
      if (/error|fail|unable|refused|invalid|frame=|fps=|Connection/i.test(line)) {
        log(`[ffmpeg:${cancha.nombre}] ${line.trim()}`);
      }
    }
  });

  const confirmTimer = setTimeout(() => {
    if (streamProcesses[cancha.id]) {
      setStreamActivo(cancha.id, true);
      log(`✅ Stream confirmado → YouTube [${cancha.nombre}]`);
    }
  }, 10000);

  proc.on("close", (code) => {
    clearTimeout(confirmTimer);
    setStreamActivo(cancha.id, false);
    delete streamProcesses[cancha.id];
    if (code !== 0 && code !== 255) {
      log(`⚠️  Stream [${cancha.nombre}] terminó con error (código ${code})`);
    }
  });

  streamProcesses[cancha.id] = { proceso: proc, confirmTimer };
  log(`🔴 Conectando a YouTube... [${cancha.nombre}]`);
}

function detenerStream(cancha) {
  const entry = streamProcesses[cancha.id];
  if (!entry) return;
  clearTimeout(entry.confirmTimer);
  entry.proceso.kill("SIGTERM");
  delete streamProcesses[cancha.id];
  setStreamActivo(cancha.id, false);
  log(`⏹️  Stream detenido [${cancha.nombre}]`);
}

async function verificarStreams() {
  if (canchas.length === 0) return;

  const ids = canchas.map((c) => c.id);
  const { data } = await supabase
    .from("canchas")
    .select("id, nombre, rtsp_url, youtube_stream_key, transmitiendo")
    .in("id", ids);

  if (!data) return;

  // Actualizar cache local con datos frescos
  canchas = canchas.map((c) => ({ ...c, ...(data.find((d) => d.id === c.id) ?? {}) }));

  for (const cancha of canchas) {
    if (cancha.transmitiendo && !streamProcesses[cancha.id]) {
      iniciarStream(cancha);
    } else if (!cancha.transmitiendo && streamProcesses[cancha.id]) {
      detenerStream(cancha);
    }
  }
}

// ── Subida R2 ─────────────────────────────────────────────────────────────────

async function subirR2(key, filePath) {
  const fileStream = fs.createReadStream(filePath);
  const fileSizeMB = Math.round(fs.statSync(filePath).size / 1024 / 1024);
  log(`⬆️  Subiendo ${key} (${fileSizeMB} MB)…`);
  const upload = new Upload({
    client: r2,
    params: { Bucket: R2_BUCKET, Key: key, Body: fileStream, ContentType: "video/mp4" },
  });
  await upload.done();
  return `${R2_PUBLIC_URL}/${key}`;
}

// ── Branding ──────────────────────────────────────────────────────────────────

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
  if (!fs.existsSync(zocaloPath)) { fs.renameSync(inputPath, outputPath); return; }
  log("🎨 Aplicando zócalo…");
  await ffmpegRun([
    "-i", inputPath, "-i", zocaloPath,
    "-filter_complex", "[0:v][1:v]overlay=x=0:y=H-h[v]",
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-crf", "26", "-preset", "fast",
    "-c:a", "aac", "-movflags", "+faststart", "-y", outputPath,
  ]);
  fs.unlinkSync(inputPath);
}

async function tieneAudio(filePath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-select_streams", "a",
      "-show_entries", "stream=codec_type", "-of", "csv=p=0", filePath,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.on("close", () => resolve(out.trim().length > 0));
  });
}

async function normalizarAsset(srcPath) {
  const normPath = srcPath.replace(".mp4", "_norm.mp4");
  if (fs.existsSync(normPath) && fs.statSync(normPath).mtimeMs > fs.statSync(srcPath).mtimeMs) return normPath;
  log(`🔧 Normalizando ${path.basename(srcPath)}…`);
  const conAudio = await tieneAudio(srcPath);
  const args = conAudio
    ? ["-i", srcPath, "-c:v", "libx264", "-crf", "26", "-preset", "fast",
       "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30",
       "-c:a", "aac", "-ar", "44100", "-ac", "2",
       "-map", "0:v", "-map", "0:a", "-movflags", "+faststart", "-y", normPath]
    : ["-i", srcPath, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
       "-c:v", "libx264", "-crf", "26", "-preset", "fast",
       "-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30",
       "-c:a", "aac", "-ar", "44100", "-ac", "2",
       "-map", "0:v", "-map", "1:a", "-shortest", "-movflags", "+faststart", "-y", normPath];
  await ffmpegRun(args);
  return normPath;
}

async function agregarIntroOutro(inputPath, outputPath) {
  const introPath = path.join(ASSETS_DIR, "intro.mp4");
  const outroPath = path.join(ASSETS_DIR, "outro.mp4");
  const hasIntro = fs.existsSync(introPath);
  const hasOutro = fs.existsSync(outroPath);
  if (!hasIntro && !hasOutro) { fs.renameSync(inputPath, outputPath); return; }
  log("🎬 Agregando intro/outro…");
  const introNorm = hasIntro ? await normalizarAsset(introPath) : null;
  const outroNorm = hasOutro ? await normalizarAsset(outroPath) : null;
  const listPath = inputPath.replace(".mp4", "_list.txt");
  const lines = [];
  if (introNorm) lines.push(`file '${introNorm}'`);
  lines.push(`file '${inputPath}'`);
  if (outroNorm) lines.push(`file '${outroNorm}'`);
  fs.writeFileSync(listPath, lines.join("\n"));
  await ffmpegRun([
    "-f", "concat", "-safe", "0", "-i", listPath,
    "-c:v", "libx264", "-crf", "26", "-preset", "fast",
    "-c:a", "aac", "-ar", "44100", "-ac", "2",
    "-movflags", "+faststart", "-y", outputPath,
  ]);
  fs.unlinkSync(inputPath);
  fs.unlinkSync(listPath);
}

// ── Highlights ────────────────────────────────────────────────────────────────

async function procesarHighlights(turnoId, fullVideoPath, startTime) {
  const { data: highlights } = await supabase
    .from("highlights").select("id, marcado_en")
    .eq("turno_id", turnoId).is("clip_url", null);
  if (!highlights || highlights.length === 0) return;
  log(`✂️  Procesando ${highlights.length} highlight(s)…`);
  for (const h of highlights) {
    const offsetSeg = (new Date(h.marcado_en).getTime() - startTime) / 1000;
    const desde = Math.max(0, offsetSeg - 30);
    const clipRaw = path.join(TMP_DIR, `highlight-${h.id}-raw.mp4`);
    await ffmpegRun([
      "-ss", String(desde), "-i", fullVideoPath, "-t", "35",
      "-c:v", "libx264", "-crf", "26", "-preset", "fast",
      "-c:a", "aac", "-movflags", "+faststart", "-y", clipRaw,
    ]);
    if (!fs.existsSync(clipRaw)) { log(`⚠️  No se pudo cortar el highlight ${h.id}`); continue; }
    try {
      const brandedPath = await procesarBranding(clipRaw);
      const clipUrl = await subirR2(`highlights/${h.id}.mp4`, brandedPath);
      await supabase.from("highlights").update({ clip_url: clipUrl }).eq("id", h.id);
      fs.unlinkSync(brandedPath);
      log(`🎬 Highlight ${h.id} subido`);
    } catch (err) {
      log(`❌ Error subiendo highlight ${h.id}: ${err.message}`);
    }
  }
}

async function procesarBranding(rawPath) {
  const zocaloPath = path.join(ASSETS_DIR, "zocalo.png");
  const introPath = path.join(ASSETS_DIR, "intro.mp4");
  const outroPath = path.join(ASSETS_DIR, "outro.mp4");
  if (!fs.existsSync(zocaloPath) && !fs.existsSync(introPath) && !fs.existsSync(outroPath)) return rawPath;
  const tempPath = rawPath.replace(".mp4", "_zocalo.mp4");
  const brandedPath = rawPath.replace(".mp4", "_final.mp4");
  await aplicarZocalo(rawPath, tempPath);
  await agregarIntroOutro(tempPath, brandedPath);
  return brandedPath;
}

// ── Post-procesado de turno ───────────────────────────────────────────────────

async function detenerYSubir(turnoId) {
  const rec = grabaciones[turnoId];
  if (!rec) return;
  rec.proceso.kill("SIGINT");
  detenerPollingMarcador();
  const { filePath, startTime } = rec;
  delete grabaciones[turnoId];
  log(`⏹  Deteniendo grabación del turno ${turnoId}…`);
  await new Promise((r) => setTimeout(r, 4000));
  if (!fs.existsSync(filePath)) { log(`❌ No se encontró el archivo: ${filePath}`); return; }
  const zocaloPath = filePath.replace(".mp4", "_zocalo.mp4");
  const finalPath = filePath.replace(".mp4", "_final.mp4");
  try {
    await aplicarZocalo(filePath, zocaloPath);
    await procesarHighlights(turnoId, zocaloPath, startTime);
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
  const hoy = new Date().toLocaleDateString("en-CA");
  const ids = canchas.map((c) => c.id);
  if (ids.length === 0) return [];
  const { data, error } = await supabase
    .from("turnos")
    .select("id, hora_inicio, hora_fin, cancha_id")
    .in("cancha_id", ids)
    .eq("fecha", hoy)
    .is("video_url", null)
    .order("hora_inicio");
  if (error) { log(`❌ Error leyendo turnos: ${error.message}`); return []; }
  return data ?? [];
}

async function programarTurnos() {
  timeouts.forEach(clearTimeout);
  timeouts = [];
  const turnos = await getTurnosHoy();
  log(`📋 ${turnos.length} turno(s) pendiente(s) para hoy`);
  for (const turno of turnos) {
    const cancha = canchas.find((c) => c.id === turno.cancha_id);
    const rtspUrl = cancha?.rtsp_url || "avfoundation";
    const msInicio = msHastaHora(turno.hora_inicio);
    const msFin = msHastaHora(turno.hora_fin);
    const filePath = path.join(TMP_DIR, `${turno.id}.mp4`);
    if (msFin <= 0) continue;
    if (msInicio > 0) {
      log(`⏰ Turno ${turno.id} arranca en ${Math.round(msInicio / 60000)} min`);
      timeouts.push(setTimeout(() => iniciarGrabacion(turno.id, filePath, rtspUrl), msInicio));
    } else {
      iniciarGrabacion(turno.id, filePath, rtspUrl);
    }
    timeouts.push(setTimeout(() => detenerYSubir(turno.id), msFin));
  }
}

// ── Clip jobs ─────────────────────────────────────────────────────────────────

async function procesarClipJobs() {
  const { data: jobs } = await supabase
    .from("clip_jobs").select("id, source_url, crop_x_pct")
    .eq("status", "pending").order("created_at").limit(1);
  if (!jobs || jobs.length === 0) return;
  const job = jobs[0];
  await supabase.from("clip_jobs").update({ status: "processing" }).eq("id", job.id);
  log(`✂️  Procesando clip vertical ${job.id}…`);
  const tmpInput = path.join(TMP_DIR, `clipjob-${job.id}-in.mp4`);
  const tmpOutput = path.join(TMP_DIR, `clipjob-${job.id}-out.mp4`);
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const res = await fetch(job.source_url);
    fs.writeFileSync(tmpInput, Buffer.from(await res.arrayBuffer()));
    await ffmpegRun([
      "-i", tmpInput,
      "-vf", `crop=ih*9/16:ih:iw*${job.crop_x_pct}:0,scale=1080:1920`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "26",
      "-c:a", "aac", "-movflags", "+faststart", "-y", tmpOutput,
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

// ── Main ──────────────────────────────────────────────────────────────────────

if (!COMPLEJO_ID) {
  console.error("❌ Falta COMPLEJO_ID en .env");
  process.exit(1);
}

log(`🚀 Recorder iniciado — Complejo: ${COMPLEJO_ID}`);
log(`🎨 Assets: ${ASSETS_DIR}`);

cargarCanchas().then(async () => {
  await crearTurnosDesdeHorario();
  await programarTurnos();
  verificarStreams();
});

setInterval(async () => {
  await crearTurnosDesdeHorario();
  await programarTurnos();
}, 60 * 60 * 1000);

setInterval(procesarClipJobs, 10 * 1000);
setInterval(verificarStreams, 30 * 1000);
