// 2D scalp topography: inverse-distance-weighted interpolation of per-channel
// band power over a head disk, drawn as a heatmap with electrode markers.
//
// Interpolation runs on a small offscreen grid (cheap) then scales up smoothly.

import { MONTAGE } from "./montage";

const GRID = 72; // offscreen interpolation resolution

// Jet-ish colormap: t in [0,1] → [r,g,b].
function colormap(t: number): [number, number, number] {
  t = Math.max(0, Math.min(1, t));
  // blue → cyan → green → yellow → red
  const stops: [number, number[]][] = [
    [0.0, [30, 60, 180]],
    [0.25, [30, 180, 200]],
    [0.5, [40, 200, 90]],
    [0.75, [240, 210, 60]],
    [1.0, [230, 60, 50]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + f * (c1[0] - c0[0])),
        Math.round(c0[1] + f * (c1[1] - c0[1])),
        Math.round(c0[2] + f * (c1[2] - c0[2])),
      ];
    }
  }
  return [230, 60, 50];
}

let offscreen: HTMLCanvasElement | null = null;

// perCh: band power per channel (length 16). Normalized min-max across channels.
export function drawTopography(canvas: HTMLCanvasElement, perCh: number[]): void {
  const dpr = window.devicePixelRatio || 1;
  const size = Math.min(canvas.clientWidth || 260, canvas.clientHeight || 260);
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  if (!perCh || perCh.length < MONTAGE.length) return;

  const lo = Math.min(...perCh);
  const hi = Math.max(...perCh);
  const span = hi - lo || 1;
  const norm = perCh.map((v) => (v - lo) / span);

  // Interpolate on the offscreen grid.
  if (!offscreen) offscreen = document.createElement("canvas");
  offscreen.width = GRID;
  offscreen.height = GRID;
  const octx = offscreen.getContext("2d")!;
  const img = octx.createImageData(GRID, GRID);
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      // map grid → unit square [-1,1]; +y up = front
      const ux = (gx / (GRID - 1)) * 2 - 1;
      const uy = 1 - (gy / (GRID - 1)) * 2;
      const idx = (gy * GRID + gx) * 4;
      if (ux * ux + uy * uy > 1.02) {
        img.data[idx + 3] = 0; // outside head → transparent
        continue;
      }
      let wsum = 0;
      let vsum = 0;
      for (let e = 0; e < MONTAGE.length; e++) {
        const dx = ux - MONTAGE[e].x;
        const dy = uy - MONTAGE[e].y;
        const d2 = dx * dx + dy * dy + 1e-4;
        const w = 1 / (d2 * d2); // IDW power 4 → tighter foci
        wsum += w;
        vsum += w * norm[e];
      }
      const [r, g, b] = colormap(vsum / wsum);
      img.data[idx] = r;
      img.data[idx + 1] = g;
      img.data[idx + 2] = b;
      img.data[idx + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);

  // Clip to head circle and draw the scaled heatmap.
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.42;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(offscreen, cx - R, cy - R, R * 2, R * 2);
  ctx.restore();

  // Head outline, nose, ears.
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.stroke();
  ctx.beginPath(); // nose
  ctx.moveTo(cx - R * 0.13, cy - R);
  ctx.lineTo(cx, cy - R * 1.16);
  ctx.lineTo(cx + R * 0.13, cy - R);
  ctx.stroke();
  for (const s of [-1, 1]) {
    ctx.beginPath(); // ears
    ctx.arc(cx + s * R, cy, R * 0.13, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // Electrode markers + labels.
  ctx.font = "9px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let e = 0; e < MONTAGE.length; e++) {
    const el = MONTAGE[e];
    const px = cx + el.x * R;
    const py = cy - el.y * R;
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, 2 * Math.PI);
    ctx.fillStyle = "#0b1120";
    ctx.fill();
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#e5e7eb";
    ctx.fillText(el.name, px, py - 9);
  }
}

export { colormap };
