// 3D cognitive-state trajectory on a 2D canvas (dependency-free).
// Ported in spirit from eeg_roomba/frontend MindTrajectory3D (three.js) but
// hand-rolled with manual rotation + perspective projection.
//
// Axes of the unit cube (centered at origin):
//   x = focus  β/(α+θ) normalized 0..1  (horizontal)
//   y = relax  α/(α+β) 0..1             (vertical, up = relaxed)
//   z = time   oldest (back) → newest (front, toward viewer)
// The cognitive state wanders across the focus×relax face while the path
// extrudes forward through time along z — so the curve genuinely coils in 3D
// instead of collapsing onto the time axis. The current state is a glowing
// head sphere with a dropline to the floor grid.

const TILT = -0.42;
const VIEWER_Z = 3.6;
const FOCAL = 2.3;
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
  private angle = 0.5; // start at a 3/4 view so depth is legible immediately
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
      // Gentle sway around the vertical axis so the z (time) depth stays readable.
      this.angle += dt * 0.18;
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
    const R = Math.min(w, h) * 0.46;
    const toPx = (pt: { x: number; y: number }) => ({ x: cx + pt.x * R, y: cy + pt.y * R });
    const line = (a: V3, b: V3, color: string, lw = 1) => {
      const pa = toPx(this.project(a));
      const pb = toPx(this.project(b));
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    };

    // Bounding-cube wireframe so the 3D volume reads clearly.
    const s = 0.5;
    const corners: V3[] = [
      [-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s],
      [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s],
    ];
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    for (const [i, j] of edges) line(corners[i], corners[j], "rgba(148,163,184,0.12)");

    // Floor grid at y=-0.5 (the focus × time plane).
    ctx.strokeStyle = "rgba(148,163,184,0.16)";
    ctx.lineWidth = 1;
    const N = 8;
    for (let i = 0; i <= N; i++) {
      const u = i / N - 0.5;
      line([u, -0.5, -0.5], [u, -0.5, 0.5], "rgba(148,163,184,0.14)");
      line([-0.5, -0.5, u], [0.5, -0.5, u], "rgba(148,163,184,0.14)");
    }

    // Axis lines from the floor origin corner: focus (x), relax (y), time (z).
    const drawAxis = (to: V3, color: string, label: string) => {
      const o: V3 = [-0.5, -0.5, -0.5];
      line(o, to, color, 1.6);
      const e = toPx(this.project(to));
      ctx.fillStyle = color;
      ctx.font = "11px system-ui, sans-serif";
      ctx.fillText(label, e.x + 3, e.y);
    };
    drawAxis([0.5, -0.5, -0.5], "#f59e0b", "focus");
    drawAxis([-0.5, 0.5, -0.5], "#22c55e", "relax");
    drawAxis([-0.5, -0.5, 0.5], "#38bdf8", "time →");

    if (this.history.length < 2) {
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "center";
      ctx.fillText("軌跡を蓄積中…", cx, cy);
      ctx.textAlign = "start";
      return;
    }

    // Auto-scale focus & relax to their range within the window so the small
    // absolute swings become a visible wandering across the focus×relax face
    // (otherwise the path collapses onto the time axis — a near-straight line).
    const n = this.history.length;
    const fVals = this.history.map((p) => Math.max(0, Math.min(1, p.focus / FOCUS_MAX)));
    const rVals = this.history.map((p) => Math.max(0, Math.min(1, p.relax)));
    const rangeOf = (vals: number[]): [number, number] => {
      let lo = Math.min(...vals);
      let hi = Math.max(...vals);
      const span = hi - lo;
      const MIN_SPAN = 0.12;
      if (span < MIN_SPAN) {
        const mid = (lo + hi) / 2;
        lo = mid - MIN_SPAN / 2;
        hi = mid + MIN_SPAN / 2;
      } else {
        lo -= span * 0.1;
        hi += span * 0.1;
      }
      return [lo, hi];
    };
    const [fLo, fHi] = rangeOf(fVals);
    const [rLo, rHi] = rangeOf(rVals);
    const scale = (v: number, lo: number, hi: number) =>
      Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));

    // Map each sample into the cube: x=focus, y=relax, z=time (oldest→newest).
    // Store PIXEL coords (toPx of the projection) + depth for head sizing.
    const pts: { x: number; y: number; depth: number }[] = [];
    const cols: string[] = [];
    const norm: { x: number; y: number; z: number }[] = [];
    for (let i = 0; i < n; i++) {
      const x = scale(fVals[i], fLo, fHi);
      const y = scale(rVals[i], rLo, rHi);
      const z = i / (n - 1);
      norm.push({ x, y, z });
      const pr = this.project([x - 0.5, y - 0.5, z - 0.5]);
      const px = toPx(pr);
      pts.push({ x: px.x, y: px.y, depth: pr.depth });
      const r = Math.round(70 + 170 * x);
      const g = Math.round(110 + 120 * y);
      const b = Math.round(130 + 110 * y);
      cols.push(`rgb(${r},${g},${b})`);
    }

    // Ribbon: draw back (oldest) → front (newest) so nearer segments overdraw.
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (let i = 1; i < n; i++) {
      ctx.strokeStyle = cols[i];
      ctx.globalAlpha = 0.22 + 0.78 * (i / (n - 1));
      ctx.beginPath();
      ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
      ctx.lineTo(pts[i].x, pts[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Head: dropline to floor + glowing sphere at the newest sample.
    const head = norm[n - 1];
    const headTop = pts[n - 1];
    const headFloor = toPx(this.project([head.x - 0.5, -0.5, head.z - 0.5]));
    ctx.strokeStyle = "rgba(148,163,184,0.5)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(headFloor.x, headFloor.y);
    ctx.lineTo(headTop.x, headTop.y);
    ctx.stroke();
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
