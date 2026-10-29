// Renderiza una escena del video: abre la página en Chrome, captura cada cuadro (window.seek(t)) y lo manda a ffmpeg junto con la voz.
// Uso:
//   node video/render/render.mjs bloque4 --stills 1.5,4.8,11.5     (solo imágenes sueltas para revisar el diseño)
//   node video/render/render.mjs bloque4                            (mp4 completo en video/out/bloque4.mp4)
// ffmpeg: FFMPEG=/ruta/ffmpeg (por defecto "ffmpeg").
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { launchChrome } from '../../scripts/lib-cdp.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG ?? 'ffmpeg';
const FPS = 30;
const W = 1080;
const H = 1920;

const ESCENAS = {
  full: { html: 'video.html', full: true },
  bloque4: {
    html: 'bloque4.html',
    voz: '../elevenlabs/Bloque4.mp3',
    duracion: 24.45,
    // Sonidos: [segundo, tipo]. t = tic, p = pop de la caja, c = acorde de la devolución, w = ding de la lista de espera.
    sfx: [[3.3, 't'], [4.5, 'p'], [7.8, 't'], [8.6, 'p'], [10.2, 't'], [11.0, 'p'], [12.9, 't'], [16.6, 't'], [17.9, 'c'], [23.3, 'w']],
  },
};

const nombre = process.argv[2];
let escena = ESCENAS[nombre];
if (!escena) { console.error(`Escenas: ${Object.keys(ESCENAS).join(', ')}`); process.exit(1); }
const stillsArg = process.argv.indexOf('--stills');
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : null;
const OUT = join(AQUI, '..', 'out');
mkdirSync(OUT, { recursive: true });

const chrome = await launchChrome();
const page = await chrome.newPage({ width: W, height: H });
try {
  await page.goto(pathToFileURL(join(AQUI, escena.html)).href);
  if (page.problems.length) throw new Error(page.problems.join('\n'));
  if (escena.full) {
    const tl = await page.evaluate('window.TIMELINE');
    escena = { ...escena, duracion: tl.end, tl };
  }

  if (stills) {
    for (const t of stills) {
      await page.evaluate(`window.seek(${t})`);
      const { data } = await page.cmd('Page.captureScreenshot', { format: 'png' });
      const f = join(OUT, `${nombre}-t${String(t).replace('.', '_')}.png`);
      writeFileSync(f, Buffer.from(data, 'base64'));
      console.log(f);
    }
  } else {
    const audio = escena.full ? mezclarTodo(escena) : mezclarAudio(escena);
    const mp4 = join(OUT, `${nombre}.mp4`);
    const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-i', audio,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', mp4],
    { stdio: ['pipe', 'inherit', 'inherit'] });
    const total = Math.round(escena.duracion * FPS);
    for (let i = 0; i < total; i++) {
      await page.evaluate(`window.seek(${(i / FPS).toFixed(4)})`);
      const { data } = await page.cmd('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      if (!ff.stdin.write(Buffer.from(data, 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
      if (i % 90 === 0) console.log(`cuadro ${i}/${total}`);
    }
    ff.stdin.end();
    await new Promise((resolve, reject) => { ff.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`ffmpeg salió con ${c}`)))); });
    console.log(`Listo: ${mp4}`);
  }
} finally {
  await page.close();
  await chrome.close();
}

/** Voz a -14 LUFS + colchón grave muy bajo + efectos cortos sincronizados. Devuelve la ruta del wav. */
function mezclarAudio(e) {
  const voz = join(AQUI, e.voz);
  const wav = join(OUT, `${nombre}-audio.wav`);
  const entradas = ['-i', voz];
  const filtros = [];
  const etiquetas = ['[v]'];
  filtros.push('[0:a]loudnorm=I=-14:TP=-1.5:LRA=3,aformat=sample_rates=48000:channel_layouts=stereo[v]');
  // Colchón: dos senos graves con un lowpass, a -34 dB
  entradas.push('-f', 'lavfi', '-t', String(e.duracion), '-i', 'sine=f=110', '-f', 'lavfi', '-t', String(e.duracion), '-i', 'sine=f=164.8');
  filtros.push('[1:a][2:a]amix=inputs=2:normalize=0,lowpass=f=400,volume=0.025,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=1.5,afade=t=out:st=' + (e.duracion - 1.5) + ':d=1.5[pad]');
  etiquetas.push('[pad]');
  const TIPOS = {
    t: { f: 1400, d: 0.05, vol: 0.12 },
    p: { f: 720, d: 0.14, vol: 0.14 },
    c: { f: 523.25, d: 0.7, vol: 0.12, extra: [659.25, 783.99] },
    w: { f: 880, d: 0.4, vol: 0.12 },
  };
  let n = 3;
  e.sfx.forEach(([s, tipo], i) => {
    const d = TIPOS[tipo];
    const freqs = [d.f, ...(d.extra ?? [])];
    freqs.forEach((f, j) => {
      entradas.push('-f', 'lavfi', '-t', String(d.d), '-i', `sine=f=${f}`);
      const ms = Math.round(s * 1000);
      filtros.push(`[${n}:a]afade=t=out:st=0:d=${d.d},volume=${d.vol / freqs.length * 1.6},aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[x${i}_${j}]`);
      etiquetas.push(`[x${i}_${j}]`);
      n += 1;
    });
  });
  filtros.push(`${etiquetas.join('')}amix=inputs=${etiquetas.length}:normalize=0:duration=longest,alimiter=limit=0.89,atrim=0:${e.duracion}[out]`);
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...entradas, '-filter_complex', filtros.join(';'), '-map', '[out]', '-ar', '48000', wav]);
  return wav;
}

/** Video completo: las 8 voces en su sitio (con 0,15 s de margen), colchón y efectos de cada escena. */
function mezclarTodo(e) {
  const { tl } = e;
  const wav = join(OUT, 'video-audio.wav');
  const entradas = []; const filtros = []; const vz = [];
  for (let i = 0; i < 8; i++) {
    entradas.push('-i', join(AQUI, `../elevenlabs/Bloque${i + 1}.mp3`));
    const ms = Math.round((tl.starts[i] + tl.offset) * 1000);
    filtros.push(`[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
    vz.push(`[v${i}]`);
  }
  filtros.push(`${vz.join('')}amix=inputs=8:normalize=0:duration=longest,loudnorm=I=-14:TP=-1.5:LRA=3[voz]`);
  entradas.push('-f', 'lavfi', '-t', String(e.duracion), '-i', 'sine=f=110', '-f', 'lavfi', '-t', String(e.duracion), '-i', 'sine=f=164.8');
  filtros.push(`[8:a][9:a]amix=inputs=2:normalize=0,lowpass=f=400,volume=0.025,aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=2,afade=t=out:st=${e.duracion - 2.5}:d=2.5[pad]`);
  const etiquetas = ['[voz]', '[pad]'];
  const TIPOS = { t: { f: 1400, d: 0.05, vol: 0.12 }, p: { f: 720, d: 0.14, vol: 0.14 }, c: { f: 523.25, d: 0.7, vol: 0.12, extra: [659.25, 783.99] }, w: { f: 880, d: 0.4, vol: 0.12 } };
  let n = 10; let k = 0;
  tl.scenes.forEach((sc, i) => {
    for (const [s, tipo] of sc.sfx) {
      const d = TIPOS[tipo]; const freqs = [d.f, ...(d.extra ?? [])];
      const ms = Math.round((tl.starts[i] + tl.offset + s) * 1000);
      freqs.forEach((f) => {
        entradas.push('-f', 'lavfi', '-t', String(d.d), '-i', `sine=f=${f}`);
        filtros.push(`[${n}:a]afade=t=out:st=0:d=${d.d},volume=${d.vol / freqs.length * 1.6},aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms}[x${k}]`);
        etiquetas.push(`[x${k}]`); n += 1; k += 1;
      });
    }
  });
  filtros.push(`${etiquetas.join('')}amix=inputs=${etiquetas.length}:normalize=0:duration=longest,alimiter=limit=0.89,atrim=0:${e.duracion}[out]`);
  const script = join(OUT, 'video-filtros.txt');
  writeFileSync(script, filtros.join(';\n'));
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...entradas, '-filter_complex_script', script, '-map', '[out]', '-ar', '48000', wav], { maxBuffer: 1 << 26 });
  return wav;
}
