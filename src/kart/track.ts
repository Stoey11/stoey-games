import * as THREE from "three";

// Banedefinitioner for kart-racing. Kontrolpunkter danner en lukket kurve.

export interface TrackDef {
  name: string;
  points: [number, number][]; // lukket løkke (x, z)
  width: number; // vejbredde
  boosts: number[]; // boost-felter som t-positioner (0-1)
  lake?: { x: number; z: number; r: number };
  laps: number;
  sky: number;
  grass: number;
}

export const TRACKS: TrackDef[] = [
  {
    name: "Skovbanen",
    points: [
      [0, 0],
      [70, -8],
      [130, -45],
      [150, -110],
      [120, -175],
      [50, -195],
      [-10, -160],
      [-70, -195],
      [-135, -170],
      [-155, -100],
      [-120, -35],
      [-55, 5],
    ],
    width: 13,
    boosts: [0.22, 0.55, 0.8],
    laps: 3,
    sky: 0x9fd3f0,
    grass: 0x4a9440,
  },
  {
    name: "Søbanen",
    points: [
      [0, 0],
      [85, 10],
      [140, -30],
      [135, -95],
      [80, -120],
      [90, -180],
      [40, -220],
      [-40, -210],
      [-70, -150],
      [-130, -120],
      [-140, -55],
      [-85, -5],
    ],
    width: 11.5,
    boosts: [0.3, 0.62, 0.9],
    lake: { x: 0, z: -110, r: 55 },
    laps: 3,
    sky: 0x8ecdf0,
    grass: 0x53a34a,
  },
];

export interface SampledTrack {
  def: TrackDef;
  pts: THREE.Vector3[];
  tans: THREE.Vector3[];
  n: number;
  totalLen: number;
}

export function sampleTrack(def: TrackDef, n = 500): SampledTrack {
  const curve = new THREE.CatmullRomCurve3(
    def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    true,
    "catmullrom",
    0.6
  );
  const pts: THREE.Vector3[] = [];
  const tans: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    pts.push(curve.getPoint(t));
    tans.push(curve.getTangent(t).setY(0).normalize());
  }
  let totalLen = 0;
  for (let i = 0; i < n; i++) totalLen += pts[i].distanceTo(pts[(i + 1) % n]);
  return { def, pts, tans, n, totalLen };
}

/** Nærmeste sample-indeks; søger lokalt omkring et hint for hastighed. */
export function nearestIdx(st: SampledTrack, x: number, z: number, hint: number): number {
  const n = st.n;
  let best = hint;
  let bestD = Infinity;
  for (let off = -12; off <= 12; off++) {
    const i = (hint + off + n) % n;
    const p = st.pts[i];
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Fuld søgning (bruges ved start/reset). */
export function nearestIdxFull(st: SampledTrack, x: number, z: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < st.n; i++) {
    const p = st.pts[i];
    const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
