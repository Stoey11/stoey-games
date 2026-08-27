import * as THREE from "three";
import { Player, initialFor } from "../players";
import {
  COURSE,
  COURSE_PAR,
  GolfHole,
  Surface,
  surfaceAt,
  terrainHeight,
  terrainGradient,
  waterLevel,
  closestOnCenterline,
} from "./course";
import { CLUBS, Club, launchSpeed, suggestClub } from "./clubs";
import { getActiveHost } from "../net/host";
import { makeMii } from "../mii";
import * as sfx from "../sound";

const G = 9.81;
const BALL_R = 0.06; // lidt stor, så den kan ses på lange huller
const CUP_CAPTURE_R = 0.3;
const MAX_EXTRA_STROKES = 5; // saml op ved par + 5

type Phase = "aiming" | "flying" | "transition";

// Hvor meget af køllens kraft man har fra hvert underlag
const LIE_FACTOR: Record<string, number> = {
  tee: 1.0,
  fairway: 1.0,
  green: 1.0,
  fringe: 0.95,
  rough: 0.78,
  bunker: 0.55,
};

interface BounceProps {
  rest: number; // hop-dæmpning
  rollDecel: number; // m/s² friktion under rul
}

const SURFACE_BOUNCE: Record<string, BounceProps> = {
  tee: { rest: 0.35, rollDecel: 3.0 },
  fairway: { rest: 0.35, rollDecel: 3.0 },
  fringe: { rest: 0.3, rollDecel: 4.0 },
  green: { rest: 0.35, rollDecel: 1.6 },
  rough: { rest: 0.16, rollDecel: 7.0 },
  bunker: { rest: 0.03, rollDecel: 14.0 },
  water: { rest: 0, rollDecel: 99 },
  oob: { rest: 0.2, rollDecel: 5.0 },
};

export async function startGolf(app: HTMLElement, players: Player[], onExit: () => void) {
  app.innerHTML = "";

  const container = document.createElement("div");
  container.id = "game-container";
  app.appendChild(container);

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `
    <div class="hud-top">
      <div class="hud-player"><span class="dot"></span><span class="pname"></span></div>
      <div class="hud-frame"></div>
      <div style="display:flex;gap:8px">
        <button class="hud-exit" id="hud-score">📊</button>
        <button class="hud-exit" id="hud-exit">✕</button>
      </div>
    </div>
    <div class="hud-top" style="margin-top:6px">
      <div class="hud-frame" id="hud-dist"></div>
      <div class="hud-frame" id="hud-wind"></div>
      <div class="hud-frame" id="hud-lie"></div>
    </div>
    <div class="aim-controls">
      <div class="ctl-wrap">
        <div class="ctl-label">Kølle</div>
        <div class="ctl-group">
          <button class="ctl-btn" id="club-prev">‹</button>
          <button class="ctl-btn" id="club-next">›</button>
        </div>
      </div>
      <div class="ctl-wrap">
        <div class="ctl-label">Sigt</div>
        <div class="ctl-group">
          <button class="ctl-btn" id="rot-left">↺</button>
          <button class="ctl-btn" id="rot-right">↻</button>
        </div>
      </div>
    </div>
    <canvas id="hole-map" width="110" height="170" style="position:absolute;top:max(110px,calc(env(safe-area-inset-top) + 96px));left:12px;opacity:0.9"></canvas>
    <div id="swing-bar" style="position:absolute;right:16px;top:50%;transform:translateY(-50%);width:20px;height:38%;
      background:rgba(255,255,255,0.35);border-radius:12px;display:none;box-shadow:0 2px 10px rgba(0,0,0,0.3)">
      <div id="swing-fill" style="position:absolute;bottom:0;left:0;right:0;height:0%;border-radius:12px;background:#57b854"></div>
      <div id="swing-100" style="position:absolute;left:-4px;right:-4px;bottom:87%;height:2px;background:rgba(255,255,255,0.9)"></div>
      <div id="swing-label" style="position:absolute;right:26px;bottom:0;white-space:nowrap;font-weight:800;color:#fff;
        text-shadow:0 2px 6px rgba(0,0,0,0.6);font-size:15px"></div>
    </div>
    <div class="hud-hint" id="club-hint"></div>
  `;
  app.appendChild(hud);
  const hudDot = hud.querySelector<HTMLElement>(".dot")!;
  const hudName = hud.querySelector<HTMLElement>(".pname")!;
  const hudFrame = hud.querySelector<HTMLElement>(".hud-frame")!;
  const hudDist = hud.querySelector<HTMLElement>("#hud-dist")!;
  const hudWind = hud.querySelector<HTMLElement>("#hud-wind")!;
  const hudLie = hud.querySelector<HTMLElement>("#hud-lie")!;
  const hudHint = hud.querySelector<HTMLElement>("#club-hint")!;
  const aimControls = hud.querySelector<HTMLElement>(".aim-controls")!;
  const swingBar = hud.querySelector<HTMLElement>("#swing-bar")!;
  const swingFill = hud.querySelector<HTMLElement>("#swing-fill")!;
  const swingLabel = hud.querySelector<HTMLElement>("#swing-label")!;
  const holeMap = hud.querySelector<HTMLCanvasElement>("#hole-map")!;

  // --- Three.js ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x9fd3f0);
  scene.fog = new THREE.Fog(0x9fd3f0, 250, 700);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1500);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener("resize", resize);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x557a44, 1.0));
  const sun = new THREE.DirectionalLight(0xfff4dc, 1.4);
  sun.position.set(120, 200, -80);
  scene.add(sun);

  // Materialer
  const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x7bd45e, roughness: 0.7 });
  const fringeMat = new THREE.MeshStandardMaterial({ color: 0x69c254, roughness: 0.8 });
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xecd9a0, roughness: 0.95 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f9be0, roughness: 0.2, metalness: 0.1 });
  const teeMat = new THREE.MeshStandardMaterial({ color: 0x2f6b28, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e6b2a, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a9440, roughness: 0.9 });

  // Delte trægeometrier (genbruges på alle huller)
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 4, 6);
  const pineCrownGeo = new THREE.ConeGeometry(2.6, 8, 7);
  const leafCrownGeo = new THREE.IcosahedronGeometry(2.9, 1);
  for (const g of [trunkGeo, pineCrownGeo, leafCrownGeo]) (g as any).__shared = true;

  const pseudo = (v: number) => {
    const x = Math.sin(v) * 43758.5453;
    return x - Math.floor(x);
  };

  const ballMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 20, 14), ballMat);
  scene.add(ballMesh);

  // Mii-figur i tredjeperson (som Wii Sports golf)
  const mii = makeMii(players[0].color, "golf");
  scene.add(mii.group);

  function positionMii() {
    const dir = aimDir();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    const px = ballPos.x - dir.x * 0.5 - right.x * 0.3;
    const pz = ballPos.z - dir.z * 0.5 - right.z * 0.3;
    mii.group.position.set(px, terrainHeight(hole, px, pz), pz);
    const a = Math.atan2(dir.x, -dir.z);
    mii.group.rotation.y = -a;
  }

  // Sigtelinje + nedslagsmarkør (viser køllens længde ved fuldt sving)
  const aimLineMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 3, gapSize: 2, transparent: true, opacity: 0.8 });
  const aimLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
  scene.add(aimLine);
  const aimMarker = new THREE.Mesh(
    new THREE.TorusGeometry(1.4, 0.22, 8, 24),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
  );
  aimMarker.rotation.x = -Math.PI / 2;
  aimMarker.visible = false;
  scene.add(aimMarker);

  // Boldspor i luften (som på TV)
  const trailMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
  const trailGeo = new THREE.BufferGeometry();
  const trailLine = new THREE.Line(trailGeo, trailMat);
  trailLine.frustumCulled = false;
  scene.add(trailLine);
  let trailPts: THREE.Vector3[] = [];
  let trailDirty = false;

  // Skyer
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const cloudGeo = new THREE.SphereGeometry(1, 10, 8);
  for (let i = 0; i < 9; i++) {
    const cl = new THREE.Group();
    const parts = 3 + (i % 3);
    for (let p = 0; p < parts; p++) {
      const m = new THREE.Mesh(cloudGeo, cloudMat);
      const s = 7 + ((i * 13 + p * 7) % 8);
      m.scale.set(s, s * 0.45, s * 0.8);
      m.position.set(p * 8 - parts * 3, (p % 2) * 2, ((p * 5) % 7) - 3);
      cl.add(m);
    }
    cl.position.set(((i * 137) % 400) - 200, 65 + ((i * 31) % 30), -60 - ((i * 97) % 380));
    scene.add(cl);
  }

  // --- Hulopbygning ---
  let courseGroup: THREE.Group | null = null;
  let hole: GolfHole = COURSE[0];
  let holeIndex = 0;
  let cup = new THREE.Vector2();
  let wind = new THREE.Vector2(); // m/s
  let greenY = 0; // greenens terrænhøjde

  function buildHole(index: number) {
    holeIndex = index;
    hole = COURSE[index];
    const g = hole.waypoints[hole.waypoints.length - 1];
    cup.set(g[0], g[1]);

    // Vind: 0–8 m/s i tilfældig retning, fast for hele hullet
    const wSpeed = Math.random() * 8;
    const wDir = Math.random() * Math.PI * 2;
    wind.set(Math.cos(wDir) * wSpeed, Math.sin(wDir) * wSpeed);

    if (courseGroup) {
      scene.remove(courseGroup);
      courseGroup.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o.geometry as any).__shared) o.geometry.dispose();
      });
    }
    courseGroup = new THREE.Group();
    scene.add(courseGroup);

    greenY = terrainHeight(hole, cup.x, cup.y);

    // --- Terrænmesh med vertexfarver (bakker, fairway, rough, lyng, skovbund) ---
    const wps = hole.waypoints;
    const minX = Math.min(...wps.map((w) => w[0])) - 75;
    const maxX = Math.max(...wps.map((w) => w[0])) + 75;
    const maxZb = 45;
    const minZb = Math.min(...wps.map((w) => w[1])) - 70;
    const res = 3.2;
    const nx = Math.max(2, Math.ceil((maxX - minX) / res));
    const nz = Math.max(2, Math.ceil((maxZb - minZb) / res));
    const positions = new Float32Array((nx + 1) * (nz + 1) * 3);
    const colors = new Float32Array((nx + 1) * (nz + 1) * 3);
    const col = new THREE.Color();
    const cFair = new THREE.Color(0x5cb54a);
    const cRough = new THREE.Color(0x3e7c33);
    const cForest = new THREE.Color(0x2c5424);
    const cHeather = new THREE.Color(0x8a6b52);
    const cHeather2 = new THREE.Color(0x7d5f78);
    const cGreenCol = new THREE.Color(0x74cf59);
    const cFringe = new THREE.Color(0x69c254);
    const cSand = new THREE.Color(0xe8d59a);
    const cTee = new THREE.Color(0x2f6b28);
    const cPond = new THREE.Color(0x5d4f36);
    const s = hole.seed;
    let vi = 0;
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = minX + i * res;
        const z = minZb + j * res;
        positions[vi * 3] = x;
        positions[vi * 3 + 1] = terrainHeight(hole, x, z);
        positions[vi * 3 + 2] = z;
        const surf = surfaceAt(hole, x, z);
        if (surf === "fairway") {
          const { t } = closestOnCenterline(hole, x, z);
          const stripe = Math.floor((t * hole.length) / 9) % 2 === 0 ? 1.0 : 0.9;
          col.copy(cFair).multiplyScalar(stripe);
        } else if (surf === "green") col.copy(cGreenCol);
        else if (surf === "fringe") col.copy(cFringe);
        else if (surf === "bunker") col.copy(cSand);
        else if (surf === "tee") col.copy(cTee);
        else if (surf === "water") col.copy(cPond);
        else if (surf === "rough") {
          const n2 = Math.sin(x * 0.11 + s * 3) * Math.cos(z * 0.09 - s * 2);
          if (n2 > 0.62) col.copy(n2 > 0.8 ? cHeather2 : cHeather);
          else {
            col.copy(cRough).multiplyScalar(0.94 + 0.1 * Math.sin(x * 0.31 + z * 0.23));
            // Mellemrough: lysere bånd nærmest fairwayen
            const { d } = closestOnCenterline(hole, x, z);
            const semi = 1 - Math.min(1, Math.max(0, (d - hole.fairwayW / 2) / 5));
            if (semi > 0) col.lerp(cFair, semi * 0.45);
          }
        } else {
          col.copy(cForest).multiplyScalar(0.92 + 0.1 * Math.sin(x * 0.17 + z * 0.19 + s));
        }
        colors[vi * 3] = col.r;
        colors[vi * 3 + 1] = col.g;
        colors[vi * 3 + 2] = col.b;
        vi++;
      }
    }
    const indices: number[] = [];
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = j * (nx + 1) + i;
        const b = a + 1;
        const c = a + (nx + 1);
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const terrGeo = new THREE.BufferGeometry();
    terrGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    terrGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    terrGeo.setIndex(indices);
    terrGeo.computeVertexNormals();
    courseGroup.add(new THREE.Mesh(terrGeo, terrainMat));

    // Green + fringe (skarpe cirkler oven på terrænet — green er flad)
    const fringe = new THREE.Mesh(new THREE.CircleGeometry(hole.greenR + 3, 40), fringeMat);
    fringe.rotation.x = -Math.PI / 2;
    fringe.position.set(cup.x, greenY + 0.03, cup.y);
    courseGroup.add(fringe);
    const green = new THREE.Mesh(new THREE.CircleGeometry(hole.greenR, 40), greenMat);
    green.rotation.x = -Math.PI / 2;
    green.position.set(cup.x, greenY + 0.045, cup.y);
    courseGroup.add(green);

    // Teested
    const tee = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 5), teeMat);
    tee.position.set(wps[0][0], 0.02, wps[0][1] + 1);
    courseGroup.add(tee);

    // Bunkere: cirkler der følger terrænet
    for (const b of hole.bunkers) {
      const bgeo = new THREE.CircleGeometry(b.r, 24);
      const bpos = bgeo.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < bpos.count; k++) {
        const vx = bpos.getX(k);
        const vy = bpos.getY(k);
        bpos.setZ(k, terrainHeight(hole, b.x + vx, b.z - vy) + 0.08);
      }
      bgeo.computeVertexNormals();
      const m = new THREE.Mesh(bgeo, sandMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(b.x, 0, b.z);
      courseGroup.add(m);
    }

    // Søer: fladt vandspejl i lavningen
    for (const w of hole.water) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(w.r + 2, 32), waterMat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(w.x, waterLevel(hole, w), w.z);
      courseGroup.add(m);
    }

    // Cup + flag (på greenens højde)
    const cupMesh = new THREE.Mesh(new THREE.CircleGeometry(0.35, 16), new THREE.MeshBasicMaterial({ color: 0x222222 }));
    cupMesh.rotation.x = -Math.PI / 2;
    cupMesh.position.set(cup.x, greenY + 0.06, cup.y);
    courseGroup.add(cupMesh);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }));
    pole.position.set(cup.x, greenY + 1.7, cup.y);
    courseGroup.add(pole);
    const flag = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.04), new THREE.MeshStandardMaterial({ color: 0xd8433b, side: THREE.DoubleSide }));
    flag.position.set(cup.x + 0.57, greenY + 3.0, cup.y);
    courseGroup.add(flag);

    // --- Skov: instansierede træer (fyr + løvtræ) i rough og skovbryn ---
    const curve = new THREE.CatmullRomCurve3(
      wps.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      "catmullrom",
      0.3
    );
    interface TreeSpot { x: number; z: number; scale: number; pine: boolean; shade: number }
    const spots: TreeSpot[] = [];
    const steps = Math.min(110, Math.round(hole.length / 4.5));
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      const p = curve.getPoint(t);
      const tan = curve.getTangent(t);
      const n = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
      for (const side of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          const r1 = pseudo(i * 13.7 + side * 5.1 + k * 29.3 + s);
          const r2 = pseudo(i * 7.9 + side * 11.3 + k * 17.1 + s * 2);
          const dist = hole.fairwayW / 2 + 9 + r1 * 42;
          const px = p.x + n.x * side * dist + (r2 - 0.5) * 10;
          const pz = p.z + n.z * side * dist + (r1 - 0.5) * 10;
          const surf = surfaceAt(hole, px, pz);
          if (surf !== "rough" && surf !== "oob") continue;
          if (Math.hypot(px - cup.x, pz - cup.y) < hole.greenR + 10) continue;
          if (Math.hypot(px - wps[0][0], pz - wps[0][1]) < 12) continue;
          spots.push({ x: px, z: pz, scale: 0.7 + r2 * 0.75, pine: r1 > 0.42, shade: 0.75 + r2 * 0.45 });
        }
      }
    }
    const m4 = new THREE.Matrix4();
    const instCol = new THREE.Color();
    const addInstanced = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      list: TreeSpot[],
      yOffset: (sc: number) => number,
      squashY: number,
      colored: boolean
    ) => {
      if (list.length === 0) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((c, idx) => {
        const ty = terrainHeight(hole, c.x, c.z);
        m4.makeScale(c.scale, c.scale * squashY, c.scale);
        m4.setPosition(c.x, ty + yOffset(c.scale), c.z);
        im.setMatrixAt(idx, m4);
        if (colored) im.setColorAt(idx, instCol.setScalar(c.shade));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      courseGroup!.add(im);
    };
    const pinesArr = spots.filter((c) => c.pine);
    const leafsArr = spots.filter((c) => !c.pine);
    addInstanced(trunkGeo, trunkMat, pinesArr, (sc) => 2 * sc, 1, false);
    addInstanced(pineCrownGeo, pineMat, pinesArr, (sc) => 6.2 * sc, 1, true);
    addInstanced(trunkGeo, trunkMat, leafsArr, (sc) => 2 * sc, 1, false);
    addInstanced(leafCrownGeo, leafMat, leafsArr, (sc) => 5.1 * sc, 0.85, true);
  }

  // --- Spiltilstand ---
  const strokes: number[][] = players.map(() => COURSE.map(() => 0));
  let currentPlayer = 0;
  let phase: Phase = "transition";
  let destroyed = false;

  // Controller-tilstand: telefoner styrer via værtssessionen
  const host = getActiveHost();
  const remoteMode = !!host && host.currentGame === "golf";

  // Boldens tilstand (custom fysik, ikke Rapier — bedre til 500 m flugt)
  const ballPos = new THREE.Vector3();
  const ballVel = new THREE.Vector3();
  let rolling = false;
  let aimAngle = 0; // 0 = direkte mod cup
  let clubIndex = 0;
  let currentLie: Surface = "tee";
  let preShotPos = new THREE.Vector3();
  let flightTime = 0;

  function distToFlag(): number {
    return Math.hypot(ballPos.x - cup.x, ballPos.z - cup.y);
  }

  /** Retningen mod cup + sigtevinkel */
  function aimDir(): THREE.Vector3 {
    const base = Math.atan2(cup.x - ballPos.x, -(cup.y - ballPos.z));
    const a = base + aimAngle;
    return new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
  }

  function placeBallAtTee() {
    const tx = hole.waypoints[0][0];
    const tz = hole.waypoints[0][1];
    ballPos.set(tx, terrainHeight(hole, tx, tz) + BALL_R, tz);
    ballVel.set(0, 0, 0);
    rolling = false;
    ballMesh.visible = true;
    currentLie = "tee";
  }

  function updateHud() {
    const p = players[currentPlayer];
    hudDot.style.background = p.color;
    hudName.textContent = p.name;
    const s = strokes[currentPlayer][holeIndex];
    hudFrame.textContent = `Hul ${holeIndex + 1} · Par ${hole.par} · ${hole.length} m · Slag ${s}`;
    const d = distToFlag();
    const dh = greenY - ballPos.y;
    const dhTxt = Math.abs(dh) > 1.5 ? ` ${dh > 0 ? "↑" : "↓"}${Math.round(Math.abs(dh))}` : "";
    hudDist.textContent = (d >= 10 ? `⛳ ${Math.round(d)} m` : `⛳ ${d.toFixed(1)} m`) + dhTxt;
    const ws = wind.length();
    const warrow = "→";
    const wdeg = (Math.atan2(-wind.y, wind.x) * 180) / Math.PI;
    hudWind.innerHTML = `💨 ${ws.toFixed(1)} m/s <span style="display:inline-block;transform:rotate(${-wdeg}deg)">${warrow}</span>`;
    const lieNames: Record<string, string> = {
      tee: "Tee", fairway: "Fairway", rough: "Rough", bunker: "Bunker", green: "Green", fringe: "Forgreen", oob: "OOB", water: "Vand",
    };
    hudLie.textContent = `📍 ${lieNames[currentLie] ?? currentLie}`;
    ballMat.color.set(0xffffff);
    mii.setColor(p.color);
    updateClubHint();
  }

  function club(): Club {
    return CLUBS[clubIndex];
  }

  function updateClubHint() {
    const c = club();
    const lie = LIE_FACTOR[currentLie] ?? 0.8;
    const eff = c.putter ? c.carry : Math.round(c.carry * lie);
    hudHint.textContent = c.putter
      ? `${c.name} — træk ned og swipe op for at putte 🥅`
      : `${c.name} · op til ${eff} m — træk ned (baksving) og swipe op! 🏌️`;
    hudHint.style.display = phase === "aiming" ? "" : "none";
  }

  function autoSelectClub() {
    const c = suggestClub(distToFlag(), currentLie);
    clubIndex = CLUBS.indexOf(c);
  }

  function updateAimLine() {
    const dir = aimDir();
    const from = ballPos.clone();
    from.y += 0.05;
    const c = club();
    const lie = LIE_FACTOR[currentLie] ?? 0.8;
    const len = c.putter ? Math.min(distToFlag() + 4, 25) : c.carry * lie;
    const to = from.clone().addScaledVector(dir, len);
    to.y = terrainHeight(hole, to.x, to.z) + 0.3;
    aimLineGeo.setFromPoints([from, to]);
    aimLine.computeLineDistances();
    aimLine.visible = phase === "aiming";
    // Markør der viser hvor et fuldt sving lander med den valgte kølle
    if (!c.putter) {
      aimMarker.position.set(to.x, terrainHeight(hole, to.x, to.z) + 0.1, to.z);
      aimMarker.visible = phase === "aiming";
    } else {
      aimMarker.visible = false;
    }
    positionMii();
  }

  // --- Hulkort (minimap) ---
  const hmCtx = holeMap.getContext("2d")!;
  function drawHoleMap() {
    const W = 110;
    const H = 170;
    hmCtx.clearRect(0, 0, W, H);
    const xs = hole.waypoints.map((w) => w[0]);
    const zs = hole.waypoints.map((w) => w[1]);
    const minx = Math.min(...xs) - 25;
    const maxx = Math.max(...xs) + 25;
    const minz = Math.min(...zs) - 18;
    const maxz = Math.max(...zs, 8);
    const sc = Math.min((W - 10) / (maxx - minx), (H - 10) / (maxz - minz));
    const mx = (x: number) => 5 + (x - minx) * sc + ((W - 10) - (maxx - minx) * sc) / 2;
    const mz = (z: number) => 5 + (z - minz) * sc + ((H - 10) - (maxz - minz) * sc) / 2;

    // Baggrund
    hmCtx.fillStyle = "rgba(20,40,25,0.55)";
    hmCtx.beginPath();
    hmCtx.roundRect(0, 0, W, H, 10);
    hmCtx.fill();
    // Fairway langs midterlinjen
    hmCtx.strokeStyle = "#5cb54a";
    hmCtx.lineWidth = Math.max(4, hole.fairwayW * sc);
    hmCtx.lineCap = "round";
    hmCtx.lineJoin = "round";
    hmCtx.beginPath();
    hole.waypoints.forEach(([x, z], i) => (i === 0 ? hmCtx.moveTo(mx(x), mz(z)) : hmCtx.lineTo(mx(x), mz(z))));
    hmCtx.stroke();
    // Vand og bunkere
    for (const w of hole.water) {
      hmCtx.fillStyle = "#3f9be0";
      hmCtx.beginPath();
      hmCtx.arc(mx(w.x), mz(w.z), Math.max(3, w.r * sc), 0, Math.PI * 2);
      hmCtx.fill();
    }
    for (const b of hole.bunkers) {
      hmCtx.fillStyle = "#e8d59a";
      hmCtx.beginPath();
      hmCtx.arc(mx(b.x), mz(b.z), Math.max(2, b.r * sc), 0, Math.PI * 2);
      hmCtx.fill();
    }
    // Green + flag
    const g = hole.waypoints[hole.waypoints.length - 1];
    hmCtx.fillStyle = "#7bd45e";
    hmCtx.beginPath();
    hmCtx.arc(mx(g[0]), mz(g[1]), Math.max(3.5, hole.greenR * sc), 0, Math.PI * 2);
    hmCtx.fill();
    hmCtx.fillStyle = "#d8433b";
    hmCtx.fillRect(mx(g[0]) - 1, mz(g[1]) - 8, 2, 8);
    // Bold
    hmCtx.fillStyle = "#ffffff";
    hmCtx.strokeStyle = "#333";
    hmCtx.lineWidth = 1;
    hmCtx.beginPath();
    hmCtx.arc(mx(ballPos.x), mz(ballPos.z), 3, 0, Math.PI * 2);
    hmCtx.fill();
    hmCtx.stroke();
  }

  // --- Kamera ---
  const camTarget = new THREE.Vector3();
  function positionCameraBehindBall(instant = false) {
    const dir = aimDir();
    const onGreen = currentLie === "green" || club().putter;
    const back = onGreen ? 5 : 11;
    const height = onGreen ? 2.4 : 4.6;
    const desired = ballPos.clone().addScaledVector(dir, -back).add(new THREE.Vector3(0, height, 0));
    desired.y = Math.max(desired.y, terrainHeight(hole, desired.x, desired.z) + 2.2);
    if (instant) camera.position.copy(desired);
    else camera.position.lerp(desired, 0.08);
    camTarget.copy(ballPos).addScaledVector(dir, onGreen ? 12 : 60);
    camTarget.y = terrainHeight(hole, camTarget.x, camTarget.z) + 1;
    camera.lookAt(camTarget);
  }

  // --- Kontroller ---
  function holdButton(id: string, onTick: () => void) {
    const btn = hud.querySelector<HTMLButtonElement>(id)!;
    let timer: number | null = null;
    const start = (e: Event) => {
      e.preventDefault();
      if (phase !== "aiming") return;
      onTick();
      timer = window.setInterval(() => phase === "aiming" && onTick(), 40);
    };
    const stop = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
    };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointercancel", stop);
    btn.addEventListener("pointerleave", stop);
  }

  holdButton("#rot-left", () => {
    aimAngle -= 0.008;
    updateAimLine();
    positionCameraBehindBall(true);
  });
  holdButton("#rot-right", () => {
    aimAngle += 0.008;
    updateAimLine();
    positionCameraBehindBall(true);
  });

  hud.querySelector("#club-prev")!.addEventListener("click", () => {
    if (phase !== "aiming") return;
    clubIndex = (clubIndex - 1 + CLUBS.length) % CLUBS.length;
    updateClubHint();
    updateAimLine();
  });
  hud.querySelector("#club-next")!.addEventListener("click", () => {
    if (phase !== "aiming") return;
    clubIndex = (clubIndex + 1) % CLUBS.length;
    updateClubHint();
    updateAimLine();
  });

  // --- Wii-sving: træk NED for baksving (kraftbar), swipe OP for at slå.
  // Skævt opsving eller oversving (>100 %) giver et skævt slag med kurve. ---
  interface Sample { x: number; y: number; t: number }
  let samples: Sample[] = [];
  let pointerDown = false;
  let backswingPeak = 0; // px
  let backswingPower = 0;
  const canvas = renderer.domElement;

  function projectedDistance(power: number): number {
    const c = club();
    const p = Math.min(power, 1.15);
    if (c.putter) {
      const v = 2 + p * 16;
      return (v * v) / (2 * 1.6);
    }
    return c.carry * (LIE_FACTOR[currentLie] ?? 0.8) * p;
  }

  function updateSwingBar() {
    const p = backswingPower;
    swingBar.style.display = "";
    swingFill.style.height = `${Math.min(100, (p / 1.15) * 100)}%`;
    swingFill.style.background = p > 1 ? "#d8433b" : p > 0.85 ? "#e8a838" : "#57b854";
    swingLabel.style.bottom = `${Math.min(100, (p / 1.15) * 100)}%`;
    swingLabel.textContent = `${Math.round(p * 100)} % · ~${Math.round(projectedDistance(p))} m`;
  }

  function hideSwingBar() {
    swingBar.style.display = "none";
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (phase !== "aiming") return;
    pointerDown = true;
    backswingPeak = 0;
    backswingPower = 0;
    samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointerDown || phase !== "aiming") return;
    samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (samples.length > 90) samples.shift();
    // Baksving: hvor langt der er trukket nedad fra startpunktet
    const dy = e.clientY - samples[0].y;
    backswingPeak = Math.max(backswingPeak, dy);
    const minDim = Math.min(container.clientWidth || 400, container.clientHeight || 700);
    backswingPower = THREE.MathUtils.clamp(backswingPeak / (minDim * 0.4), 0, 1.15);
    if (backswingPeak > 8) updateSwingBar();
  });

  canvas.addEventListener("pointerup", () => {
    if (!pointerDown || phase !== "aiming") return;
    pointerDown = false;
    hideSwingBar();
    if (samples.length < 3 || backswingPower < 0.04) return;

    // Opsvinget: de sidste ~150 ms skal være en hurtig bevægelse OPAD
    const now = performance.now();
    const recent = samples.filter((s) => now - s.t < 150);
    if (recent.length < 2) return;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return;
    const vyPx = (first.y - last.y) / dt;
    if (vyPx < 250) return; // intet rigtigt opsving — slaget annulleres

    // Skævhed: vandret afvigelse under opsvinget
    const upLen = Math.max(30, first.y - last.y);
    const dxUp = last.x - first.x;
    let crook = THREE.MathUtils.clamp((dxUp / upLen) * 0.4, -0.14, 0.14);
    let spin = THREE.MathUtils.clamp((dxUp / upLen) * 0.5, -0.15, 0.15);
    let power = backswingPower;
    if (power > 1) {
      // Oversving: lidt ekstra længde, men stor risiko for hook/slice
      const over = power - 1;
      crook += (Math.random() - 0.5) * over * 1.6;
      spin += (Math.random() - 0.5) * over * 1.8;
    }
    hitBall(power, crook, spin);
  });

  // Input fra telefon-controllere
  if (remoteMode && host) {
    host.onInput = (idx, msg) => {
      if (destroyed || idx !== currentPlayer || phase !== "aiming") return;
      if (msg.t === "rotate") {
        aimAngle += msg.dir * 0.008;
        updateAimLine();
        positionCameraBehindBall(true);
      } else if (msg.t === "club") {
        clubIndex = (clubIndex + msg.dir + CLUBS.length) % CLUBS.length;
        updateClubHint();
        updateAimLine();
        sendRemoteInfo();
      } else if (msg.t === "swipe") {
        hitBall(
          THREE.MathUtils.clamp(msg.power, 0.04, 1.15),
          THREE.MathUtils.clamp(msg.lateral, -1, 1) * 0.14,
          THREE.MathUtils.clamp(msg.curve, -1, 1) * 0.15
        );
      }
    };
  }

  function sendRemoteInfo() {
    if (!remoteMode || !host) return;
    const c = club();
    const lie = LIE_FACTOR[currentLie] ?? 0.8;
    const eff = c.putter ? "putter" : `op til ${Math.round(c.carry * lie)} m`;
    host.send(currentPlayer, {
      t: "info",
      index: currentPlayer,
      info: `${c.name} (${eff}) · ${Math.round(distToFlag())} m til flag`,
    });
  }

  // Skævt slag: aimErr drejer startretningen, spin giver kurve i luften
  let shotSpin = 0;
  const shotPerp = new THREE.Vector3();

  function hitBall(power: number, aimErr = 0, spin = 0) {
    const c = club();
    strokes[currentPlayer][holeIndex]++;
    preShotPos.copy(ballPos);
    const dir = aimDir();
    const a = Math.atan2(dir.x, -dir.z) + aimErr;
    const dirAdj = new THREE.Vector3(Math.sin(a), 0, -Math.cos(a));
    shotSpin = c.putter ? 0 : spin;
    shotPerp.set(-dirAdj.z, 0, dirAdj.x);

    const p = Math.min(Math.max(power, 0.04), 1.15);
    if (c.putter) {
      const v = 2 + p * 16;
      ballVel.set(dirAdj.x * v, 0, dirAdj.z * v);
      rolling = true;
    } else {
      const lie = LIE_FACTOR[currentLie] ?? 0.8;
      // Kvadratrod: carry skalerer lineært med baren (100 % = køllens længde)
      const v0 = launchSpeed(c) * Math.sqrt(p * lie);
      const loft = (c.loft * Math.PI) / 180;
      ballVel.set(dirAdj.x * v0 * Math.cos(loft), v0 * Math.sin(loft), dirAdj.z * v0 * Math.cos(loft));
      rolling = false;
    }
    trailPts = [ballPos.clone()];
    trailDirty = true;
    phase = "flying";
    flightTime = 0;
    mii.swing();
    if (c.putter) sfx.putt();
    else sfx.swingHit();
    aimLine.visible = false;
    aimMarker.visible = false;
    aimControls.style.display = "none";
    hudHint.style.display = "none";
    updateHud();
  }

  // --- Fysik-integration ---
  function stepBall(dt: number) {
    if (rolling) {
      const surf = surfaceAt(hole, ballPos.x, ballPos.z);
      if (surf === "water") {
        onWater();
        return;
      }
      const props = SURFACE_BOUNCE[surf] ?? SURFACE_BOUNCE.rough;
      // Terrænhældning: bolden triller nedad bakker
      const { gx, gz } = terrainGradient(hole, ballPos.x, ballPos.z);
      ballVel.x -= gx * G * 0.6 * dt;
      ballVel.z -= gz * G * 0.6 * dt;
      const speed = Math.hypot(ballVel.x, ballVel.z);
      // Cup-fangst under rul
      if (distToFlag() < CUP_CAPTURE_R && speed < 3.5) {
        ballVel.set(0, 0, 0);
        onBallInCup();
        return;
      }
      if (speed < 0.15) {
        ballVel.set(0, 0, 0);
        onBallStopped();
        return;
      }
      const dec = props.rollDecel * dt;
      const newSpeed = Math.max(0, speed - dec);
      ballVel.x *= newSpeed / speed;
      ballVel.z *= newSpeed / speed;
      ballPos.x += ballVel.x * dt;
      ballPos.z += ballVel.z * dt;
      ballPos.y = terrainHeight(hole, ballPos.x, ballPos.z) + BALL_R;
    } else {
      // I luften: tyngdekraft + vind + skru (hook/slice kurver bolden)
      ballVel.y -= G * dt;
      ballVel.x += (wind.x - ballVel.x * 0.02) * 0.05 * dt * 9.81 * 0.35;
      ballVel.z += (wind.y - ballVel.z * 0.02) * 0.05 * dt * 9.81 * 0.35;
      ballVel.x += shotPerp.x * shotSpin * 22 * dt;
      ballVel.z += shotPerp.z * shotSpin * 22 * dt;
      ballPos.addScaledVector(ballVel, dt);
      if (trailPts.length < 500) {
        trailPts.push(ballPos.clone());
        trailDirty = true;
      }

      const groundY = terrainHeight(hole, ballPos.x, ballPos.z) + BALL_R;
      if (ballPos.y <= groundY && ballVel.y < 0) {
        ballPos.y = groundY;
        const surf = surfaceAt(hole, ballPos.x, ballPos.z);
        if (surf === "water") {
          onWater();
          return;
        }
        const props = SURFACE_BOUNCE[surf] ?? SURFACE_BOUNCE.rough;
        // Uden luftmodstand lander bolden alt for hurtigt vandret —
        // begræns farten ved nedslag, som drag ville gøre i virkeligheden
        const clampHoriz = (max: number) => {
          const hs = Math.hypot(ballVel.x, ballVel.z);
          if (hs > max) {
            ballVel.x *= max / hs;
            ballVel.z *= max / hs;
          }
        };
        if (Math.abs(ballVel.y) > 2.5 && props.rest > 0.05) {
          ballVel.y = -ballVel.y * props.rest;
          ballVel.x *= 0.55;
          ballVel.z *= 0.55;
          clampHoriz(14);
        } else {
          ballVel.y = 0;
          ballVel.x *= 0.7;
          ballVel.z *= 0.7;
          clampHoriz(8);
          rolling = true;
        }
      }
    }
  }

  // --- Regler ---
  function onWater() {
    showToast("Plask! 💦 +1 strafslag — drop ved bredden");
    sfx.splash();
    strokes[currentPlayer][holeIndex]++;
    // Realistisk drop: gå tilbage mod stedet der blev slået fra, til bolden
    // er ude af vandet, og læg den et par meter inde på land
    const back = preShotPos.clone().sub(ballPos).setY(0);
    const drop = ballPos.clone();
    if (back.lengthSq() > 0.01) {
      back.normalize();
      let found = false;
      for (let i = 0; i < 40; i++) {
        drop.addScaledVector(back, 2);
        if (surfaceAt(hole, drop.x, drop.z) !== "water") {
          drop.addScaledVector(back, 2.5);
          found = true;
          break;
        }
      }
      if (!found) drop.copy(preShotPos);
    } else {
      drop.copy(preShotPos);
    }
    ballPos.set(drop.x, terrainHeight(hole, drop.x, drop.z) + BALL_R, drop.z);
    const dropSurf = surfaceAt(hole, ballPos.x, ballPos.z);
    currentLie = dropSurf === "water" || dropSurf === "oob" ? "rough" : dropSurf;
    ballVel.set(0, 0, 0);
    rolling = false;
    afterShotSettled();
  }

  function onBallStopped() {
    const surf = surfaceAt(hole, ballPos.x, ballPos.z);
    if (surf === "oob") {
      showToast("Out of bounds! 🚧 +1 strafslag");
      sfx.sad();
      strokes[currentPlayer][holeIndex]++;
      ballPos.copy(preShotPos);
      rolling = false;
      afterShotSettled();
      return;
    }
    currentLie = surf;
    afterShotSettled();
  }

  function afterShotSettled() {
    phase = "transition";
    const s = strokes[currentPlayer][holeIndex];
    if (s >= hole.par + MAX_EXTRA_STROKES) {
      showToast(`Samler op — maks ${hole.par + MAX_EXTRA_STROKES} slag 😅`);
      setTimeout(() => !destroyed && nextTurnOrHole(), 1700);
      return;
    }
    setTimeout(() => !destroyed && startAiming(), 600);
  }

  function scoreName(s: number, par: number): string {
    if (s === 1) return "HOLE IN ONE!! 🤩";
    const d = s - par;
    if (d <= -3) return `Albatros!! 🦢 (${s} slag)`;
    if (d === -2) return `Eagle! 🦅 (${s} slag)`;
    if (d === -1) return `Birdie! 🐦 (${s} slag)`;
    if (d === 0) return `Par 👍 (${s} slag)`;
    if (d === 1) return `Bogey (${s} slag)`;
    if (d === 2) return `Dobbeltbogey (${s} slag)`;
    return `${s} slag`;
  }

  function onBallInCup() {
    phase = "transition";
    ballMesh.visible = false;
    const s = strokes[currentPlayer][holeIndex];
    showToast(scoreName(s, hole.par));
    sfx.plink();
    if (s <= hole.par - 1 || s === 1) sfx.fanfare();
    setTimeout(() => !destroyed && nextTurnOrHole(), 1900);
  }

  function nextTurnOrHole() {
    if (currentPlayer < players.length - 1) {
      currentPlayer++;
      placeBallAtTee();
      aimAngle = 0;
      updateHud();
      if (players.length > 1) {
        showTurnOverlay(players[currentPlayer], () => beginShot());
      } else {
        beginShot();
      }
      return;
    }
    if (holeIndex < COURSE.length - 1) {
      currentPlayer = 0;
      buildHole(holeIndex + 1);
      placeBallAtTee();
      aimAngle = 0;
      updateHud();
      showHoleIntro(() => beginShot());
    } else {
      showResults();
    }
  }

  function beginShot() {
    autoSelectClub();
    startAiming();
    positionCameraBehindBall(true);
  }

  function startAiming() {
    // Foreslå kølle til hvert slag (green → putter, bunker → sand wedge)
    autoSelectClub();
    phase = "aiming";
    ballMesh.visible = true;
    aimControls.style.display = remoteMode ? "none" : "";
    updateHud();
    updateAimLine();
    positionCameraBehindBall(true);
    if (remoteMode && host) {
      const c = club();
      host.announceTurn(
        currentPlayer,
        `Hul ${holeIndex + 1} · ${Math.round(distToFlag())} m til flag · ${c.name}`
      );
      hudHint.textContent = `${players[currentPlayer].name} slår fra telefonen 📱`;
      hudHint.style.display = "";
    }
  }

  // --- Overlays ---
  function showToast(text: string) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    app.appendChild(t);
    setTimeout(() => t.remove(), 1700);
  }

  function showHoleIntro(onReady: () => void) {
    const p = players[currentPlayer];
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <h2>⛳ Hul ${holeIndex + 1}: ${hole.name}</h2>
      <p>Par ${hole.par} · ${hole.length} m · Vind ${wind.length().toFixed(1)} m/s${players.length > 1 ? `<br>${escapeHtml(p.name)} starter` : ""}</p>
      ${holeIndex > 0 ? renderScoreboard() : ""}
      <button class="btn btn-primary">Klar! 🏌️</button>
    `;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      ov.remove();
      onReady();
    };
    ov.querySelector("button")!.addEventListener("click", go);
    if (remoteMode) setTimeout(go, holeIndex > 0 ? 4200 : 2600);
    app.appendChild(ov);
  }

  function showTurnOverlay(player: Player, onReady: () => void) {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="big-avatar" style="background:${player.color}">${initialFor(player.name)}</div>
      <h2>${remoteMode ? `${escapeHtml(player.name)} har turen! 📱` : `Giv telefonen til ${escapeHtml(player.name)}!`}</h2>
      <p>Hul ${holeIndex + 1}: ${hole.name} · Par ${hole.par} · ${hole.length} m</p>
      <button class="btn btn-primary">Klar! 🏌️</button>
    `;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      ov.remove();
      onReady();
    };
    ov.querySelector("button")!.addEventListener("click", go);
    if (remoteMode) setTimeout(go, 2600);
    app.appendChild(ov);
  }

  function showScoreboardOverlay() {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <h2>Scorekort</h2>
      ${renderScoreboard()}
      <button class="btn btn-primary">Videre</button>
    `;
    ov.querySelector("button")!.addEventListener("click", () => ov.remove());
    app.appendChild(ov);
  }

  function renderScoreboard(): string {
    const played = (pi: number, hi: number) => hi < holeIndex || (hi === holeIndex && strokes[pi][hi] > 0);
    let html = `<div class="scoreboard"><table class="score-table" style="min-width:${COURSE.length * 34 + 140}px"><tr><th></th>`;
    COURSE.forEach((_, i) => (html += `<th>${i + 1}</th>`));
    html += `<th>I alt</th></tr><tr><td class="pname">Par</td>`;
    COURSE.forEach((h) => (html += `<td class="frame-total">${h.par}</td>`));
    html += `<td class="frame-total">${COURSE_PAR}</td></tr>`;
    players.forEach((p, pi) => {
      html += `<tr><td class="pname" style="color:${p.color}">${escapeHtml(p.name)}</td>`;
      let total = 0;
      let parSoFar = 0;
      COURSE.forEach((h, hi) => {
        const s = strokes[pi][hi];
        if (played(pi, hi)) {
          total += s;
          parSoFar += h.par;
        }
        const isCur = pi === currentPlayer && hi === holeIndex ? " current-frame" : "";
        html += `<td class="frame-total${isCur}">${played(pi, hi) ? s : ""}</td>`;
      });
      const diff = total - parSoFar;
      const diffTxt = parSoFar > 0 ? ` (${diff > 0 ? "+" : ""}${diff})` : "";
      html += `<td class="frame-total" style="white-space:nowrap;padding:0 6px">${total}${diffTxt}</td></tr>`;
    });
    html += `</table></div>`;
    return html;
  }

  function showResults() {
    const ranked = players
      .map((p, i) => ({ p, total: strokes[i].reduce((a, b) => a + b, 0) }))
      .sort((a, b) => a.total - b.total);

    sfx.fanfare();
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="big-avatar" style="background:${ranked[0].p.color}">👑</div>
      <h2>${escapeHtml(ranked[0].p.name)} vinder!</h2>
      <p>${ranked
        .map((r, i) => {
          const d = r.total - COURSE_PAR;
          return `${i + 1}. ${escapeHtml(r.p.name)} — <b>${r.total} slag</b> (${d > 0 ? "+" : ""}${d})`;
        })
        .join("<br>")}</p>
      ${renderScoreboard()}
      <div class="btn-row">
        <button class="btn btn-secondary" id="res-menu">Hovedmenu</button>
        <button class="btn btn-primary" id="res-again">Spil igen ⛳</button>
      </div>
    `;
    ov.querySelector("#res-menu")!.addEventListener("click", () => {
      destroy();
      onExit();
    });
    ov.querySelector("#res-again")!.addEventListener("click", () => {
      destroy();
      startGolf(app, players, onExit);
    });
    app.appendChild(ov);
  }

  hud.querySelector("#hud-exit")!.addEventListener("click", () => {
    destroy();
    onExit();
  });
  hud.querySelector("#hud-score")!.addEventListener("click", () => showScoreboardOverlay());

  // --- Game loop ---
  let raf = 0;
  let lastT = performance.now();
  let accumulator = 0;
  const FIXED_DT = 1 / 60;

  function loop() {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = Math.min(dt, 0.1);
    advance(dt);
  }

  function advance(dt: number) {
    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      if (phase === "flying") {
        flightTime += FIXED_DT;
        stepBall(FIXED_DT);
        if (flightTime > 30) {
          // Nødstop
          ballVel.set(0, 0, 0);
          rolling = false;
          onBallStopped();
        }
      }
      accumulator -= FIXED_DT;
    }

    ballMesh.position.copy(ballPos);
    mii.update(performance.now());

    if (trailDirty && trailPts.length > 1) {
      trailGeo.setFromPoints(trailPts);
      trailDirty = false;
    }
    trailLine.visible = trailPts.length > 1 && (phase === "flying" || phase === "transition");
    drawHoleMap();

    if (phase === "flying") {
      // Følg bolden
      const behind = ballVel.lengthSq() > 1 ? ballVel.clone().setY(0).normalize() : aimDir();
      const desired = ballPos.clone().addScaledVector(behind, -18).add(new THREE.Vector3(0, 9, 0));
      desired.y = Math.max(desired.y, terrainHeight(hole, desired.x, desired.z) + 2.5);
      camera.position.lerp(desired, 0.06);
      camTarget.copy(ballPos);
      camera.lookAt(camTarget);
    } else if (phase === "aiming") {
      positionCameraBehindBall();
    }

    renderer.render(scene, camera);
  }

  // Debug-hooks til automatiseret test
  let simOffset = 0;
  (window as any).__wiiStep = (seconds: number) => {
    for (let s = 0; s < seconds; s += FIXED_DT) {
      simOffset += FIXED_DT * 1000;
      advance(FIXED_DT);
      if (phase !== "flying") break;
    }
  };
  (window as any).__golfState = () => ({
    phase,
    hole: holeIndex + 1,
    par: hole.par,
    lie: currentLie,
    ball: { x: +ballPos.x.toFixed(1), y: +ballPos.y.toFixed(1), z: +ballPos.z.toFixed(1) },
    distToFlag: +distToFlag().toFixed(1),
    club: club().name,
    clubCarry: club().carry,
    clubIsPutter: !!club().putter,
    wind: { x: +wind.x.toFixed(1), z: +wind.y.toFixed(1) },
    strokes: strokes.map((s) => [...s]),
  });
  (window as any).__golfSwing = (power: number, aimErr = 0, spin = 0) => {
    if (phase !== "aiming") return false;
    hitBall(power, aimErr, spin);
    return true;
  };
  (window as any).__golfHole = (i: number) => {
    buildHole(Math.max(0, Math.min(COURSE.length - 1, i)));
    currentPlayer = 0;
    placeBallAtTee();
    aimAngle = 0;
    updateHud();
    startAiming();
    return hole.name;
  };
  (window as any).__golfClub = (id: string) => {
    const i = CLUBS.findIndex((c) => c.id === id);
    if (i >= 0) clubIndex = i;
    updateClubHint();
    return CLUBS[clubIndex].name;
  };

  function destroy() {
    destroyed = true;
    if (remoteMode && host) host.onInput = null;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    renderer.dispose();
    hud.remove();
    container.remove();
    app.innerHTML = "";
  }

  // Start
  buildHole(0);
  placeBallAtTee();
  updateHud();
  showHoleIntro(() => beginShot());
  loop();
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
