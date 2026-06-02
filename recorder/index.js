require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

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

const COMPLEJO_ID    = process.env.COMPLEJO_ID;
const TMP_DIR        = process.env.TMP_DIR        || "/tmp/tu-partido";
const RECORDINGS_DIR = process.env.RECORDINGS_DIR || path.join(os.homedir(), "tu-partido-recordings");
const R2_BUCKET      = process.env.R2_BUCKET;
const R2_PUBLIC_URL  = process.env.R2_PUBLIC_URL;
const ASSETS_DIR     = process.env.ASSETS_DIR     || path.join(__dirname, "assets");

// ── Estado ────────────────────────────────────────────────────────────────────

let canchas = [];
const grabacionesContinuas = {}; // canchaId → ffmpeg process
const streamProcesses      = {}; // canchaId → { proceso, confirmTimer }

// ── Utilidades ────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toLocaleTimeString("es-AR")}] ${msg}`);
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

function ffmpegRun(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });
    proc.on("close", (code) => {
      if (code !== 0) reject(new Error(`ffmpeg salió con código ${code}`));
      else resolve();
    });
  });
}

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

async function aplicarZocalo(inputPath, outputPath) {
  const zocaloPath = path.join(ASSETS_DIR, "zocalo.png");
  if (!fs.existsSync(zocaloPath)) { fs.renameSync(inputPath, outputPath); return; }
  log("🎨 Aplicando zócalo…");
  const conAudio = await tieneAudio(inputPath);
  const args = conAudio
    ? [
        "-i", inputPath, "-i", zocaloPath,
        "-filter_complex", "[0:v][1:v]overlay=x=0:y=H-h[v]",
        "-map", "[v]", "-map", "0:a",
        "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "fast",
        "-c:a", "aac", "-y", outputPath,
      ]
    : [
        "-i", inputPath, "-i", zocaloPath,
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-filter_complex", "[0:v][1:v]overlay=x=0:y=H-h[v]",
        "-map", "[v]", "-map", "2:a",
        "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "fast",
        "-c:a", "aac", "-shortest", "-y", outputPath,
      ];
  await ffmpegRun(args);
  fs.unlinkSync(inputPath);
}

// ── Cargar canchas ────────────────────────────────────────────────────────────

async function cargarCanchas() {
  const { data, error } = await supabase
    .from("canchas")
    .select("id, nombre, rtsp_url, youtube_stream_key")
    .eq("complejo_id", COMPLEJO_ID);
  if (error) { log(`❌ Error cargando canchas: ${error.message}`); return; }
  canchas = data ?? [];
  log(`🏟️  ${canchas.length} cancha(s): ${canchas.map((c) => c.nombre).join(", ")}`);
}

// ── Grabación continua ────────────────────────────────────────────────────────

function dentroDeHorario() {
  const h = new Date().getHours();
  return h >= 8; // graba de 08:00 a 00:00 (h=0 → false)
}

function iniciarGrabacionContinua(cancha) {
  if (grabacionesContinuas[cancha.id]) return;

  const dir = path.join(RECORDINGS_DIR, cancha.id);
  fs.mkdirSync(dir, { recursive: true });

  const rtspUrl = cancha.rtsp_url || "avfoundation";
  const inputArgs = rtspUrl === "avfoundation"
    ? ["-f", "avfoundation", "-framerate", "30", "-video_size", "1280x720", "-i", "0:0"]
    : ["-rtsp_transport", "tcp", "-i", rtspUrl];

  const outputPattern = path.join(dir, "%Y-%m-%d_%H-%M.mp4");

  const args = [
    ...inputArgs,
    "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
    "-preset", "veryfast", "-maxrate", "1500k", "-bufsize", "3000k",
    "-pix_fmt", "yuv420p", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-f", "segment",
    "-segment_time", String(parseInt(process.env.SEGMENT_SECS || "1800")),
    "-strftime", "1",
    "-reset_timestamps", "1",
    outputPattern,
  ];

  const logFile = fs.openSync(path.join(dir, "ffmpeg.log"), "a");
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", logFile] });
  proc.on("close", () => { try { fs.closeSync(logFile); } catch (_) {} });
  grabacionesContinuas[cancha.id] = proc;

  proc.on("close", (code) => {
    delete grabacionesContinuas[cancha.id];
    if (code !== 0 && code !== 255) {
      log(`⚠️  [${cancha.nombre}] grabación cerrada (${code})`);
      const esAv = !cancha.rtsp_url || cancha.rtsp_url === "avfoundation";
      if (!esAv) {
        // Para RTSP: reintentar en 15s
        setTimeout(() => {
          const c = canchas.find((x) => x.id === cancha.id);
          if (c && dentroDeHorario()) iniciarGrabacionContinua(c);
        }, 15000);
      }
      // Para avfoundation: tickGrabacion reintenta cada minuto (evita loop de cámara ocupada)
    }
  });

  log(`🎥 Grabación continua iniciada [${cancha.nombre}]`);
}

function detenerGrabacionContinua(cancha) {
  const proc = grabacionesContinuas[cancha.id];
  if (!proc) return;
  proc.kill("SIGINT");
  delete grabacionesContinuas[cancha.id];
  log(`⏹  Grabación detenida [${cancha.nombre}]`);
}

function tickGrabacion() {
  const debeGrabar = dentroDeHorario();

  // Esta variable se actualiza dentro del loop para que solo una cancha avfoundation arranque por tick
  let avFoundationOcupado = canchas.some(
    (c) => grabacionesContinuas[c.id] && (!c.rtsp_url || c.rtsp_url === "avfoundation")
  );

  for (const cancha of canchas) {
    const esAv = !cancha.rtsp_url || cancha.rtsp_url === "avfoundation";

    if (debeGrabar && !grabacionesContinuas[cancha.id]) {
      if (esAv && streamProcesses[cancha.id]) continue; // stream activo tiene prioridad
      if (esAv && avFoundationOcupado) continue;        // otra cancha ya usa la cámara
      iniciarGrabacionContinua(cancha);
      if (esAv) avFoundationOcupado = true;             // bloquear las siguientes en este tick
    } else if (!debeGrabar && grabacionesContinuas[cancha.id]) {
      detenerGrabacionContinua(cancha);
    }
  }
}

// ── Limpieza de segmentos viejos ──────────────────────────────────────────────

function limpiarSegmentosViejos() {
  const limite = Date.now() - 3 * 24 * 60 * 60 * 1000;
  for (const cancha of canchas) {
    const dir = path.join(RECORDINGS_DIR, cancha.id);
    try {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (fs.statSync(fp).mtimeMs < limite) {
          fs.unlinkSync(fp);
          log(`🗑️  Segmento expirado: ${f}`);
        }
      }
    } catch (_) {}
  }
}

// ── Extracción de clips ───────────────────────────────────────────────────────

async function extraerSegmento(pedido, outputPath) {
  const dir = path.join(RECORDINGS_DIR, pedido.cancha_id);

  const [hI, mI] = pedido.hora_inicio.split(":").map(Number);
  const [hF, mF] = pedido.hora_fin.split(":").map(Number);
  const inicioMin = hI * 60 + mI;
  // medianoche = 0:00 → tratarlo como 24:00 para el cálculo
  const finMin = (hF === 0 && mF === 0) ? 24 * 60 : hF * 60 + mF;

  let files;
  try { files = fs.readdirSync(dir); }
  catch { throw new Error("No hay grabaciones para esta cancha"); }

  const segments = files
    .map((f) => {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})\.mp4$/);
      if (!m || m[1] !== pedido.fecha) return null;
      const startMin = parseInt(m[2]) * 60 + parseInt(m[3]);
      return { file: path.join(dir, f), startMin };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin)
    .filter((s) => s.startMin < finMin && s.startMin + Math.ceil(parseInt(process.env.SEGMENT_SECS || "1800") / 60) > inicioMin);

  if (segments.length === 0) {
    throw new Error(`Sin grabaciones para ${pedido.fecha} ${pedido.hora_inicio}–${pedido.hora_fin}`);
  }

  const firstStart  = segments[0].startMin;
  const offsetSec   = Math.max(0, (inicioMin - firstStart) * 60);
  const durationSec = (finMin - inicioMin) * 60;

  const concatFile = path.join(TMP_DIR, `concat-${pedido.id}.txt`);
  fs.writeFileSync(concatFile, segments.map((s) => `file '${s.file}'`).join("\n"));

  try {
    await ffmpegRun([
      "-f", "concat", "-safe", "0", "-i", concatFile,
      "-ss", String(offsetSec), "-t", String(durationSec),
      "-c", "copy",
      "-y", outputPath,
    ]);
  } finally {
    if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile);
  }
}

async function procesarPedidosClip() {
  const { data: pedidos } = await supabase
    .from("clip_requests")
    .select("*")
    .eq("status", "pending")
    .order("created_at")
    .limit(1);
  if (!pedidos || pedidos.length === 0) return;

  const pedido = pedidos[0];
  await supabase.from("clip_requests").update({ status: "processing" }).eq("id", pedido.id);
  log(`📦 Procesando clip ${pedido.id} — ${pedido.fecha} ${pedido.hora_inicio}–${pedido.hora_fin}`);

  const rawPath   = path.join(TMP_DIR, `clip-${pedido.id}-raw.mp4`);
  const finalPath = path.join(TMP_DIR, `clip-${pedido.id}.mp4`);

  try {
    await extraerSegmento(pedido, rawPath);
    await aplicarZocalo(rawPath, finalPath);
    const key      = `clips/${pedido.id}.mp4`;
    const videoUrl = await subirR2(key, finalPath);
    await supabase.from("clip_requests").update({ status: "ready", video_url: videoUrl }).eq("id", pedido.id);
    log(`✅ Clip listo: ${pedido.id}`);
  } catch (err) {
    log(`❌ Error en clip ${pedido.id}: ${err.message}`);
    await supabase.from("clip_requests").update({ status: "error", error_msg: err.message }).eq("id", pedido.id);
  } finally {
    if (fs.existsSync(rawPath))   fs.unlinkSync(rawPath);
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
  }
}

// ── Clip verticales (editor) ──────────────────────────────────────────────────

async function procesarClipJobs() {
  const { data: jobs } = await supabase
    .from("clip_jobs").select("id, source_url, crop_x_pct")
    .eq("status", "pending").order("created_at").limit(1);
  if (!jobs || jobs.length === 0) return;
  const job = jobs[0];
  await supabase.from("clip_jobs").update({ status: "processing" }).eq("id", job.id);
  log(`✂️  Procesando clip vertical ${job.id}…`);
  const tmpInput  = path.join(TMP_DIR, `clipjob-${job.id}-in.mp4`);
  const tmpOutput = path.join(TMP_DIR, `clipjob-${job.id}-out.mp4`);
  try {
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const res = await fetch(job.source_url);
    fs.writeFileSync(tmpInput, Buffer.from(await res.arrayBuffer()));
    await ffmpegRun([
      "-i", tmpInput,
      "-vf", `crop=ih*9/16:ih:iw*${job.crop_x_pct}:0,scale=1080:1920`,
      "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1", "-preset", "fast", "-crf", "26",
      "-c:a", "aac", "-movflags", "+faststart", "-y", tmpOutput,
    ]);
    const resultUrl = await subirR2(`clips/${job.id}.mp4`, tmpOutput);
    await supabase.from("clip_jobs").update({ status: "done", result_url: resultUrl }).eq("id", job.id);
    log(`✅ Clip vertical listo: ${resultUrl}`);
  } catch (err) {
    await supabase.from("clip_jobs").update({ status: "error" }).eq("id", job.id);
    log(`❌ Error en clip job ${job.id}: ${err.message}`);
  } finally {
    if (fs.existsSync(tmpInput))  fs.unlinkSync(tmpInput);
    if (fs.existsSync(tmpOutput)) fs.unlinkSync(tmpOutput);
  }
}

// ── Stream en vivo (YouTube) ──────────────────────────────────────────────────

const OVERLAY_PORT = 9988;
const OVERLAY_W    = 920;
const OVERLAY_H    = 52;
let _overlayBuffer = Buffer.alloc(OVERLAY_W * OVERLAY_H * 4, 0);
let _overlayServer = null;

function iniciarServidorOverlay() {
  return new Promise((resolve) => {
    if (_overlayServer?.listening) { resolve(); return; }
    const net = require("net");
    _overlayServer = net.createServer((socket) => {
      const timer = setInterval(() => {
        try { socket.write(_overlayBuffer); } catch (_) {}
      }, 500);
      socket.on("close", () => clearInterval(timer));
      socket.on("error", () => clearInterval(timer));
    });
    _overlayServer.on("error", (err) => { log(`⚠️  Overlay TCP: ${err.message}`); resolve(); });
    _overlayServer.listen(OVERLAY_PORT, "127.0.0.1", () => {
      log(`🖼  Overlay listo (TCP ${OVERLAY_PORT})`);
      resolve();
    });
  });
}

function ffmpegArgsStream(rtspUrl, ytUrl) {
  const inputBase = rtspUrl === "avfoundation"
    ? ["-f", "avfoundation", "-framerate", "30", "-video_size", "1280x720", "-i", "0:0"]
    : ["-rtsp_transport", "tcp", "-i", rtspUrl];
  const encodeOutput = [
    "-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
    "-preset", "veryfast", "-maxrate", "1500k", "-bufsize", "3000k",
    "-pix_fmt", "yuv420p", "-g", "60",
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
    "-b:v", "1500k", "-tune", "zerolatency", "-f", "flv", ytUrl,
  ];
  if (_overlayServer?.listening) {
    return [
      ...inputBase,
      "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${OVERLAY_W}x${OVERLAY_H}`, "-framerate", "2",
      "-i", `tcp://127.0.0.1:${OVERLAY_PORT}`,
      "-filter_complex", "[0:v][1:v]overlay=10:10[v]",
      "-map", "[v]", "-map", "0:a",
      ...encodeOutput,
    ];
  }
  return [...inputBase, ...encodeOutput];
}

async function setStreamActivo(canchaId, valor) {
  await supabase.from("canchas").update({ stream_activo: valor }).eq("id", canchaId);
}

function iniciarStream(cancha) {
  if (streamProcesses[cancha.id]) return;
  if (!cancha.youtube_stream_key) { log(`⚠️  [${cancha.nombre}] Sin youtube_stream_key`); return; }

  const rtspUrl = cancha.rtsp_url || "avfoundation";
  const esAv    = !cancha.rtsp_url || cancha.rtsp_url === "avfoundation";

  // Pausar grabación continua para liberar la cámara
  if (esAv && grabacionesContinuas[cancha.id]) {
    detenerGrabacionContinua(cancha);
  }

  const ytUrl = `rtmp://a.rtmp.youtube.com/live2/${cancha.youtube_stream_key}`;
  const args  = ffmpegArgsStream(rtspUrl, ytUrl);
  const proc  = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "inherit"] });

  const confirmTimer = setTimeout(() => {
    if (streamProcesses[cancha.id]) { setStreamActivo(cancha.id, true); log(`✅ Stream confirmado → YouTube [${cancha.nombre}]`); }
  }, 10000);

  proc.on("close", (code) => {
    clearTimeout(confirmTimer);
    setStreamActivo(cancha.id, false);
    delete streamProcesses[cancha.id];
    log(`⏹  Stream [${cancha.nombre}] cerrado (código ${code})`);
    // Reanudar grabación si corresponde
    const c = canchas.find((x) => x.id === cancha.id);
    if (c && dentroDeHorario()) setTimeout(() => iniciarGrabacionContinua(c), 3000);
  });

  streamProcesses[cancha.id] = { proceso: proc, confirmTimer, ytUrl };
  log(`🔴 Conectando a YouTube… [${cancha.nombre}]`);
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
  const ids     = canchas.map((c) => c.id);
  const { data } = await supabase.from("canchas").select("id, nombre, rtsp_url, youtube_stream_key, transmitiendo").in("id", ids);
  if (!data) return;
  canchas = canchas.map((c) => ({ ...c, ...(data.find((d) => d.id === c.id) ?? {}) }));
  for (const cancha of canchas) {
    if (cancha.transmitiendo && !streamProcesses[cancha.id]) iniciarStream(cancha);
    else if (!cancha.transmitiendo && streamProcesses[cancha.id]) detenerStream(cancha);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (!COMPLEJO_ID) { console.error("❌ Falta COMPLEJO_ID en .env"); process.exit(1); }

function matarFfmpegHuerfanos() {
  try {
    const { execSync } = require("child_process");
    const output = execSync("pgrep -f 'tu-partido-recordings'", { encoding: "utf8" }).trim();
    if (!output) return;
    const pids = output.split("\n").map(Number).filter(Boolean);
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); log(`🧹 Proceso ffmpeg huérfano eliminado (PID ${pid})`); } catch (_) {}
    }
  } catch (_) {}
}

function limpiarYSalir() {
  log("🛑 Apagando recorder…");
  for (const entry of Object.values(streamProcesses)) { try { entry.proceso.kill("SIGTERM"); } catch (_) {} }
  for (const proc of Object.values(grabacionesContinuas)) { try { proc.kill("SIGINT"); } catch (_) {} }
  process.exit(0);
}
process.on("SIGINT",  limpiarYSalir);
process.on("SIGTERM", limpiarYSalir);

fs.mkdirSync(TMP_DIR,        { recursive: true });
fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

matarFfmpegHuerfanos();

log(`🚀 Recorder iniciado — Complejo: ${COMPLEJO_ID}`);
log(`📁 Grabaciones: ${RECORDINGS_DIR}`);

cargarCanchas().then(async () => {
  await iniciarServidorOverlay();
  tickGrabacion();
  await verificarStreams();

  supabase
    .channel("canchas-control")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "canchas" }, (payload) => {
      const updated = payload.new;
      const cancha  = canchas.find((c) => c.id === updated.id);
      if (!cancha) return;
      Object.assign(cancha, updated);
      if (updated.transmitiendo && !streamProcesses[updated.id]) {
        log(`📡 Dashboard → iniciando stream [${cancha.nombre}]`);
        iniciarStream(cancha);
      } else if (!updated.transmitiendo && streamProcesses[updated.id]) {
        log(`📡 Dashboard → deteniendo stream [${cancha.nombre}]`);
        detenerStream(cancha);
      }
    })
    .subscribe((status) => log(`📡 Realtime: ${status}`));
});

// Chequear grabación cada minuto (arranca/para según horario)
setInterval(tickGrabacion, 60 * 1000);

// Procesar pedidos de clip cada 15 segundos
setInterval(procesarPedidosClip, 15 * 1000);

// Procesar clip verticales (editor) cada 10 segundos
setInterval(procesarClipJobs, 10 * 1000);

// Verificar streams cada 30 segundos
setInterval(verificarStreams, 30 * 1000);

// Limpiar segmentos viejos cada 6 horas
setInterval(limpiarSegmentosViejos, 6 * 60 * 60 * 1000);
