const { launch } = require('./lib.cjs'); const fs = require('fs');
const cols = JSON.parse(process.argv[2]); // [[tag,mode,label],...]
const outDir = process.argv[3]; const R = {}; for (const [t] of cols) R[t] ||= JSON.parse(fs.readFileSync(`res_${t}.json`));
(async () => { const { b, p } = await launch(); await p.evaluate(() => ready());
  const FR = Object.keys(R[cols[0][0]].box);
  for (const f of FR) { await p.evaluate(t => grab(t), +f); const jpg = await p.evaluate(t => jpg(t), +f); const box = R[cols[0][0]].box[f];
    const masks = cols.map(([t, m, label]) => ({ label, bits: R[t].decode[m][f].bits, ms: R[t].decode[m][f].ms }));
    const png = await p.evaluate(async ({ jpg, box, masks }) => {
      const img = new Image(); img.src = jpg; await img.decode(); const W = img.width, H = img.height;
      const bw = box.x2 - box.x1, bh = box.y2 - box.y1, cs = Math.max(bw, bh) * 2.2 + 40; let cx0 = Math.max(0, Math.min(W - cs, (box.x1 + box.x2) / 2 - cs / 2)), cy0 = Math.max(0, Math.min(H - cs, (box.y1 + box.y2) / 2 - cs / 2));
      const S = 260, cvs = document.createElement('canvas'); cvs.width = S * (masks.length + 1); cvs.height = S + 20; const g = cvs.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, cvs.width, cvs.height);
      const mk = document.createElement('canvas'); mk.width = W; mk.height = H;
      const draw = (i, label, bits) => { g.drawImage(img, cx0, cy0, cs, cs, i * S, 20, S, S);
        if (bits) { const bin = atob(bits); const id = new ImageData(W, H); for (let k = 0; k < W * H; k++) if ((bin.charCodeAt(k >> 3) >> (k & 7)) & 1) { id.data[k * 4] = 255; id.data[k * 4 + 1] = 40; id.data[k * 4 + 2] = 40; id.data[k * 4 + 3] = 150; } mk.getContext('2d').putImageData(id, 0, 0); g.drawImage(mk, cx0, cy0, cs, cs, i * S, 20, S, S); }
        g.strokeStyle = '#0f0'; g.lineWidth = 1; const k = S / cs; g.strokeRect(i * S + (box.x1 - cx0) * k, 20 + (box.y1 - cy0) * k, bw * k, bh * k);
        g.fillStyle = '#fff'; g.font = '13px sans-serif'; g.fillText(label, i * S + 4, 14); };
      draw(0, 'frame + D-FINE box', null); masks.forEach((m, i) => draw(i + 1, m.label + (m.bits ? '' : ' (NONE)'), m.bits));
      return cvs.toDataURL('image/png'); }, { jpg, box, masks });
    fs.writeFileSync(`${outDir}/frame_${f.replace('.', '_')}s.png`, Buffer.from(png.split(',')[1], 'base64')); }
  await b.close(); })();
