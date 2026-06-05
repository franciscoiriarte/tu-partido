require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
const { S3Client } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Lock de instancia única ───────────────────────────────────────────────────
const LOCK_FILE = "/tmp/tu-partido-recorder.lock";
if (fs.existsSync(LOCK_FILE)) {
  const pid = parseInt(fs.readFileSync(LOCK_FILE, "utf8").trim());
  try { process.kill(pid, 0); console.error(`⛔ Recorder ya corriendo (PID ${pid}). Saliendo.`); process.exit(1); }
  catch (_) { fs.unlinkSync(LOCK_FILE); } // PID obsoleto, continuar
}
fs.writeFileSync(LOCK_FILE, String(process.pid));
process.on("exit", () => { try { fs.unlinkSync(LOCK_FILE); } catch (_) {} });

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
const BUFFER_DIR     = path.join(os.tmpdir(), "tu-partido-buffers");
const R2_BUCKET      = process.env.R2_BUCKET;
const R2_PUBLIC_URL  = process.env.R2_PUBLIC_URL;
const ASSETS_DIR     = process.env.ASSETS_DIR     || path.join(__dirname, "assets");

const LOG_DIR  = path.join(os.homedir(), "Library", "Logs", "tupartido");
const LOG_FILE = path.join(LOG_DIR, "recorder.log");
fs.mkdirSync(LOG_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });

// ── Estado ────────────────────────────────────────────────────────────────────

let canchas = [];
const grabacionesContinuas = {}; // canchaId → ffmpeg process
const streamProcesses      = {}; // canchaId → { proceso, confirmTimer }
const retryCounts          = {}; // canchaId → número de fallos consecutivos

const segmentosProcessados = new Set(); // "canchaId/YYYY-MM-DD_HH-MM.mp4"
const procesandoSegmentos  = new Set(); // canchaIds currently encoding a segment

let hwEncoder = null; // detectado al arrancar

async function detectarEncoder() {
  const candidatos = [
    {
      name: "h264_videotoolbox",
      hwaccelArgs: ["-hwaccel", "videotoolbox"],
      args: ["-c:v", "h264_videotoolbox", "-b:v", "800k", "-profile:v", "high"],
    },
    {
      name: "h264_qsv",
      hwaccelArgs: ["-hwaccel", "qsv"],
      args: ["-c:v", "h264_qsv", "-preset", "veryfast", "-b:v", "800k"],
    },
    {
      name: "h264_nvenc",
      hwaccelArgs: ["-hwaccel", "cuda"],
      args: ["-c:v", "h264_nvenc", "-preset", "p4", "-b:v", "800k"],
    },
  ];
  for (const enc of candidatos) {
    try {
      await ffmpegRun(["-f", "lavfi", "-i", "color=black:s=64x64:d=0.1", ...enc.args, "-f", "null", "-", "-y"]);
      log(`⚡ Encoder de hardware: ${enc.name}`);
      return enc;
    } catch (_) {}
  }
  log("⚡ Encoder: libx264 ultrafast (sin hardware disponible)");
  return { hwaccelArgs: [], args: ["-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "ultrafast"] };
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toLocaleString("es-AR")}] ${msg}`;
  console.log(line);
  logStream.write(line + "\n");
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
  const { hwaccelArgs, args: encArgs } = hwEncoder;
  // Scale to 720p before overlay — zócalo is 1280×720 so no resize needed on it
  const filterBase = "[0:v]scale=1280:720[sv];[sv][1:v]overlay=x=0:y=H-h[v]";
  const args = conAudio
    ? [
        ...hwaccelArgs, "-i", inputPath, "-i", zocaloPath,
        "-filter_complex", filterBase,
        "-map", "[v]", "-map", "0:a",
        ...encArgs,
        "-c:a", "aac", "-y", outputPath,
      ]
    : [
        ...hwaccelArgs, "-i", inputPath, "-i", zocaloPath,
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-filter_complex", filterBase,
        "-map", "[v]", "-map", "2:a",
        ...encArgs,
        "-c:a", "aac", "-shortest", "-y", outputPath,
      ];
  await ffmpegRun(args);
  // Note: callers' finally blocks clean up inputPath; aplicarZocalo does NOT unlink it.
}

// ── Cargar canchas ────────────────────────────────────────────────────────────

async function cargarCanchas() {
  const { data, error } = await supabase
    .from("canchas")
    .select("id, nombre, rtsp_url, youtube_stream_key, turnos_fijos")
    .eq("complejo_id", COMPLEJO_ID);
  if (error) { log(`❌ Error cargando canchas: ${error.message}`); return; }
  canchas = data ?? [];
  log(`🏟️  ${canchas.length} cancha(s): ${canchas.map((c) => c.nombre).join(", ")}`);
}

// ── Auto-generación de clips al fin de cada turno fijo ────────────────────────

const turnosAutoCreados = new Set(); // "canchaId|fecha|inicio|fin" — evita duplicados en esta sesión

async function tickTurnosFijos() {
  const ahora    = new Date();
  const hoy      = ahora.toLocaleDateString("en-CA");
  const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes();

  for (const cancha of canchas) {
    const turnos = cancha.turnos_fijos ?? [];
    for (const turno of turnos) {
      const [hF, mF] = turno.fin.split(":").map(Number);
      const finMin   = hF * 60 + (mF || 0);

      // Crear el clip_request dentro de los 60 min posteriores al fin del turno
      if (ahoraMin < finMin || ahoraMin > finMin + 60) continue;

      const sessionKey = `${cancha.id}|${hoy}|${turno.inicio}|${turno.fin}`;
      if (turnosAutoCreados.has(sessionKey)) continue;
      turnosAutoCreados.add(sessionKey);

      const { data: existente } = await supabase
        .from("clip_requests")
        .select("id")
        .eq("cancha_id", cancha.id)
        .eq("fecha", hoy)
        .eq("hora_inicio", turno.inicio)
        .eq("hora_fin", turno.fin)
        .maybeSingle();

      if (existente) continue;

      await supabase.from("clip_requests").insert({
        cancha_id:   cancha.id,
        fecha:       hoy,
        hora_inicio: turno.inicio,
        hora_fin:    turno.fin,
      });
      log(`📅 Clip automático [${cancha.nombre}] ${turno.inicio}–${turno.fin}`);
    }
  }
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
  const esAv = rtspUrl === "avfoundation";
  const inputArgs = esAv
    ? ["-f", "avfoundation", "-framerate", "30", "-video_size", "1280x720", "-i", "0:0"]
    : ["-rtsp_transport", "tcp", "-i", rtspUrl];

  // RTSP cameras already send H.264 — stream copy to avoid re-encoding (near-zero CPU).
  // avfoundation captures raw frames so it still needs encode.
  const encodingArgs = esAv
    ? ["-c:v", "libx264", "-profile:v", "high", "-level:v", "4.1",
       "-preset", "veryfast", "-maxrate", "1500k", "-bufsize", "3000k",
       "-pix_fmt", "yuv420p", "-g", "60",
       "-c:a", "aac", "-b:a", "128k", "-ar", "44100"]
    : ["-c", "copy"];

  const outputPattern = path.join(dir, "%Y-%m-%d_%H-%M.mp4");

  const args = [
    ...inputArgs,
    ...encodingArgs,
    "-f", "segment",
    "-segment_time", String(parseInt(process.env.SEGMENT_SECS || "1800")),
    "-strftime", "1",
    "-reset_timestamps", "1",
    outputPattern,
  ];

  // Rolling 3-minute TS buffer for highlight clips (RTSP only — avfoundation can't copy raw packets)
  if (rtspUrl !== "avfoundation") {
    const bufDir = path.join(BUFFER_DIR, cancha.id);
    fs.mkdirSync(bufDir, { recursive: true });
    args.push(
      "-c", "copy",
      "-f", "segment",
      "-segment_time", "60",
      "-segment_wrap", "3",
      "-reset_timestamps", "1",
      path.join(bufDir, "buf%d.ts")
    );
  }

  const logFile = fs.openSync(path.join(dir, "ffmpeg.log"), "a");
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", logFile] });
  proc.on("close", () => { try { fs.closeSync(logFile); } catch (_) {} });
  grabacionesContinuas[cancha.id] = proc;

  proc.on("close", (code) => {
    delete grabacionesContinuas[cancha.id];
    if (code !== 0 && code !== 255) {
      retryCounts[cancha.id] = (retryCounts[cancha.id] || 0) + 1;
      const retries  = retryCounts[cancha.id];
      const delaySec = Math.min(15 * Math.pow(2, retries - 1), 300); // 15s → 30s → 60s → 120s → 300s
      log(`⚠️  [${cancha.nombre}] grabación cerrada (${code}) — reintento #${retries} en ${delaySec}s`);
      if (!esAv) {
        setTimeout(() => {
          const c = canchas.find((x) => x.id === cancha.id);
          if (c && dentroDeHorario()) iniciarGrabacionContinua(c);
        }, delaySec * 1000);
      }
    } else {
      retryCounts[cancha.id] = 0; // conexión limpia → resetear contador
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
  const dosMinAtras = Date.now() - 2 * 60 * 1000;

  let avFoundationOcupado = canchas.some(
    (c) => grabacionesContinuas[c.id] && (!c.rtsp_url || c.rtsp_url === "avfoundation")
  );

  for (const cancha of canchas) {
    const esAv = !cancha.rtsp_url || cancha.rtsp_url === "avfoundation";

    if (debeGrabar && !grabacionesContinuas[cancha.id]) {
      if (esAv && streamProcesses[cancha.id]) continue;
      if (esAv && avFoundationOcupado) continue;
      iniciarGrabacionContinua(cancha);
      if (esAv) avFoundationOcupado = true;
    } else if (!debeGrabar && grabacionesContinuas[cancha.id]) {
      detenerGrabacionContinua(cancha);
    } else if (debeGrabar && grabacionesContinuas[cancha.id] && !esAv) {
      // Heartbeat: si el archivo de grabación no creció en 2 min, reiniciar
      const dir = path.join(RECORDINGS_DIR, cancha.id);
      try {
        const archivos = fs.readdirSync(dir)
          .filter((f) => f.endsWith(".mp4"))
          .map((f) => ({ f, mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (archivos.length > 0 && archivos[0].mtime < dosMinAtras) {
          log(`🔄 [${cancha.nombre}] sin actividad 2 min — reiniciando grabación`);
          detenerGrabacionContinua(cancha);
          setTimeout(() => {
            const c = canchas.find((x) => x.id === cancha.id);
            if (c && dentroDeHorario()) iniciarGrabacionContinua(c);
          }, 3000);
        } else if (archivos.length > 0) {
          retryCounts[cancha.id] = 0; // grabando estable → resetear backoff
        }
      } catch (_) {}
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

// ── Monitoreo y estado ────────────────────────────────────────────────────────

async function tickEstado() {
  const camaras = canchas.map((c) => ({
    id:       c.id,
    nombre:   c.nombre,
    grabando: !!grabacionesContinuas[c.id],
    reintentos: retryCounts[c.id] || 0,
  }));
  await supabase.from("complejos").update({
    recorder_status: {
      ultima_actualizacion: new Date().toISOString(),
      grabando: camaras.filter((c) => c.grabando).length,
      camaras,
    },
  }).eq("id", COMPLEJO_ID);
}

function verificarDisco() {
  try {
    const { execSync } = require("child_process");
    const out   = execSync(`/bin/df -k "${RECORDINGS_DIR}"`, { encoding: "utf8" });
    const kbFree = parseInt(out.trim().split("\n")[1].split(/\s+/)[3]);
    const gbFree = kbFree / 1024 / 1024;
    if (gbFree < 20) log(`⚠️  DISCO: solo ${gbFree.toFixed(1)} GB libres — considerá liberar espacio`);
  } catch (_) {}
}

async function esperarRed(host, puerto = 554, maxIntentos = 12) {
  const net = require("net");
  for (let i = 0; i < maxIntentos; i++) {
    const ok = await new Promise((resolve) => {
      const sock = net.createConnection({ host, port: puerto, timeout: 3000 });
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("error",   () => { sock.destroy(); resolve(false); });
      sock.on("timeout", () => { sock.destroy(); resolve(false); });
    });
    if (ok) { if (i > 0) log(`✅ DVR accesible (${host})`); return; }
    if (i === 0) log(`⏳ Esperando red / DVR (${host}:${puerto})…`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  log(`⚠️  DVR (${host}) no responde — arrancando igual`);
}

// ── Pre-procesamiento de segmentos ────────────────────────────────────────────

function inicializarSegmentosProcessados() {
  for (const cancha of canchas) {
    const dir = path.join(RECORDINGS_DIR, cancha.id);
    try {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith(".done")) segmentosProcessados.add(`${cancha.id}/${f.slice(0, -5)}`);
      }
    } catch (_) {}
  }
  if (segmentosProcessados.size > 0) log(`📋 ${segmentosProcessados.size} segmento(s) ya procesado(s)`);
}

async function procesarSegmentoPendiente(cancha, segmentPath) {
  const baseName  = path.basename(segmentPath, ".mp4");
  const r2Key     = `segments/${cancha.id}/${baseName}.mp4`;
  const finalPath = path.join(TMP_DIR, `seg-${cancha.id}-${baseName}.mp4`);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  log(`🎬 Procesando segmento [${cancha.nombre}] ${baseName}`);
  try {
    await aplicarZocalo(segmentPath, finalPath);
    await subirR2(r2Key, finalPath);
    fs.writeFileSync(path.join(path.dirname(segmentPath), `${baseName}.done`), "");
    log(`✅ Segmento listo [${cancha.nombre}] ${baseName}`);
  } finally {
    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
  }
}

function tickSegmentos() {
  const dosMinAtras = Date.now() - 2 * 60 * 1000;
  const tresDiasAtras = Date.now() - 3 * 24 * 60 * 60 * 1000;
  for (const cancha of canchas) {
    if (procesandoSegmentos.has(cancha.id)) continue;
    const dir = path.join(RECORDINGS_DIR, cancha.id);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    const segments = files
      .filter((f) => /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.mp4$/.test(f))
      .sort();
    for (const f of segments) {
      const key = `${cancha.id}/${f}`;
      if (segmentosProcessados.has(key)) continue;
      const fp   = path.join(dir, f);
      let stat;
      try { stat = fs.statSync(fp); } catch { continue; }
      if (stat.mtimeMs > dosMinAtras) continue;   // still being written
      if (stat.mtimeMs < tresDiasAtras) continue; // too old, skip
      // Skip the current active segment
      if (grabacionesContinuas[cancha.id] && f === segments[segments.length - 1]) continue;
      segmentosProcessados.add(key);
      procesandoSegmentos.add(cancha.id);
      procesarSegmentoPendiente(cancha, fp)
        .catch((err) => { segmentosProcessados.delete(key); log(`❌ Segmento ${f}: ${err.message}`); })
        .finally(() => procesandoSegmentos.delete(cancha.id));
      break; // one per cancha per tick
    }
  }
}

// ── Extracción de clips ───────────────────────────────────────────────────────

function esMP4Valido(filePath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath]);
    p.on("close", (code) => resolve(code === 0));
  });
}

async function extraerSegmento(pedido, outputPath) {
  const dir = path.join(RECORDINGS_DIR, pedido.cancha_id);

  const [hI, mI] = pedido.hora_inicio.split(":").map(Number);
  const [hF, mF] = pedido.hora_fin.split(":").map(Number);
  const inicioMin = hI * 60 + mI;
  const finMin    = (hF === 0 && mF === 0) ? 24 * 60 : hF * 60 + mF;

  let files;
  try { files = fs.readdirSync(dir); }
  catch { throw new Error("No hay grabaciones para esta cancha"); }

  const segDurMin  = Math.ceil(parseInt(process.env.SEGMENT_SECS || "600") / 60);
  const candidatos = files
    .map((f) => {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})\.mp4$/);
      if (!m || m[1] !== pedido.fecha) return null;
      const startMin = parseInt(m[2]) * 60 + parseInt(m[3]);
      return { file: path.join(dir, f), startMin };
    })
    .filter(Boolean)
    .sort((a, b) => a.startMin - b.startMin)
    .filter((s) => s.startMin < finMin && s.startMin + segDurMin > inicioMin);

  // Filtrar archivos corruptos (sin moov atom)
  const validos = await Promise.all(candidatos.map(async (s) => (await esMP4Valido(s.file)) ? s : null));
  const segments = validos.filter(Boolean);

  if (segments.length === 0)
    throw new Error(`Sin grabaciones para ${pedido.fecha} ${pedido.hora_inicio}–${pedido.hora_fin}`);

  const firstStart  = segments[0].startMin;
  const offsetSec   = Math.max(0, (inicioMin - firstStart) * 60);
  const durationSec = (finMin - inicioMin) * 60;
  const concatFile  = path.join(TMP_DIR, `concat-${pedido.id}.txt`);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  fs.writeFileSync(concatFile, segments.map((s) => `file '${s.file}'`).join("\n"));

  try {
    await ffmpegRun([
      "-f", "concat", "-safe", "0", "-i", concatFile,
      "-ss", String(offsetSec), "-t", String(durationSec),
      "-c", "copy", "-y", outputPath,
    ]);
  } finally {
    if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile);
  }
}

let procesandoClip = false;

async function procesarPedidosClip() {
  if (procesandoClip) return;
  procesandoClip = true;
  try {
    const { data: pedidos } = await supabase
      .from("clip_requests")
      .select("*")
      .in("status", ["pending", "processing"])
      .order("created_at")
      .limit(1);
    if (!pedidos || pedidos.length === 0) return;

    const pedido    = pedidos[0];
    const rawPath   = path.join(TMP_DIR, `clip-${pedido.id}-raw.mp4`);
    const finalPath = path.join(TMP_DIR, `clip-${pedido.id}.mp4`);
    fs.mkdirSync(TMP_DIR, { recursive: true });

    await supabase.from("clip_requests").update({ status: "processing" }).eq("id", pedido.id);
    log(`📦 Procesando clip ${pedido.id} — ${pedido.fecha} ${pedido.hora_inicio}–${pedido.hora_fin}`);

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
  } finally {
    procesandoClip = false;
  }
}

// ── Highlight clips ───────────────────────────────────────────────────────────

async function procesarHighlights() {
  const { data: highlights } = await supabase
    .from("highlights")
    .select("*")
    .is("clip_url", null)
    .not("cancha_id", "is", null)
    .order("marcado_en")
    .limit(5);
  if (!highlights || highlights.length === 0) return;

  for (const h of highlights) {
    const T    = new Date(h.marcado_en).getTime() / 1000; // Unix seconds
    const ahora = Date.now() / 1000;

    // Wait 7s so T+5 is fully captured in the buffer
    if (ahora < T + 7) continue;
    // Buffer only covers ~150s back; beyond that the data is gone
    if (ahora > T + 120) {
      await supabase.from("highlights").update({ clip_url: "error:expirado" }).eq("id", h.id);
      log(`⏰ Highlight ${h.id} expirado (buffer sobrescrito)`);
      continue;
    }

    const bufDir = path.join(BUFFER_DIR, h.cancha_id);
    let files;
    try {
      files = fs.readdirSync(bufDir)
        .filter((f) => /^buf\d+\.ts$/.test(f))
        .map((f) => {
          const fp   = path.join(bufDir, f);
          const stat = fs.statSync(fp);
          return { path: fp, mtime: stat.mtimeMs / 1000, size: stat.size };
        })
        .filter((f) => f.size > 0)
        .sort((a, b) => a.mtime - b.mtime);
    } catch (_) {
      log(`❌ [Highlight ${h.id}] Buffer no disponible para cancha ${h.cancha_id}`);
      continue;
    }

    if (files.length === 0) {
      log(`❌ [Highlight ${h.id}] Buffer vacío`);
      continue;
    }

    // Estimate time ranges: mtime ≈ end time; start = mtime of previous segment (or mtime-60 for first)
    const ranges = files.map((f, i) => ({
      path:      f.path,
      endTime:   f.mtime,
      startTime: i === 0 ? f.mtime - 60 : files[i - 1].mtime,
    }));

    const wantStart = T - 30;
    const wantEnd   = T + 5;
    const relevant  = ranges.filter((r) => r.endTime > wantStart && r.startTime < wantEnd);

    if (relevant.length === 0) {
      log(`❌ [Highlight ${h.id}] Sin segmentos que cubran [T-30, T+5]`);
      await supabase.from("highlights").update({ clip_url: "error:sin_buffer" }).eq("id", h.id);
      continue;
    }

    const SS       = Math.max(0, wantStart - relevant[0].startTime);
    const rawPath  = path.join(TMP_DIR, `hl-${h.id}-raw.mp4`);
    const finalPath = path.join(TMP_DIR, `hl-${h.id}.mp4`);
    const concatFile = path.join(TMP_DIR, `hl-concat-${h.id}.txt`);

    try {
      fs.writeFileSync(concatFile, relevant.map((r) => `file '${r.path}'`).join("\n"));
      log(`🎬 Extrayendo highlight ${h.id} (SS=${SS.toFixed(1)}s, src=${relevant.length} seg)…`);
      await ffmpegRun([
        // No hwaccel: TS buffer segments cause issues with VideoToolbox decoder
        "-f", "concat", "-safe", "0", "-i", concatFile,
        "-ss", SS.toFixed(2),
        "-t",  "35",
        ...hwEncoder.args,
        "-c:a", "aac",
        "-y", rawPath,
      ]);
      await aplicarZocalo(rawPath, finalPath);
      const videoUrl = await subirR2(`highlights/${h.id}.mp4`, finalPath);
      await supabase.from("highlights").update({ clip_url: videoUrl }).eq("id", h.id);
      log(`✅ Highlight clip listo: ${h.id}`);
    } catch (err) {
      log(`❌ Error en highlight ${h.id}: ${err.message}`);
      await supabase.from("highlights").update({ clip_url: `error:${err.message.slice(0, 80)}` }).eq("id", h.id);
    } finally {
      if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile);
      if (fs.existsSync(rawPath))    fs.unlinkSync(rawPath);
      if (fs.existsSync(finalPath))  fs.unlinkSync(finalPath);
    }
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
fs.mkdirSync(BUFFER_DIR,     { recursive: true });

matarFfmpegHuerfanos();

log(`🚀 Recorder iniciado — Complejo: ${COMPLEJO_ID}`);
log(`📁 Grabaciones: ${RECORDINGS_DIR}`);

cargarCanchas().then(async () => {
  // Esperar a que el DVR sea accesible antes de arrancar
  const hostDvr = canchas.map((c) => c.rtsp_url).find((u) => u && u.startsWith("rtsp://"))
    ?.match(/@([^:/]+)/)?.[1];
  if (hostDvr) await esperarRed(hostDvr);

  hwEncoder = await detectarEncoder();
  await iniciarServidorOverlay();
  tickGrabacion();
  inicializarSegmentosProcessados();
  await supabase.from("clip_requests").update({ status: "pending" }).eq("status", "processing");
  log("🔄 Clips en processing reseteados a pending");
  await verificarStreams();
  await tickEstado();
  verificarDisco();

  supabase
    .channel("canchas-control")
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "canchas" }, (payload) => {
      const updated = payload.new;
      const cancha  = canchas.find((c) => c.id === updated.id);
      if (!cancha) return;
      const turnosAntes = JSON.stringify(cancha.turnos_fijos);
      Object.assign(cancha, updated);
      if (JSON.stringify(cancha.turnos_fijos) !== turnosAntes)
        log(`📅 Turnos actualizados [${cancha.nombre}]: ${cancha.turnos_fijos.length} turno(s)`);
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

// Apagado limpio: cerrar ffmpeg correctamente para no dejar MP4 incompletos
function shutdown() {
  log("🛑 Apagando recorder…");
  for (const proc of Object.values(grabacionesContinuas)) {
    try { proc.kill("SIGINT"); } catch (_) {}
  }
  setTimeout(() => process.exit(0), 3000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT",  shutdown);

// Chequear grabación cada minuto (arranca/para según horario)
setInterval(tickGrabacion,          60 * 1000);
setInterval(tickEstado,             60 * 1000);
setInterval(verificarDisco,     60 * 60 * 1000);

// Pre-procesar segmentos cerrados cada minuto

// Procesar pedidos de clip cada 15 segundos
setInterval(tickTurnosFijos,    60 * 1000);
setInterval(procesarPedidosClip, 15 * 1000);

// Procesar highlight clips cada 5 segundos
setInterval(procesarHighlights, 5 * 1000);

// Procesar clip verticales (editor) cada 10 segundos
setInterval(procesarClipJobs, 10 * 1000);

// Verificar streams cada 30 segundos
setInterval(verificarStreams, 30 * 1000);

// Limpiar segmentos viejos cada 6 horas
setInterval(limpiarSegmentosViejos, 6 * 60 * 60 * 1000);
