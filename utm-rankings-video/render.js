// Renders index.html frame by frame to an MP4 (1920x1080, 30 fps).
// Usage: node render.js [out.mp4] [--stills t1,t2,...]
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const FPS = 30;
const args = process.argv.slice(2);
const stillsArg = args.indexOf('--stills');
const out = args.find(a => a.endsWith('.mp4')) || path.join(__dirname, 'UTM-Rankings-2026.mp4');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(__dirname, 'index.html') + '?capture');
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(() => window.DURATION);

  if (stillsArg !== -1) {
    const dir = path.join(__dirname, 'stills'); fs.mkdirSync(dir, { recursive: true });
    for (const t of args[stillsArg + 1].split(',').map(Number)) {
      await page.evaluate(t => window.renderAt(t), t);
      await page.screenshot({ path: path.join(dir, `t${t}.png`) });
    }
    await browser.close(); return;
  }

  const total = Math.round(duration * FPS);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
    { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = 0; f < total; f++) {
    await page.evaluate(t => window.renderAt(t), f / FPS);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (f % 150 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await browser.close();

  // Optional soundtrack: drop the instrumental into assets/ as music.mp3 / .m4a / .wav.
  // It is trimmed (or looped) to the video length, with a 1s fade-in and 2.5s fade-out.
  const music = ['mp3', 'm4a', 'wav', 'aac'].map(e => path.join(__dirname, 'assets', 'music.' + e)).find(f => fs.existsSync(f));
  if (music) {
    const tmp = out.replace(/\.mp4$/, '.silent.mp4');
    fs.renameSync(out, tmp);
    const fadeOut = Math.max(0, duration - 2.5).toFixed(2);
    const mux = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-stream_loop', '-1', '-i', music,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
      '-af', `afade=t=in:d=1,afade=t=out:st=${fadeOut}:d=2.5`, '-t', duration.toFixed(2), '-movflags', '+faststart', out],
      { stdio: 'inherit' });
    await new Promise(r => mux.on('close', r));
    fs.unlinkSync(tmp);
    console.log('added soundtrack', path.basename(music));
  }
  console.log('done', out, `${duration.toFixed(1)}s`);
})();
