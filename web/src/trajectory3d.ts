// 3D cognitive-state trajectory on a 2D canvas (dependency-free).
// Ported in spirit from eeg_roomba/frontend MindTrajectory3D (three.js) but
// hand-rolled with manual rotation + perspective projection.
//
// Axes of the unit cube (centered at origin):
//   x = focus  β/(α+θ) normalized 0..1
//   y = time   oldest (bottom) → newest (top)
//   z = relax  α/(α+β) 0..1
// The path is a vertex-colored ribbon (amber=focus, blue=relax); the current
// state is a glowing head sphere with a dropline to the floor grid.

const TILT = -0.5;
const VIEWER_Z = 3.4;
const FOCAL = 2.2;
const FOCUS_MAX = 2; // β/(α+θ) typically lives in 0..~2

type V3 = [number, number, number];

function rotY(p: V3, a: number): V3 {
  const [x, y, z] = p;
  return [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)];
}
function tiltX(p: V3, t: number): V3 {
  const [x, y, z] = p;
  return [x, y * Math.cos(t) - z * Math.sin(t), y * Math.sin(t) + z * Math.cos(t)];
}

export interface MindPoint {
  focus: number;
  relax: number;
}

export class Trajectory3D {
  private angle = 0;
  private history: MindPoint[] = [];
  private raf = 0;
  private running = false;
  private lastT = 0;
  private maxLen = 300;

  constructor(private canvas: HTMLCanvasElement) {}

  push(p: MindPoint): void {
    this.history.push(p);
    if (this.history.length > this.maxLen) this.history.shift();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      const dt = this.lastT ? (t - this.lastT) / 1000 : 0;
      this.lastT = t;
      this.angle += dt * 0.28;
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

  private project(p: V3): { x: number; y: number; depth: number } {
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
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42;
    const toPx = (pt: { x: number; y: number }) => ({ x: cx + pt.x * R, y: cy + pt.y * R });

    // Floor grid at y=-0.5 (the focus×relax plane).
    ctx.strokeStyle = "rgba(148,163,184,0.16)";
    ctx.lineWidth = 1;
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const u = i / N - 0.5;
      const a1 = toPx(this.project([u, -0.5, -0.5]));
      const a2 = toPx(this.project([u, -0.5, 0.5]));
      const b1 = toPx(this.project([-0.5, -0.5, u]));
      const b2 = toPx(this.project([0.5, -0.5, u]));
      ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke();
    }

    // Axis lines from the floor origin corner.
    const axis = (to: V3, color: string) => {
      const o = toPx(this.project([-0.5, -0.5, -0.5]));
      const e = toPx(this.project(to));
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(e.x, e.y); ctx.stroke();
      return e;
    };
    const eFocus = axis([0.5, -0.5, -0.5], "#f59e0b");
    const eTime = axis([-0.5, 0.5, -0.5], "#94a3b8");
    const eRelax = axis([-0.5, -0.5, 0.5], "#22c55e");
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "#f59e0b"; ctx.fillText("focus", eFocus.x + 2, eFocus.y);
    ctx.fillStyle = "#94a3b8"; ctx.fillText("time", eTime.x + 2, eTime.y);
    ctx.fillStyle = "#22c55e"; ctx.fillText("relax", eRelax.x + 2, eRelax.y);

    if (this.history.length < 2) {
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "center";
      ctx.fillText("軌跡を蓄積中…", cx, cy);
      ctx.textAlign = "start";
      return;
    }

    // Build cube points + colors.
    const n = this.history.length;
    const pts: { x: number; y: number; depth: number }[] = [];
    const cols: string[] = [];
    for (let i = 0; i < n; i++) {
      const xNorm = Math.max(0, Math.min(1, this.history[i].focus / FOCUS_MAX));
      const zNorm = Math.max(0, Math.min(1, this.history[i].relax));
      const yNorm = i / (n - 1);
      pts.push(this.project([xNorm - 0.5, yNorm - 0.5, zNorm - 0.5]));
      const r = Math.round(90 + 150 * xNorm);
      const g = Math.round(120 + 60 * yNorm);
      const b = Math.round(90 + 150 * zNorm);
      cols.push(`rgb(${r},${g},${b})`);
    }

    // Ribbon: draw as connected segments, older = fainter.
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    for (let i = 1; i < n; i++) {
      ctx.strokeStyle = cols[i];
      ctx.globalAlpha = 0.25 + 0.75 * (i / (n - 1));
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Head: dropline to floor + glowing sphere.
    const last = this.history[n - 1];
    const hx = Math.max(0, Math.min(1, last.focus / FOCUS_MAX)) - 0.5;
    const hz = Math.max(0, Math.min(1, last.relax)) - 0.5;
    const headTop = pts[n - 1];
    const headFloor = toPx(this.project([hx, -0.5, hz]));
    ctx.strokeStyle = "rgba(148,163,184,0.5)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(headFloor.x, headFloor.y); ctx.lineTo(headTop.x, headTop.y); ctx.stroke();
    ctx.setLineDash([]);

    const col = cols[n - 1];
    const rad = 6 * (FOCAL / headTop.depth);
    const glow = ctx.createRadialGradient(headTop.x, headTop.y, 0, headTop.x, headTop.y, rad * 3);
    glow.addColorStop(0, col.replace("rgb", "rgba").replace(")", ",0.5)"));
    glow.addColorStop(1, col.replace("rgb", "rgba").replace(")", ",0)"));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(headTop.x, headTop.y, rad * 3, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(headTop.x, headTop.y, rad, 0, 2 * Math.PI); ctx.fill();
  }
}
