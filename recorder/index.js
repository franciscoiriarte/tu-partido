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
const BUFFER_DIR     = path.join(os.tmpdir(), "tu-partido-buffers");
const R2_BUCKET      = process.env.R2_BUCKET;
const R2_PUBLIC_URL  = process.env.R2_PUBLIC_URL;
const ASSETS_DIR     = process.env.ASSETS_DIR     || path.join(__dirname, "assets");

// ── Estado ────────────────────────────────────────────────────────────────────

let canchas = [];
const grabacionesContinuas = {}; // canchaId → ffmpeg process
const streamProcesses      = {}; // canchaId → { proceso, confirmTimer }

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
      log(`⚠️  [${cancha.nombre}] grabación cerrada (${code})`);
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

async function procesarPedidosClip() {
  const { data: pedidos } = await supabase
    .from("clip_requests")
    .select("*")
    .in("status", ["pending", "processing"])
    .order("created_at");
  if (!pedidos || pedidos.length === 0) return;

  const segDurMin = Math.ceil(parseInt(process.env.SEGMENT_SECS || "600") / 60);

  for (const pedido of pedidos) {
    const dir = path.join(RECORDINGS_DIR, pedido.cancha_id);
    let files;
    try { files = fs.readdirSync(dir); } catch { files = []; }

    const [hI, mI] = pedido.hora_inicio.split(":").map(Number);
    const [hF, mF] = pedido.hora_fin.split(":").map(Number);
    const inicioMin = hI * 60 + mI;
    const finMin    = hF === 0 && mF === 0 ? 24 * 60 : hF * 60 + mF;

    const relevantes = files
      .map((f) => {
        const m = f.match(/^(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})\.mp4$/);
        if (!m || m[1] !== pedido.fecha) return null;
        const startMin = parseInt(m[2]) * 60 + parseInt(m[3]);
        if (startMin >= finMin || startMin + segDurMin <= inicioMin) return null;
        return { f, baseName: f.slice(0, -4), startMin };
      })
      .filter(Boolean)
      .sort((a, b) => a.startMin - b.startMin);

    if (relevantes.length === 0) {
      if (pedido.status === "pending") {
        await supabase.from("clip_requests").update({ status: "error", error_msg: "Sin grabación para ese horario" }).eq("id", pedido.id);
        log(`❌ Sin segmentos para clip ${pedido.id}`);
      }
      continue;
    }

    const urls = [];
    let todoListo = true;
    for (const seg of relevantes) {
      const donePath = path.join(dir, `${seg.baseName}.done`);
      if (fs.existsSync(donePath)) {
        urls.push(`${R2_PUBLIC_URL}/segments/${pedido.cancha_id}/${seg.f}`);
      } else {
        todoListo = false;
        break;
      }
    }

    if (todoListo && urls.length > 0) {
      const videoUrl = urls.length === 1 ? urls[0] : JSON.stringify(urls);
      await supabase.from("clip_requests").update({ status: "ready", video_url: videoUrl }).eq("id", pedido.id);
      log(`✅ Clip listo (${urls.length} seg): ${pedido.id}`);
    } else if (pedido.status === "pending") {
      await supabase.from("clip_requests").update({ status: "processing" }).eq("id", pedido.id);
      log(`⏳ Clip en espera de segmentos [${pedido.id}]`);
    }
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
        ...hwEncoder.hwaccelArgs,
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
  hwEncoder = await detectarEncoder();
  await iniciarServidorOverlay();
  tickGrabacion();
  inicializarSegmentosProcessados();
  tickSegmentos();
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

// Pre-procesar segmentos cerrados cada minuto
setInterval(tickSegmentos, 60 * 1000);

// Procesar pedidos de clip cada 15 segundos
setInterval(procesarPedidosClip, 15 * 1000);

// Procesar highlight clips cada 5 segundos
setInterval(procesarHighlights, 5 * 1000);

// Procesar clip verticales (editor) cada 10 segundos
setInterval(procesarClipJobs, 10 * 1000);

// Verificar streams cada 30 segundos
setInterval(verificarStreams, 30 * 1000);

// Limpiar segmentos viejos cada 6 horas
setInterval(limpiarSegmentosViejos, 6 * 60 * 60 * 1000);
