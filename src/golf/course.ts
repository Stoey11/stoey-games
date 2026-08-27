// 18-hullers bane inspireret af Silkeborg Golf Club (Resenbro):
// skovklædt, kuperet parkbane langs Gudenåen. Layoutet er en fri
// efterligning i stil og længder — ikke en opmåling af den rigtige bane.
//
// Koordinater pr. hul: tee i (0,0), hullet strækker sig mod -z. Meter.

export interface CircleZone {
  x: number;
  z: number;
  r: number;
}

export interface GolfHole {
  name: string;
  par: number;
  length: number; // officiel længde i meter
  waypoints: [number, number][]; // fairway-midterlinje, sidste punkt = green-center
  fairwayW: number; // fairway-bredde
  greenR: number;
  bunkers: CircleZone[];
  water: CircleZone[];
  elev: number; // greenens højde ift. tee (meter, negativ = nedad)
  hillAmp: number; // hvor kuperet terrænet er
  seed: number; // til bakker/træplacering
}

let holeCounter = 0;

function hole(
  name: string,
  par: number,
  waypoints: [number, number][],
  opts: Partial<Pick<GolfHole, "fairwayW" | "greenR" | "bunkers" | "water" | "elev" | "hillAmp">> = {}
): GolfHole {
  let length = 0;
  for (let i = 1; i < waypoints.length; i++) {
    length += Math.hypot(waypoints[i][0] - waypoints[i - 1][0], waypoints[i][1] - waypoints[i - 1][1]);
  }
  return {
    name,
    par,
    length: Math.round(length),
    waypoints,
    fairwayW: opts.fairwayW ?? 18,
    greenR: opts.greenR ?? 11,
    bunkers: opts.bunkers ?? [],
    water: opts.water ?? [],
    elev: opts.elev ?? 0,
    hillAmp: opts.hillAmp ?? 2.6,
    seed: (holeCounter++) * 7.31 + 2.17,
  };
}

// Hjælper: greenside-bunkere i forhold til green-center
const gb = (gx: number, gz: number, dx: number, dz: number, r = 5): CircleZone => ({ x: gx + dx, z: gz + dz, r });

export const COURSE: GolfHole[] = [
  // Opmålt: 266 m, næsten fladt (+1) — kort åbningshul med let sving
  hole("Åbningen", 4, [[0, 0], [5, -130], [-12, -266]], {
    bunkers: [{ x: 10, z: -150, r: 5 }, gb(-12, -266, -12, 4), gb(-12, -266, 11, 3)],
  }),
  // Opmålt: ca. 390 m, +6 m op mod green, let dogleg højre til sidst
  hole("Alléen", 4, [[0, 0], [0, -200], [12, -390]], {
    bunkers: [{ x: -14, z: -210, r: 7 }, gb(12, -390, 13, 5), gb(12, -390, -11, 4)],
  }),
  // Opmålt: 184 m, let fald (−1) — par 3 ved klubhuset med bunkere foran green
  hole("Terrassen", 3, [[0, 0], [0, -184]], {
    greenR: 10,
    bunkers: [gb(0, -184, -11, 4), gb(0, -184, 10, 5)],
  }),
  // Opmålt på Google Maps: 472,79 m, ca. +17 m (stejlt op mod green til sidst)
  hole("Skovbrynet", 5, [[0, 0], [-10, -190], [-45, -350], [-50, -473]], {
    bunkers: [{ x: -28, z: -360, r: 7 }, gb(-50, -473, 12, 6), gb(-50, -473, -12, 3)],
  }),
  // Opmålt: 302 m, fladt — lige hul langs husene
  hole("Rævegraven", 4, [[0, 0], [-3, -160], [0, -302]], {
    fairwayW: 16,
    bunkers: [{ x: 12, z: -170, r: 6 }, gb(0, -302, -11, 5), gb(0, -302, 10, 3)],
  }),
  // Opmålt: 273 m, −3,5 m — dogleg venstre ned mod green
  hole("Langager", 4, [[0, 0], [0, -150], [-20, -271]], {
    bunkers: [{ x: -12, z: -160, r: 5 }, gb(-20, -271, 12, 4)],
  }),
  // Opmålt: 179,6 m, let fald (−2) — søen ligger klos op ad greenen
  hole("Søgreenen", 3, [[0, 0], [0, -180]], {
    greenR: 10,
    water: [{ x: 20, z: -194, r: 13 }],
    bunkers: [gb(0, -180, -12, 2)],
  }),
  hole("Gudenåen", 5, [[0, 0], [15, -180], [-20, -360], [0, -500]], {
    bunkers: [{ x: 22, z: -195, r: 7 }, { x: -25, z: -370, r: 7 }, gb(0, -500, -12, 6)],
    water: [{ x: 45, z: -300, r: 30 }],
  }),
  // Opmålt: 375 m, fladt — søen ligger langs venstre side af fairwayen
  hole("Klubhuset", 4, [[0, 0], [-8, -200], [-28, -375]], {
    water: [{ x: -28, z: -185, r: 22 }],
    bunkers: [gb(-28, -375, -12, 4), gb(-28, -375, 12, 4)],
  }),
  // Opmålt: 342 m, fladt (+1) — samme sø langs venstre, let dogleg
  hole("Bøgetoppen", 4, [[0, 0], [-5, -180], [8, -342]], {
    water: [{ x: -26, z: -140, r: 20 }],
    bunkers: [{ x: 14, z: -200, r: 6 }, gb(8, -342, -11, 5)],
  }),
  // Opmålt: 149 m, ca. −7 m med en dal undervejs — green omkranset af bunkere
  hole("Kedlen", 3, [[0, 0], [0, -149]], {
    greenR: 9,
    bunkers: [gb(0, -149, -11, 0), gb(0, -149, 11, 0), gb(0, -149, 0, 11), gb(0, -149, 0, -11)],
  }),
  // Opmålt: 425 m, næsten fladt (+2 m) med lille stigning ved green
  hole("Fasanen", 4, [[0, 0], [-3, -210], [5, -425]], {
    bunkers: [{ x: 15, z: -235, r: 7 }, gb(5, -425, -12, 5)],
  }),
  // Opmålt: 478 m, +3 — langt par 5 med to sving og sø ved greenen
  hole("Bakkedalen", 5, [[0, 0], [5, -150], [-15, -320], [-38, -474]], {
    bunkers: [{ x: 18, z: -160, r: 6 }, { x: -28, z: -330, r: 7 }, gb(-38, -474, 12, 5)],
    water: [{ x: -60, z: -455, r: 18 }],
  }),
  // Opmålt: 275,5 m, ca. +15 m — smal skovkorridor, stejlt op mod green
  hole("Vovehalsen", 4, [[0, 0], [0, -140], [-8, -276]], {
    fairwayW: 15,
    bunkers: [gb(-8, -276, -12, 4), gb(-8, -276, 11, 3), { x: 6, z: -190, r: 5 }],
  }),
  // Opmålt: 169,8 m, ca. −9 m ned mod green
  hole("Lysningen", 3, [[0, 0], [0, -170]], {
    bunkers: [gb(0, -170, -12, 3), gb(0, -170, 13, -2)],
  }),
  // Opmålt: ca. 380 m, hele −20 m nedad gennem skovkorridoren
  hole("Egernet", 4, [[0, 0], [5, -190], [40, -377]], {
    bunkers: [{ x: 20, z: -210, r: 6 }, gb(40, -377, -12, 5)],
  }),
  hole("Møllebækken", 5, [[0, 0], [-5, -220], [0, -445]], {
    bunkers: [{ x: -18, z: -240, r: 7 }, { x: 15, z: -350, r: 7 }, gb(0, -445, 12, 5)],
  }),
  // Opmålt: 368-369 m, fladt — søen ligger helt oppe ved greenen
  hole("Hjemturen", 4, [[0, 0], [-5, -190], [10, -368]], {
    bunkers: [gb(10, -368, -13, 4), { x: -6, z: -250, r: 6 }],
    water: [{ x: 32, z: -346, r: 16 }],
  }),
];

// Højdeprofil pr. hul (green ift. tee, meter) — 16 af 18 huller bygger nu
// på brugerens Google Maps-opmålinger; kun hul 8 og 17 er stadig skønnet
const ELEVATIONS = [1, 6, -1, 17, 0, -4, -2, 3, 0, 1, -7, 2, 3, 15, -9, -20, 4, -1];
COURSE.forEach((h, i) => (h.elev = ELEVATIONS[i] ?? 0));

export const COURSE_PAR = COURSE.reduce((a, h) => a + h.par, 0);

/** Nærmeste punkt på midterlinjen: afstand + hvor langt henne på hullet (0-1). */
export function closestOnCenterline(h: GolfHole, x: number, z: number): { d: number; t: number } {
  const wp = h.waypoints;
  let best = Infinity;
  let bestT = 0;
  let lenBefore = 0;
  let totalLen = 0;
  const segLens: number[] = [];
  for (let i = 1; i < wp.length; i++) {
    const l = Math.hypot(wp[i][0] - wp[i - 1][0], wp[i][1] - wp[i - 1][1]);
    segLens.push(l);
    totalLen += l;
  }
  for (let i = 1; i < wp.length; i++) {
    const [ax, az] = wp[i - 1];
    const [bx, bz] = wp[i];
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    let t = len2 > 0 ? ((x - ax) * abx + (z - az) * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = x - (ax + abx * t);
    const dz = z - (az + abz * t);
    const d = Math.hypot(dx, dz);
    if (d < best) {
      best = d;
      bestT = totalLen > 0 ? (lenBefore + segLens[i - 1] * t) / totalLen : 0;
    }
    lenBefore += segLens[i - 1];
  }
  return { d: best, t: bestT };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Terrænhøjde: glat elevationsprofil fra tee til green + bakker, der er
 * dæmpet på fairway og flade omkring tee og green. Søer ligger i lavninger.
 */
export function terrainHeight(h: GolfHole, x: number, z: number, withWater = true): number {
  const { d, t } = closestOnCenterline(h, x, z);
  const g = h.waypoints[h.waypoints.length - 1];
  const tee = h.waypoints[0];
  const dGreen = Math.hypot(x - g[0], z - g[1]);
  const dTee = Math.hypot(x - tee[0], z - tee[1]);

  const tSm = t * t * (3 - 2 * t);
  let y = h.elev * tSm;

  const s = h.seed;
  const hills =
    Math.sin(x * 0.045 + s) * Math.cos(z * 0.038 + s * 1.7) * 0.55 +
    Math.sin(x * 0.013 - s * 0.6) * Math.cos(z * 0.011 + s * 0.9) * 0.45;
  const fg = clamp01((dGreen - h.greenR - 4) / 28);
  const ft = clamp01((dTee - 10) / 28);
  const fw = 0.35 + 0.65 * clamp01((d - h.fairwayW / 2) / 12);
  y += hills * h.hillAmp * fg * ft * fw;

  if (withWater) {
    for (const w of h.water) {
      const dw = Math.hypot(x - w.x, z - w.z);
      if (dw < w.r + 6) {
        const k = clamp01(1 - dw / (w.r + 6));
        y -= 1.4 * k * k;
      }
    }
  }
  return y;
}

/** Vandspejlets højde for en sø. */
export function waterLevel(h: GolfHole, w: CircleZone): number {
  return terrainHeight(h, w.x, w.z, false) - 0.3;
}

/** Terrænhældning (gradient), numerisk. */
export function terrainGradient(h: GolfHole, x: number, z: number): { gx: number; gz: number } {
  const e = 1.5;
  const gx = (terrainHeight(h, x + e, z) - terrainHeight(h, x - e, z)) / (2 * e);
  const gz = (terrainHeight(h, x, z + e) - terrainHeight(h, x, z - e)) / (2 * e);
  return { gx, gz };
}

export type Surface = "tee" | "fairway" | "green" | "fringe" | "bunker" | "water" | "rough" | "oob";

const ROUGH_W = 30; // rough-bånd uden for fairway; derefter out of bounds

/** Afstand fra punkt til fairway-midterlinjen (polylinje). */
export function distToCenterline(h: GolfHole, x: number, z: number): number {
  let best = Infinity;
  const wp = h.waypoints;
  for (let i = 1; i < wp.length; i++) {
    const [ax, az] = wp[i - 1];
    const [bx, bz] = wp[i];
    const abx = bx - ax;
    const abz = bz - az;
    const len2 = abx * abx + abz * abz;
    let t = len2 > 0 ? ((x - ax) * abx + (z - az) * abz) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = x - (ax + abx * t);
    const dz = z - (az + abz * t);
    best = Math.min(best, Math.hypot(dx, dz));
  }
  return best;
}

export function surfaceAt(h: GolfHole, x: number, z: number): Surface {
  for (const w of h.water) {
    if (Math.hypot(x - w.x, z - w.z) < w.r) return "water";
  }
  for (const b of h.bunkers) {
    if (Math.hypot(x - b.x, z - b.z) < b.r) return "bunker";
  }
  const g = h.waypoints[h.waypoints.length - 1];
  const dGreen = Math.hypot(x - g[0], z - g[1]);
  if (dGreen < h.greenR) return "green";
  if (dGreen < h.greenR + 3) return "fringe";
  if (Math.hypot(x - h.waypoints[0][0], z - h.waypoints[0][1]) < 8) return "tee";
  const d = distToCenterline(h, x, z);
  if (d < h.fairwayW / 2) return "fairway";
  if (d < h.fairwayW / 2 + ROUGH_W) return "rough";
  return "oob";
}
