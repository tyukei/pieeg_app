// PiEEG-16 channel → 10-20 electrode positions (2D scalp + 3D dome).
// Ported from eeg_roomba/frontend/src/montage.ts, framework-free.
//
// Unit circle: +x = right ear, +y = nose (front). radius 1 = head edge.
// pos3 lifts (x, y) onto the upper hemisphere for the 3D view.

export type Region = "frontal" | "central" | "parietal" | "occipital" | "temporal";

export interface Electrode {
  ch: number;
  name: string; // 10-20 label
  x: number; // -1..+1 (right positive)
  y: number; // -1..+1 (front positive)
  pos3: [number, number, number]; // right, up, forward
  region: Region;
}

const POS: Record<string, [number, number]> = {
  Fp1: [-0.27, 0.95], Fp2: [0.27, 0.95],
  F7: [-0.8, 0.59], F3: [-0.4, 0.55], Fz: [0, 0.55], F4: [0.4, 0.55], F8: [0.8, 0.59],
  T7: [-1.0, 0.0], C3: [-0.5, 0.0], Cz: [0, 0], C4: [0.5, 0.0], T8: [1.0, 0.0],
  P7: [-0.8, -0.59], P3: [-0.4, -0.55], Pz: [0, -0.55], P4: [0.4, -0.55], P8: [0.8, -0.59],
  O1: [-0.27, -0.95], O2: [0.27, -0.95],
};

const REGION: Record<string, Region> = {
  Fp1: "frontal", Fp2: "frontal", F7: "frontal", F3: "frontal", Fz: "frontal", F4: "frontal", F8: "frontal",
  T7: "temporal", T8: "temporal", P7: "temporal", P8: "temporal",
  C3: "central", Cz: "central", C4: "central",
  P3: "parietal", Pz: "parietal", P4: "parietal",
  O1: "occipital", O2: "occipital",
};

// Chip A (ch0-7) → frontal/central. Chip B (ch8-15) → temporal/parietal/occipital.
const DEFAULT_LABELS = [
  "Fp1", "Fp2", "F3", "F4", "C3", "C4", "O1", "O2",
  "F7", "F8", "T7", "T8", "P7", "P8", "P3", "P4",
];

const SPHERE_RADIUS = 1.0;
function lift3D(x: number, y: number): [number, number, number] {
  const planar = Math.min(1, x * x + y * y);
  const up = Math.sqrt(Math.max(0, 1 - planar));
  return [x * SPHERE_RADIUS, up * SPHERE_RADIUS, y * SPHERE_RADIUS];
}

export const MONTAGE: Electrode[] = DEFAULT_LABELS.map((name, ch) => {
  const [x, y] = POS[name];
  return { ch, name, x, y, pos3: lift3D(x, y), region: REGION[name] };
});
