// Static server for the skeleton benchmark page. Usage:
//   CLIP=/abs/path/clip.webm node scripts/skeleton-bench/server.js   (port 3099)
// Chromium (Playwright) cannot decode H.264: transcode first, e.g.
//   ffmpeg -i in.mp4 -c:v libvpx-vp9 -b:v 4M -an clip.webm
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const CLIP = process.env.CLIP;
const map = (u) => {
  if (u === '/' || u === '/harness.html') return path.join(__dirname, 'harness.html');
  if (u === '/vision_bundle.mjs') return path.join(ROOT, 'node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
  if (u.startsWith('/mediapipe-wasm/') || u.startsWith('/models/')) return path.join(ROOT, 'public', u);
  if (u === '/clip.webm') return CLIP;
  return null;
};
http.createServer((req, res) => {
  const f = map(req.url.split('?')[0]);
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const st = fs.statSync(f);
  const type = /\.m?js$/.test(f) ? 'text/javascript' : f.endsWith('.wasm') ? 'application/wasm' : f.endsWith('.html') ? 'text/html' : f.endsWith('.webm') ? 'video/webm' : 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range); const s = +m[1], e = m[2] ? +m[2] : st.size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 });
    fs.createReadStream(f, { start: s, end: e }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(f).pipe(res);
  }
}).listen(3099, () => console.log('skeleton-bench server on :3099, clip=' + CLIP));
