import * as THREE from "three";
import { Player, PLAYER_COLORS, initialFor } from "../players";
import { TRACKS, TrackDef, SampledTrack, sampleTrack, nearestIdx, nearestIdxFull } from "./track";
import { getActiveHost } from "../net/host";
import { makeMii, Mii } from "../mii";
import * as sfx from "../sound";
import { steerFromOrientation } from "../net/controller";

const MAX_SPEED = 24; // m/s
const GRASS_FACTOR = 0.45;
const BOOST_FACTOR = 1.45;
const BOOST_TIME = 1.3;
const KART_RADIUS = 0.9;
const TOTAL_KARTS = 5;
const AI_NAMES = ["Robo-Rasmus", "Turbo-Tove", "Lyn-Lars", "Vilde Vera"];

type Phase = "intro" | "countdown" | "racing" | "results";

interface Kart {
  group: THREE.Group;
  mii: Mii;
  bodyMat: THREE.MeshStandardMaterial;
  pos: THREE.Vector3;
  heading: number;
  speed: number;
  steer: number;
  boostUntil: number; // racetime
  idxHint: number;
  lap: number;
  t: number; // 0-1 langs banen
  passedHalf: boolean;
  finished: boolean;
  finishTime: number;
  isHuman: boolean;
  autoPilot: boolean; // AI kører (bruges til test og efter målstregen)
  humanIdx: number; // indeks i humans-listen
  name: string;
  color: string;
  aiSkill: number;
  aiPhase: number;
  offRoadTime: number;
}

export async function startKart(app: HTMLElement, players: Player[], onExit: () => void) {
  app.innerHTML = "";

  const host = getActiveHost();
  const remoteMode = !!host && host.currentGame === "kart";

  const container = document.createElement("div");
  container.id = "game-container";
  app.appendChild(container);

  const hud = document.createElement("div");
  hud.className = "hud";
  hud.innerHTML = `
    <div class="hud-top">
      <div class="hud-player"><span class="dot"></span><span class="pname"></span></div>
      <div class="hud-frame" id="kart-status"></div>
      <div style="display:flex;gap:8px">
        <button class="hud-exit" id="hud-tilt" style="display:${remoteMode ? "none" : ""}">📐</button>
        <button class="hud-exit" id="hud-exit">✕</button>
      </div>
    </div>
    <canvas id="minimap" width="150" height="110" style="position:absolute;top:max(64px,env(safe-area-inset-top));right:12px;opacity:0.85"></canvas>
    <div id="split-labels"></div>
    <div class="hud-hint" id="kart-hint" style="display:none"></div>
    <div id="kart-count" style="position:absolute;inset:0;display:none;align-items:center;justify-content:center;
      font-size:clamp(80px,25vw,160px);font-weight:900;color:#fff;text-shadow:0 6px 0 rgba(0,0,0,0.25),0 10px 40px rgba(0,0,0,0.5);pointer-events:none"></div>
  `;
  app.appendChild(hud);
  const hudDot = hud.querySelector<HTMLElement>(".dot")!;
  const hudName = hud.querySelector<HTMLElement>(".pname")!;
  const hudStatus = hud.querySelector<HTMLElement>("#kart-status")!;
  const hudHint = hud.querySelector<HTMLElement>("#kart-hint")!;
  const hudCount = hud.querySelector<HTMLElement>("#kart-count")!;
  const splitLabels = hud.querySelector<HTMLElement>("#split-labels")!;
  const minimap = hud.querySelector<HTMLCanvasElement>("#minimap")!;

  // --- Renderer/scene ---
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h);
  }
  resize();
  window.addEventListener("resize", resize);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x557a44, 1.0));
  const sun = new THREE.DirectionalLight(0xfff4dc, 1.3);
  sun.position.set(120, 180, -60);
  scene.add(sun);

  // --- Bane ---
  let trackDef: TrackDef = TRACKS[0];
  let track: SampledTrack = sampleTrack(trackDef);
  let trackGroup: THREE.Group | null = null;
  let boostWorld: THREE.Vector3[] = [];

  const pseudo = (v: number) => {
    const x = Math.sin(v) * 43758.5453;
    return x - Math.floor(x);
  };

  function buildTrack(def: TrackDef) {
    trackDef = def;
    track = sampleTrack(def);
    scene.background = new THREE.Color(def.sky);
    scene.fog = new THREE.Fog(def.sky, 180, 420);

    if (trackGroup) {
      scene.remove(trackGroup);
      trackGroup.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o.geometry as any).__shared) o.geometry.dispose();
      });
    }
    trackGroup = new THREE.Group();
    scene.add(trackGroup);

    // Græs
    const grass = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshStandardMaterial({ color: def.grass, roughness: 0.95 })
    );
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, -0.05, -100);
    trackGroup.add(grass);

    // Vejbane som triangle strip + kantstriber
    const half = def.width / 2;
    const roadPos: number[] = [];
    const edgePosL: number[] = [];
    const edgePosR: number[] = [];
    const n = track.n;
    const normal = (i: number) => new THREE.Vector3(-track.tans[i].z, 0, track.tans[i].x);
    for (let i = 0; i <= n; i++) {
      const a = i % n;
      const b = (i + 1) % n;
      for (const [i0, i1] of [[a, b]] as const) {
        void i0;
        void i1;
      }
      const p = track.pts[a];
      const p2 = track.pts[b];
      const n1 = normal(a);
      const n2 = normal(b);
      const push = (arr: number[], w0: number, w1: number) => {
        const A = p.clone().addScaledVector(n1, w0);
        const B = p.clone().addScaledVector(n1, w1);
        const C = p2.clone().addScaledVector(n2, w0);
        const D = p2.clone().addScaledVector(n2, w1);
        arr.push(A.x, 0, A.z, B.x, 0, B.z, C.x, 0, C.z, B.x, 0, B.z, D.x, 0, D.z, C.x, 0, C.z);
      };
      push(roadPos, -half, half);
      push(edgePosL, -half - 0.7, -half);
      push(edgePosR, half, half + 0.7);
    }
    const mkMesh = (arr: number[], mat: THREE.Material, y: number) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat);
      m.position.y = y;
      trackGroup!.add(m);
    };
    mkMesh(roadPos, new THREE.MeshStandardMaterial({ color: 0x4a4d55, roughness: 0.85 }), 0.01);
    const edgeMat = new THREE.MeshStandardMaterial({ color: 0xe0e4e8, roughness: 0.7 });
    mkMesh(edgePosL, edgeMat, 0.02);
    mkMesh(edgePosR, edgeMat, 0.02);

    // Kantstriber i rød/hvid (små bokse langs kanten)
    const curbGeoR = new THREE.BoxGeometry(0.7, 0.06, 3);
    (curbGeoR as any).__shared = true;
    const curbRed = new THREE.MeshStandardMaterial({ color: 0xd8433b });
    for (let i = 0; i < n; i += 14) {
      for (const side of [-1, 1]) {
        const m = new THREE.Mesh(curbGeoR, curbRed);
        const nn = normal(i);
        m.position.copy(track.pts[i]).addScaledVector(nn, side * (half + 0.35));
        m.position.y = 0.025;
        m.rotation.y = Math.atan2(track.tans[i].x, track.tans[i].z);
        trackGroup.add(m);
      }
    }

    // Startlinje (ternet)
    const startIdx = 0;
    const sq = new THREE.PlaneGeometry(def.width / 8, 1.2);
    (sq as any).__shared = true;
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const black = new THREE.MeshBasicMaterial({ color: 0x222222 });
    for (let c = 0; c < 8; c++) {
      for (let r = 0; r < 2; r++) {
        const m = new THREE.Mesh(sq, (c + r) % 2 === 0 ? white : black);
        const nn = normal(startIdx);
        m.position
          .copy(track.pts[startIdx])
          .addScaledVector(nn, -half + (c + 0.5) * (def.width / 8));
        m.position.addScaledVector(track.tans[startIdx], r * 1.2);
        m.position.y = 0.03;
        m.rotation.x = -Math.PI / 2;
        m.rotation.z = -Math.atan2(track.tans[startIdx].x, track.tans[startIdx].z);
        trackGroup.add(m);
      }
    }

    // Startportal
    const arch = new THREE.Group();
    const pillarGeo = new THREE.CylinderGeometry(0.5, 0.5, 7, 10);
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0xe0e4e8 });
    const nn0 = normal(startIdx);
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.copy(track.pts[startIdx]).addScaledVector(nn0, side * (half + 1.6));
      p.position.y = 3.5;
      arch.add(p);
    }
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(def.width + 4.5, 1.6, 0.4),
      new THREE.MeshStandardMaterial({ color: 0xd8433b })
    );
    banner.position.copy(track.pts[startIdx]);
    banner.position.y = 7;
    banner.rotation.y = Math.atan2(track.tans[startIdx].x, track.tans[startIdx].z);
    arch.add(banner);
    trackGroup.add(arch);

    // Boost-felter
    boostWorld = [];
    const boostGeo = new THREE.PlaneGeometry(3.4, 4.5);
    (boostGeo as any).__shared = true;
    const boostMat = new THREE.MeshBasicMaterial({ color: 0x36c6ff, transparent: true, opacity: 0.85 });
    for (const bt of def.boosts) {
      const i = Math.floor(bt * n) % n;
      const m = new THREE.Mesh(boostGeo, boostMat);
      m.position.copy(track.pts[i]);
      m.position.y = 0.04;
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(track.tans[i].x, track.tans[i].z);
      trackGroup.add(m);
      boostWorld.push(track.pts[i].clone());
      // Pil på boost-feltet
      const arrow = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
      arrow.position.copy(m.position);
      arrow.position.y = 0.05;
      arrow.rotation.copy(m.rotation);
      trackGroup.add(arrow);
    }

    // Sø (Søbanen)
    if (def.lake) {
      const lake = new THREE.Mesh(
        new THREE.CircleGeometry(def.lake.r, 36),
        new THREE.MeshStandardMaterial({ color: 0x3f9be0, roughness: 0.2 })
      );
      lake.rotation.x = -Math.PI / 2;
      lake.position.set(def.lake.x, 0.005, def.lake.z);
      trackGroup.add(lake);
    }

    // Træer udenom banen (instansieret)
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 4, 6);
    const crownGeo = new THREE.ConeGeometry(2.6, 8, 7);
    const leafGeo = new THREE.IcosahedronGeometry(2.9, 1);
    for (const g of [trunkGeo, crownGeo, leafGeo]) (g as any).__shared = true;
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x2e6b2a, roughness: 0.9 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x4a9440, roughness: 0.9 });

    interface Spot { x: number; z: number; s: number; pine: boolean }
    const spots: Spot[] = [];
    for (let i = 0; i < n; i += 4) {
      for (const side of [-1, 1]) {
        const r1 = pseudo(i * 3.7 + side * 13.1);
        if (r1 < 0.45) continue;
        const r2 = pseudo(i * 9.1 + side * 5.7);
        const dist = half + 9 + r2 * 45;
        const nn = normal(i);
        const px = track.pts[i].x + nn.x * side * dist;
        const pz = track.pts[i].z + nn.z * side * dist;
        // Ikke i søen og ikke oven på et andet stykke vej
        if (def.lake && Math.hypot(px - def.lake.x, pz - def.lake.z) < def.lake.r + 4) continue;
        const ni = nearestIdxFull(track, px, pz);
        const np = track.pts[ni];
        if (Math.hypot(px - np.x, pz - np.z) < half + 4) continue;
        spots.push({ x: px, z: pz, s: 0.7 + r2 * 0.7, pine: r1 > 0.7 });
      }
    }
    const m4 = new THREE.Matrix4();
    const addInst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: Spot[], yOf: (s: number) => number, sy: number) => {
      if (list.length === 0) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((c, idx) => {
        m4.makeScale(c.s, c.s * sy, c.s);
        m4.setPosition(c.x, yOf(c.s), c.z);
        im.setMatrixAt(idx, m4);
      });
      im.instanceMatrix.needsUpdate = true;
      trackGroup!.add(im);
    };
    const pines = spots.filter((c) => c.pine);
    const leafs = spots.filter((c) => !c.pine);
    addInst(trunkGeo, trunkMat, pines, (s) => 2 * s, 1);
    addInst(crownGeo, pineMat, pines, (s) => 6.2 * s, 1);
    addInst(trunkGeo, trunkMat, leafs, (s) => 2 * s, 1);
    addInst(leafGeo, leafMat, leafs, (s) => 5.1 * s, 0.85);
  }

  // --- Karts ---
  const AI_COLORS = PLAYER_COLORS.slice().reverse();
  const humans: Player[] = remoteMode ? players.slice(0, 4) : players.slice(0, 1);
  const karts: Kart[] = [];

  function makeKartMesh(color: string): { group: THREE.Group; mii: Mii; bodyMat: THREE.MeshStandardMaterial } {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.4, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.45, 2.0), bodyMat);
    body.position.y = 0.45;
    group.add(body);
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3, 0.6), bodyMat);
    front.position.set(0, 0.5, 1.15);
    group.add(front);
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.35), bodyMat);
    spoiler.position.set(0, 0.85, -1.0);
    group.add(spoiler);
    const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.3, 12);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
    for (const [wx, wz] of [
      [-0.75, -0.75],
      [0.75, -0.75],
      [-0.75, 0.75],
      [0.75, 0.75],
    ]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, 0.32, wz);
      group.add(w);
    }
    const mii = makeMii(color, "bowling");
    mii.group.scale.setScalar(0.72);
    // "Sidder" i kartet: benene er skjult nede i karrosseriet
    mii.group.position.set(0, 0.12, -0.25);
    mii.group.rotation.y = Math.PI; // kigger fremad (mod lokal +z = køreretningen)
    group.add(mii.group);
    return { group, mii, bodyMat };
  }

  function setupKarts() {
    for (const k of karts) scene.remove(k.group);
    karts.length = 0;
    const aiCount = TOTAL_KARTS - humans.length;
    const lineup: { name: string; color: string; isHuman: boolean; humanIdx: number }[] = [];
    humans.forEach((p, i) => lineup.push({ name: p.name, color: p.color, isHuman: true, humanIdx: i }));
    // AI'er: brug først evt. ekstra opsatte spillere som navne, ellers standardnavne
    const extraPlayers = remoteMode ? [] : players.slice(1);
    for (let i = 0; i < aiCount; i++) {
      const src = extraPlayers[i];
      const usedColors = lineup.map((l) => l.color);
      const color = src?.color && !usedColors.includes(src.color)
        ? src.color
        : AI_COLORS.find((c) => !usedColors.includes(c)) || AI_COLORS[i % AI_COLORS.length];
      lineup.push({ name: src?.name ?? AI_NAMES[i % AI_NAMES.length], color, isHuman: false, humanIdx: -1 });
    }

    lineup.forEach((l, i) => {
      const { group, mii, bodyMat } = makeKartMesh(l.color);
      scene.add(group);
      // Startgitter: bag startlinjen, forskudt
      const row = Math.floor(i / 2);
      const col = i % 2 === 0 ? -1 : 1;
      const idx = (track.n - 6 - row * 8 + track.n) % track.n;
      const nn = new THREE.Vector3(-track.tans[idx].z, 0, track.tans[idx].x);
      const pos = track.pts[idx].clone().addScaledVector(nn, col * trackDef.width * 0.22);
      const heading = Math.atan2(track.tans[idx].x, track.tans[idx].z);
      karts.push({
        group,
        mii,
        bodyMat,
        pos,
        heading,
        speed: 0,
        steer: 0,
        boostUntil: -1,
        idxHint: idx,
        lap: 0,
        t: 0.97,
        passedHalf: true,
        finished: false,
        finishTime: 0,
        isHuman: l.isHuman,
        autoPilot: false,
        humanIdx: l.humanIdx,
        name: l.name,
        color: l.color,
        aiSkill: 0.86 + pseudo(i * 17.3) * 0.1,
        aiPhase: pseudo(i * 7.7) * Math.PI * 2,
        offRoadTime: 0,
      });
    });
  }

  // --- Input ---
  const humanSteer: number[] = humans.map(() => 0);
  let tiltActive = false;

  // Tastatur (PC)
  const keys = { left: false, right: false };
  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.key === "ArrowLeft" || e.key === "a") keys.left = down;
    if (e.key === "ArrowRight" || e.key === "d") keys.right = down;
  };
  const keyDown = (e: KeyboardEvent) => onKey(e, true);
  const keyUp = (e: KeyboardEvent) => onKey(e, false);
  window.addEventListener("keydown", keyDown);
  window.addEventListener("keyup", keyUp);

  // Touch: venstre/højre skærmhalvdel
  const touchSteer = new Map<number, number>();
  const canvas = renderer.domElement;
  const updateTouchSteer = () => {
    if (remoteMode) return;
    let v = 0;
    for (const s of touchSteer.values()) v += s;
    humanSteer[0] = THREE.MathUtils.clamp(v, -1, 1);
  };
  canvas.addEventListener("pointerdown", (e) => {
    const w = container.clientWidth || window.innerWidth;
    touchSteer.set(e.pointerId, e.clientX < w / 2 ? -1 : 1);
    updateTouchSteer();
  });
  const releaseTouch = (e: PointerEvent) => {
    touchSteer.delete(e.pointerId);
    updateTouchSteer();
  };
  canvas.addEventListener("pointerup", releaseTouch);
  canvas.addEventListener("pointercancel", releaseTouch);

  // Tilt/rat-styring (portræt = vip, landskab = drej som et rat)
  const onOrientation = (e: DeviceOrientationEvent) => {
    if (!tiltActive || remoteMode) return;
    humanSteer[0] = steerFromOrientation(e);
  };
  hud.querySelector("#hud-tilt")!.addEventListener("click", async () => {
    const DOE = DeviceOrientationEvent as any;
    if (typeof DOE?.requestPermission === "function") {
      try {
        const res = await DOE.requestPermission();
        if (res !== "granted") return;
      } catch {
        return;
      }
    }
    tiltActive = !tiltActive;
    (hud.querySelector("#hud-tilt") as HTMLElement).style.background = tiltActive ? "#a8e6a0" : "";
    if (!tiltActive) humanSteer[0] = 0;
  });
  window.addEventListener("deviceorientation", onOrientation);

  // Fjern-input fra telefoner
  if (remoteMode && host) {
    host.onInput = (idx, msg) => {
      if (destroyed) return;
      if (msg.t === "steer" && idx < humanSteer.length) {
        humanSteer[idx] = THREE.MathUtils.clamp(msg.v, -1, 1);
      }
    };
  }

  // --- Løbslogik ---
  let phase: Phase = "intro";
  let raceTime = 0;
  let countdownStart = 0;
  let destroyed = false;
  let ranking: number[] = [];
  let lastInfoSent = 0;

  function progressOf(k: Kart): number {
    return k.lap + k.t;
  }

  function updateRanking() {
    ranking = karts.map((_, i) => i);
    ranking.sort((a, b) => {
      const ka = karts[a];
      const kb = karts[b];
      if (ka.finished && kb.finished) return ka.finishTime - kb.finishTime;
      if (ka.finished) return -1;
      if (kb.finished) return 1;
      return progressOf(kb) - progressOf(ka);
    });
  }

  function positionOf(kartIdx: number): number {
    return ranking.indexOf(kartIdx) + 1;
  }

  function stepKart(k: Kart, dt: number) {
    if (phase !== "racing") return;

    // AI-styring (og mennesker der er færdige køres af AI)
    if (!k.isHuman || k.finished || k.autoPilot) {
      // Kig længere frem ved høj fart, så svingene tages pænt
      const look = Math.round(8 + k.speed * 0.7);
      const target = track.pts[(k.idxHint + look) % track.n];
      const dx = target.x - k.pos.x;
      const dz = target.z - k.pos.z;
      const targetHeading = Math.atan2(dx, dz);
      let diff = targetHeading - k.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      k.steer = THREE.MathUtils.clamp(diff * 2.2 + Math.sin(raceTime * 1.3 + k.aiPhase) * 0.05, -1, 1);
    } else {
      k.steer = humanSteer[k.humanIdx] ?? 0;
    }

    // Underlag
    const ni = nearestIdx(track, k.pos.x, k.pos.z, k.idxHint);
    k.idxHint = ni;
    const np = track.pts[ni];
    const distCenter = Math.hypot(k.pos.x - np.x, k.pos.z - np.z);
    const onRoad = distCenter < trackDef.width / 2 + 0.8;
    if (!onRoad) k.offRoadTime += dt;
    else k.offRoadTime = 0;

    // For langt ude: sæt tilbage på banen
    if (distCenter > trackDef.width / 2 + 16 || k.offRoadTime > 4) {
      k.pos.copy(np);
      k.heading = Math.atan2(track.tans[ni].x, track.tans[ni].z);
      k.speed = 5;
      k.offRoadTime = 0;
    }

    // Fart
    const boosting = raceTime < k.boostUntil;
    let target = MAX_SPEED * (k.isHuman && !k.finished ? 1 : k.aiSkill);
    if (!onRoad) target *= GRASS_FACTOR;
    if (boosting) target *= BOOST_FACTOR;
    // Rubber-banding for AI
    if (!k.isHuman && ranking.length > 0) {
      const leaderProg = progressOf(karts[ranking[0]]);
      const diff = leaderProg - progressOf(k);
      if (diff > 0.2) target *= 1.07;
      else if (diff < -0.05) target *= 0.96;
    }
    k.speed += (target - k.speed) * (k.speed < target ? 0.9 : 2.2) * dt;

    // Styring (mindre effekt ved høj fart)
    const steerRate = 2.1 * Math.min(1, k.speed / 7) * (1.15 - (0.35 * k.speed) / MAX_SPEED);
    k.heading += k.steer * steerRate * dt;

    // Bevægelse
    k.pos.x += Math.sin(k.heading) * k.speed * dt;
    k.pos.z += Math.cos(k.heading) * k.speed * dt;

    // Boost-felter
    for (const b of boostWorld) {
      if (Math.hypot(k.pos.x - b.x, k.pos.z - b.z) < 2.6) {
        if (k.isHuman && raceTime > k.boostUntil) sfx.boost();
        k.boostUntil = raceTime + BOOST_TIME;
      }
    }

    // Omgangstælling
    const newT = ni / track.n;
    if (newT > 0.4 && newT < 0.6) k.passedHalf = true;
    if (k.t > 0.85 && newT < 0.15 && k.passedHalf) {
      k.lap++;
      k.passedHalf = false;
      if (k.lap >= trackDef.laps && !k.finished) {
        k.finished = true;
        k.finishTime = raceTime;
        if (k.isHuman) {
          showToast(`${k.name}: ${positionOf(karts.indexOf(k))}. plads! 🏁`);
          sfx.fanfare();
        }
        checkRaceEnd();
      }
    }
    k.t = newT;
  }

  function collideKarts() {
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i];
        const b = karts[j];
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const d = Math.hypot(dx, dz);
        if (d < KART_RADIUS * 2 && d > 0.001) {
          const push = (KART_RADIUS * 2 - d) / 2;
          const ux = dx / d;
          const uz = dz / d;
          a.pos.x -= ux * push;
          a.pos.z -= uz * push;
          b.pos.x += ux * push;
          b.pos.z += uz * push;
          a.speed *= 0.96;
          b.speed *= 0.96;
        }
      }
    }
  }

  function checkRaceEnd() {
    const allHumansDone = karts.filter((k) => k.isHuman).every((k) => k.finished);
    if (allHumansDone && phase === "racing") {
      phase = "results";
      sfx.engine.stop();
      setTimeout(() => !destroyed && showResults(), 1200);
    }
  }

  // --- Kameraer (split-screen i TV-tilstand) ---
  const cameras = humans.map(() => {
    const c = new THREE.PerspectiveCamera(62, 1, 0.1, 800);
    return c;
  });
  const camTarget = new THREE.Vector3();

  function viewportFor(i: number, w: number, h: number): [number, number, number, number] {
    const count = humans.length;
    if (count === 1) return [0, 0, w, h];
    if (count === 2) return [0, i === 0 ? h / 2 : 0, w, h / 2];
    const col = i % 2;
    const row = Math.floor(i / 2);
    return [col * (w / 2), row === 0 ? h / 2 : 0, w / 2, h / 2];
  }

  function updateCamera(i: number, dt: number) {
    const k = karts.find((kk) => kk.isHuman && kk.humanIdx === i) ?? karts[0];
    if (!k) {
      // Intro: oversigt over banen
      cameras[i].position.set(0, 90, 80);
      cameras[i].lookAt(0, 0, -90);
      return;
    }
    const fwd = new THREE.Vector3(Math.sin(k.heading), 0, Math.cos(k.heading));
    const desired = k.pos.clone().addScaledVector(fwd, -7).add(new THREE.Vector3(0, 3.4, 0));
    cameras[i].position.lerp(desired, Math.min(1, dt * 6));
    camTarget.copy(k.pos).addScaledVector(fwd, 7).setY(1);
    cameras[i].lookAt(camTarget);
  }

  // --- Minimap ---
  const mmCtx = minimap.getContext("2d")!;
  let mmScale = 1;
  let mmOff = { x: 0, z: 0 };
  function setupMinimap() {
    const xs = track.pts.map((p) => p.x);
    const zs = track.pts.map((p) => p.z);
    const minx = Math.min(...xs), maxx = Math.max(...xs);
    const minz = Math.min(...zs), maxz = Math.max(...zs);
    mmScale = Math.min(130 / (maxx - minx), 90 / (maxz - minz));
    mmOff = { x: (minx + maxx) / 2, z: (minz + maxz) / 2 };
  }
  const mm = (x: number, z: number): [number, number] => [
    75 + (x - mmOff.x) * mmScale,
    55 + (z - mmOff.z) * mmScale,
  ];
  function drawMinimap() {
    mmCtx.clearRect(0, 0, 150, 110);
    mmCtx.strokeStyle = "rgba(255,255,255,0.85)";
    mmCtx.lineWidth = 4;
    mmCtx.beginPath();
    for (let i = 0; i <= track.n; i += 5) {
      const p = track.pts[i % track.n];
      const [x, y] = mm(p.x, p.z);
      if (i === 0) mmCtx.moveTo(x, y);
      else mmCtx.lineTo(x, y);
    }
    mmCtx.closePath();
    mmCtx.stroke();
    for (const k of karts) {
      const [x, y] = mm(k.pos.x, k.pos.z);
      mmCtx.fillStyle = k.color;
      mmCtx.beginPath();
      mmCtx.arc(x, y, k.isHuman ? 5 : 3.5, 0, Math.PI * 2);
      mmCtx.fill();
      if (k.isHuman) {
        mmCtx.strokeStyle = "#fff";
        mmCtx.lineWidth = 1.5;
        mmCtx.stroke();
      }
    }
  }

  // --- HUD ---
  function updateHudInfo() {
    const k0 = karts.find((k) => k.isHuman && k.humanIdx === 0);
    if (humans.length === 1 && k0) {
      const p = humans[0];
      hudDot.style.background = p.color;
      hudName.textContent = p.name;
      const kidx = karts.indexOf(k0);
      hudStatus.textContent = `${positionOf(kidx)}. plads · Omgang ${Math.min(k0.lap + 1, trackDef.laps)}/${trackDef.laps}`;
      splitLabels.innerHTML = "";
    } else {
      hudName.textContent = trackDef.name;
      hudDot.style.background = "#4fb2ea";
      hudStatus.textContent = "";
      // Etiketter pr. split-view
      let html = "";
      humans.forEach((p, i) => {
        const k = karts.find((kk) => kk.isHuman && kk.humanIdx === i);
        if (!k) return;
        const kidx = karts.indexOf(k);
        const count = humans.length;
        const top = count === 2 ? (i === 0 ? "8%" : "56%") : i < 2 ? "8%" : "56%";
        const left = count === 2 ? "12px" : i % 2 === 0 ? "12px" : "52%";
        html += `<div style="position:absolute;top:${top};left:${left};background:rgba(255,255,255,0.9);border-radius:10px;
          padding:4px 10px;font-weight:800;font-size:14px;color:#33505f;display:flex;align-items:center;gap:6px">
          <span style="width:10px;height:10px;border-radius:50%;background:${p.color}"></span>
          ${escapeHtml(p.name)} · ${positionOf(kidx)}. · Omg. ${Math.min(k.lap + 1, trackDef.laps)}/${trackDef.laps}</div>`;
      });
      splitLabels.innerHTML = html;
    }
    // Send status til telefonerne med mellemrum
    if (remoteMode && host && raceTime - lastInfoSent > 2) {
      lastInfoSent = raceTime;
      humans.forEach((_, i) => {
        const k = karts.find((kk) => kk.isHuman && kk.humanIdx === i)!;
        const kidx = karts.indexOf(k);
        host.send(i, {
          t: "info",
          index: i,
          info: `${positionOf(kidx)}. plads · Omgang ${Math.min(k.lap + 1, trackDef.laps)}/${trackDef.laps}`,
        });
      });
    }
  }

  function showToast(text: string) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    app.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }

  // --- Overlays ---
  function showTrackIntro() {
    const ov = document.createElement("div");
    ov.className = "overlay";
    const btns = TRACKS.map(
      (t, i) =>
        `<button class="btn ${i === 0 ? "btn-primary" : "btn-secondary"}" data-track="${i}">${i === 0 ? "🌲" : "🌊"} ${t.name}</button>`
    ).join("");
    ov.innerHTML = `
      <h2>🏎️ Kart Racing</h2>
      <p>${trackDef.laps} omgange · ${humans.length} ${humans.length === 1 ? "kører" : "kørere"} mod ${TOTAL_KARTS - humans.length} computerstyrede<br>
      ${remoteMode ? "Styr med telefonen: knapper eller vip den! 📱" : "Hold i siderne af skærmen, piletaster, eller 📐 tilt"}</p>
      <div class="btn-row">${btns}</div>
    `;
    let done = false;
    const pick = (i: number) => {
      if (done) return;
      done = true;
      ov.remove();
      startRace(i);
    };
    ov.querySelectorAll<HTMLButtonElement>("[data-track]").forEach((b) =>
      b.addEventListener("click", () => pick(parseInt(b.dataset.track!)))
    );
    if (remoteMode) setTimeout(() => pick(0), 6000);
    app.appendChild(ov);
  }

  function startRace(trackIdx: number) {
    buildTrack(TRACKS[trackIdx]);
    setupKarts();
    setupMinimap();
    updateRanking();
    raceTime = 0;
    countdownStart = 0;
    phase = "countdown";
    hudCount.style.display = "flex";
  }

  function showResults() {
    updateRanking();
    const rows = ranking
      .map((ki, place) => {
        const k = karts[ki];
        const medal = place === 0 ? "🥇" : place === 1 ? "🥈" : place === 2 ? "🥉" : `${place + 1}.`;
        const time = k.finished ? `${k.finishTime.toFixed(1)} s` : "—";
        return `<div style="display:flex;align-items:center;gap:10px;padding:5px 0;font-size:18px;color:#fff">
          <span style="width:36px;text-align:center;font-size:22px">${medal}</span>
          <span style="width:14px;height:14px;border-radius:50%;background:${k.color}"></span>
          <b>${escapeHtml(k.name)}</b><span style="opacity:0.8;margin-left:auto">${time}</span></div>`;
      })
      .join("");
    const winner = karts[ranking[0]];
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="big-avatar" style="background:${winner.color}">🏆</div>
      <h2>${escapeHtml(winner.name)} vinder løbet!</h2>
      <div style="width:100%;max-width:360px;margin-bottom:20px">${rows}</div>
      <div class="btn-row">
        <button class="btn btn-secondary" id="res-menu">Hovedmenu</button>
        <button class="btn btn-primary" id="res-again">Kør igen 🏎️</button>
      </div>
    `;
    ov.querySelector("#res-menu")!.addEventListener("click", () => {
      destroy();
      onExit();
    });
    ov.querySelector("#res-again")!.addEventListener("click", () => {
      ov.remove();
      showTrackIntro();
    });
    app.appendChild(ov);
  }

  hud.querySelector("#hud-exit")!.addEventListener("click", () => {
    destroy();
    onExit();
  });

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
      if (phase === "countdown") {
        countdownStart += FIXED_DT;
        const left = 3.6 - countdownStart;
        if (left <= 0.6) {
          if (hudCount.textContent !== "KØR!") {
            hudCount.textContent = "KØR!";
            sfx.beep(true);
            sfx.engine.start();
          }
          if (phase === "countdown" && left <= 0) {
            phase = "racing";
            setTimeout(() => (hudCount.style.display = "none"), 700);
          }
        } else {
          const num = String(Math.ceil(left - 0.6));
          if (hudCount.textContent !== num) {
            hudCount.textContent = num;
            sfx.beep(false);
          }
        }
      } else if (phase === "racing") {
        raceTime += FIXED_DT;
        for (const k of karts) stepKart(k, FIXED_DT);
        collideKarts();
        updateRanking();
      }
      accumulator -= FIXED_DT;
    }

    // Synk grafik
    for (const k of karts) {
      k.group.position.copy(k.pos);
      k.group.rotation.y = k.heading;
      // lille hop ved boost
      k.group.position.y = raceTime < k.boostUntil ? 0.06 : 0;
      k.mii.update(performance.now());
    }

    if (karts.length > 0 && ranking.length === karts.length) {
      updateHudInfo();
      drawMinimap();
      // Motorlyd følger den (første) menneskelige kørers fart
      if (phase === "racing") {
        const hk = karts.find((k) => k.isHuman) ?? karts[0];
        sfx.engine.setSpeed(Math.min(1, hk.speed / MAX_SPEED));
      }
    }

    // Render (split-screen ved flere kørere)
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setScissorTest(humans.length > 1);
    renderer.clear();
    for (let i = 0; i < cameras.length; i++) {
      updateCamera(i, dt);
      const [vx, vy, vw, vh] = viewportFor(i, w, h);
      cameras[i].aspect = vw / vh;
      cameras[i].updateProjectionMatrix();
      renderer.setViewport(vx, vy, vw, vh);
      renderer.setScissor(vx, vy, vw, vh);
      renderer.render(scene, cameras[i]);
    }
  }

  // Debug-hooks
  (window as any).__wiiStep = (seconds: number) => {
    for (let s = 0; s < seconds; s += FIXED_DT) advance(FIXED_DT);
  };
  (window as any).__kartState = () => ({
    phase,
    raceTime: +raceTime.toFixed(1),
    karts: karts.map((k, i) => ({
      name: k.name,
      isHuman: k.isHuman,
      lap: k.lap,
      t: +k.t.toFixed(2),
      speed: +k.speed.toFixed(1),
      pos: positionOf(i),
      finished: k.finished,
    })),
  });
  (window as any).__kartSteer = (v: number) => {
    humanSteer[0] = THREE.MathUtils.clamp(v, -1, 1);
  };
  (window as any).__kartAuto = (on: boolean) => {
    const k = karts.find((kk) => kk.isHuman && kk.humanIdx === 0);
    if (k) k.autoPilot = on;
    return on;
  };
  (window as any).__kartPickTrack = (i: number) => {
    const btn = document.querySelector<HTMLButtonElement>(`[data-track="${i}"]`);
    btn?.click();
    return !!btn;
  };

  function destroy() {
    destroyed = true;
    sfx.engine.stop();
    if (remoteMode && host) host.onInput = null;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    window.removeEventListener("keydown", keyDown);
    window.removeEventListener("keyup", keyUp);
    window.removeEventListener("deviceorientation", onOrientation);
    renderer.dispose();
    hud.remove();
    container.remove();
    app.innerHTML = "";
  }

  // Start
  buildTrack(TRACKS[0]);
  showTrackIntro();
  loop();
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
