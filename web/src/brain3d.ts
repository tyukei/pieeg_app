// Dependency-free 3D electrode dome on a 2D canvas: manual rotation + perspective
// projection, depth-sorted electrodes sized/colored by band power. Self-animates
// via requestAnimationFrame so rotation is smooth regardless of data rate.
//
// Coords: x = right, y = up, z = forward (nose). We spin around the up axis and
// tilt slightly for a 3/4 view.

import { MONTAGE } from "./montage";
import { colormap } from "./topography";

const TILT = -0.45; // radians, look down a little
const VIEWER_Z = 3.0; // camera distance
const FOCAL = 2.0;

function rotY(p: [number, number, number], a: number): [number, number, number] {
  const [x, y, z] = p;
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}
function tiltX(p: [number, number, number], t: number): [number, number, number] {
  const [x, y, z] = p;
  return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
}

export class Brain3D {
  private angle = 0;
  private perCh: number[] = new Array(MONTAGE.length).fill(0);
  private raf = 0;
  private running = false;
  private lastT = 0;

  constructor(private canvas: HTMLCanvasElement) {}

  setData(perCh: number[]): void {
    if (perCh && perCh.length >= MONTAGE.length) this.perCh = perCh;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
      this.lastT = t;
      this.angle += dt * 0.5; // ~0.5 rad/s
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    this.lastT = 0;
    if (this.raf) cancelAnimationFrame(this.raf);
  }

  private project(p: [number, number, number]): { x: number; y: number; depth: number } {
    const r = tiltX(rotY(p, this.angle), TILT);
    const depth = VIEWER_Z - r[2];
    const s = FOCAL / depth;
    return { x: r[0] * s, y: -r[1] * s, depth };
  }

  private draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 320;
    const h = this.canvas.clientHeight || 320;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    const ctx = this.canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2 + h * 0.06;
    const R = Math.min(w, h) * 0.54;
    const toPx = (pt: { x: number; y: number }) => ({ x: cx + pt.x * R, y: cy + pt.y * R });

    // Faint dome wireframe: latitude rings + longitude arcs (upper hemisphere).
    ctx.strokeStyle = "rgba(148,163,184,0.18)";
    ctx.lineWidth = 1;
    for (let lat = 0; lat <= 3; lat++) {
      const phi = (lat / 4) * (Math.PI / 2); // 0=top .. equator
      const y = Math.cos(phi);
      const rad = Math.sin(phi);
      ctx.beginPath();
      for (let k = 0; k <= 48; k++) {
        const th = (k / 48) * 2 * Math.PI;
        const p = this.project([rad * Math.cos(th), y, rad * Math.sin(th)]);
        const px = toPx(p);
        k === 0 ? ctx.moveTo(px.x, px.y) : ctx.lineTo(px.x, px.y);
      }
      ctx.stroke();
    }
    for (let lon = 0; lon < 8; lon++) {
      const th = (lon / 8) * 2 * Math.PI;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const phi = (k / 24) * (Math.PI / 2);
        const p = this.project([Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)]);
        const px = toPx(p);
        k === 0 ? ctx.moveTo(px.x, px.y) : ctx.lineTo(px.x, px.y);
      }
      ctx.stroke();
    }

    // Normalize band power across channels for color + size.
    const lo = Math.min(...this.perCh);
    const hi = Math.max(...this.perCh);
    const span = hi - lo || 1;

    // Depth-sort electrodes (far first) for correct overdraw.
    const items = MONTAGE.map((el) => {
      const p = this.project(el.pos3);
      const n = (this.perCh[el.ch] - lo) / span;
      return { el, p, n };
    }).sort((a, b) => b.p.depth - a.p.depth);

    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const { el, p, n } of items) {
      const px = toPx(p);
      const [r, g, b] = colormap(n);
      const rad = (4 + n * 9) * (FOCAL / p.depth);
      const glow = ctx.createRadialGradient(px.x, px.y, 0, px.x, px.y, rad * 2.4);
      glow.addColorStop(0, `rgba(${r},${g},${b},0.55)`);
      glow.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(px.x, px.y, rad * 2.4, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath();
      ctx.arc(px.x, px.y, rad, 0, 2 * Math.PI);
      ctx.fill();
      ctx.fillStyle = "rgba(226,232,240,0.85)";
      ctx.fillText(el.name, px.x, px.y - rad - 6);
    }
  }
}
