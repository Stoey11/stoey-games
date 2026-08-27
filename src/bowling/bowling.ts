import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { Player, addHighscore, initialFor } from "../players";
import { BowlingScorecard } from "./scoring";
import { getActiveHost } from "../net/host";
import { makeMii } from "../mii";
import * as sfx from "../sound";

// --- Banens mål (meter, cirka rigtige bowlingmål) ---
const LANE_HALF_W = 0.53;
const GUTTER_W = 0.24;
const GUTTER_DROP = 0.13;
const LANE_START_Z = 2.2; // bag kastelinjen
const LANE_END_Z = -18.3; // bagvæg/pit
const BALL_R = 0.108;
const BALL_START = new THREE.Vector3(0, BALL_R + 0.001, 0);
const PIN_HEAD_Z = -16.5;
const PIN_SPACING = 0.3048;
const PIN_ROW_DEPTH = 0.264;
const MAX_AIM_ANGLE = 0.16; // ±ca. 9 grader
const LANE_SPACING = 2 * (LANE_HALF_W + GUTTER_W + 0.06) + 0.28; // afstand mellem nabobaner

const PIN_POSITIONS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let row = 0; row < 4; row++) {
    const z = PIN_HEAD_Z - row * PIN_ROW_DEPTH;
    for (let i = 0; i <= row; i++) {
      const x = (i - row / 2) * PIN_SPACING;
      out.push([x, z]);
    }
  }
  return out;
})();

interface Pin {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  standing: boolean;
  parked: boolean;
}

type Phase = "aiming" | "rolling" | "transition";

let rapierReady: Promise<unknown> | null = null;

// ---------- Teksturer og geometri (laves én gang) ----------

function makeWoodTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 1024;
  const g = c.getContext("2d")!;
  // Bund: lys ahorn
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, "#e6bc7d");
  grad.addColorStop(0.5, "#edc98e");
  grad.addColorStop(1, "#e2b674");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 1024);
  // Brædder på langs (lodrette i teksturen)
  const plankW = 256 / 10;
  for (let i = 0; i < 10; i++) {
    if (i % 2 === 0) {
      g.fillStyle = "rgba(160, 105, 45, 0.10)";
      g.fillRect(i * plankW, 0, plankW, 1024);
    }
    g.fillStyle = "rgba(120, 75, 30, 0.35)";
    g.fillRect(i * plankW, 0, 1.5, 1024);
  }
  // Let åretegning
  for (let i = 0; i < 140; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 1024;
    const len = 30 + Math.random() * 120;
    g.strokeStyle = `rgba(150, 95, 40, ${0.04 + Math.random() * 0.06})`;
    g.lineWidth = 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 6, y + len);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}

function makePinStripeTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fdf9f2";
  g.fillRect(0, 0, 16, 256);
  // To røde ringe om halsen (v ≈ 0.60-0.72 på lathe-profilen)
  g.fillStyle = "#d8433b";
  g.fillRect(0, 158, 16, 10);
  g.fillRect(0, 174, 16, 10);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

// Rigtig keglefacon som drejeprofil (radius, højde)
const PIN_PROFILE: [number, number][] = [
  [0.001, 0],
  [0.045, 0],
  [0.056, 0.03],
  [0.0605, 0.114],
  [0.055, 0.16],
  [0.042, 0.20],
  [0.0285, 0.24],
  [0.0225, 0.265],
  [0.024, 0.29],
  [0.0305, 0.325],
  [0.0325, 0.345],
  [0.026, 0.365],
  [0.014, 0.378],
  [0.001, 0.381],
];

function makePinGeometry(): THREE.LatheGeometry {
  const pts = PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, 20);
}

// ---------- Hovedfunktion ----------

export async function startBowling(app: HTMLElement, players: Player[], onExit: () => void) {
  if (!rapierReady) rapierReady = RAPIER.init();
  await rapierReady;

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
    <div class="aim-controls">
      <div class="ctl-wrap">
        <div class="ctl-label">Flyt</div>
        <div class="ctl-group">
          <button class="ctl-btn" id="mv-left">◀</button>
          <button class="ctl-btn" id="mv-right">▶</button>
        </div>
      </div>
      <div class="ctl-wrap">
        <div class="ctl-label">Drej</div>
        <div class="ctl-group">
          <button class="ctl-btn" id="rot-left">↺</button>
          <button class="ctl-btn" id="rot-right">↻</button>
        </div>
      </div>
    </div>
    <div class="hud-hint">Flyt & drej — swipe op for at kaste! 🎳</div>
  `;
  app.appendChild(hud);
  const hudDot = hud.querySelector<HTMLElement>(".dot")!;
  const hudName = hud.querySelector<HTMLElement>(".pname")!;
  const hudFrame = hud.querySelector<HTMLElement>(".hud-frame")!;
  const hudHint = hud.querySelector<HTMLElement>(".hud-hint")!;
  const aimControls = hud.querySelector<HTMLElement>(".aim-controls")!;

  // --- Three.js scene ---
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x27394d);
  scene.fog = new THREE.Fog(0x27394d, 30, 55);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.set(0, 1.9, 3.1);
  camera.lookAt(0, 0.25, PIN_HEAD_Z);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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

  // Lys: dæmpet hal + varmt lys over banen
  scene.add(new THREE.HemisphereLight(0xbdd4e8, 0x3a3226, 0.85));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.4);
  sun.position.set(3, 10, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -4;
  sun.shadow.camera.right = 4;
  sun.shadow.camera.top = 4;
  sun.shadow.camera.bottom = -22;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 30;
  scene.add(sun);
  const pinLight = new THREE.PointLight(0xfff2cc, 12, 8);
  pinLight.position.set(0, 1.6, PIN_HEAD_Z - 0.4);
  scene.add(pinLight);

  const laneLen = LANE_START_Z - LANE_END_Z;
  const laneCenterZ = (LANE_START_Z + LANE_END_Z) / 2;

  // --- Delte materialer/geometrier ---
  const woodTex = makeWoodTexture();
  const laneMat = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.18, metalness: 0.05 });
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 0.4 });
  const gutterMat = new THREE.MeshStandardMaterial({ color: 0x767f88, roughness: 0.35, metalness: 0.55, side: THREE.DoubleSide });
  const railMat = new THREE.MeshStandardMaterial({ color: 0x2b3946, roughness: 0.5 });
  const pinGeo = makePinGeometry();
  const pinMat = new THREE.MeshStandardMaterial({ map: makePinStripeTexture(), roughness: 0.22 });
  const gutterGeo = new THREE.CylinderGeometry(GUTTER_W / 2, GUTTER_W / 2, laneLen, 10, 1, true, Math.PI, Math.PI);

  // Bygger én banes grafik (bane, render, kanter); genbruges til nabobaner
  function buildLaneVisual(offsetX: number, decorative: boolean): THREE.Group {
    const g = new THREE.Group();

    const lane = new THREE.Mesh(new THREE.BoxGeometry(LANE_HALF_W * 2, 0.1, laneLen), laneMat);
    lane.position.set(0, -0.05, laneCenterZ);
    lane.receiveShadow = !decorative;
    g.add(lane);

    // Mørkt pin-deck bagerst
    const deck = new THREE.Mesh(new THREE.BoxGeometry(LANE_HALF_W * 2, 0.004, 2.6), deckMat);
    deck.position.set(0, 0.002, PIN_HEAD_Z - 0.5);
    g.add(deck);

    // Render: åbne halvrør
    for (const side of [-1, 1]) {
      const gm = new THREE.Mesh(gutterGeo, gutterMat);
      gm.rotation.x = Math.PI / 2;
      gm.position.set(side * (LANE_HALF_W + GUTTER_W / 2), -0.03, laneCenterZ);
      g.add(gm);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, laneLen), railMat);
      rail.position.set(side * (LANE_HALF_W + GUTTER_W + 0.035), 0.02, laneCenterZ);
      g.add(rail);
    }

    // Sigtepile (7 pile i V-form) og prikker — kun kosmetik
    if (!decorative) {
      const arrowMat = new THREE.MeshStandardMaterial({ color: 0x7a4a1e, roughness: 0.4 });
      const shape = new THREE.Shape();
      shape.moveTo(0, 0.09);
      shape.lineTo(0.035, -0.05);
      shape.lineTo(-0.035, -0.05);
      shape.closePath();
      const arrowGeo = new THREE.ShapeGeometry(shape);
      for (let i = -3; i <= 3; i++) {
        const a = new THREE.Mesh(arrowGeo, arrowMat);
        a.rotation.x = -Math.PI / 2;
        a.position.set(i * 0.13, 0.002, -4.4 - Math.abs(i) * 0.35);
        g.add(a);
      }
      const dotGeo = new THREE.CircleGeometry(0.016, 10);
      for (let i = -2; i <= 2; i++) {
        const d = new THREE.Mesh(dotGeo, arrowMat);
        d.rotation.x = -Math.PI / 2;
        d.position.set(i * 0.16, 0.002, -2.1);
        g.add(d);
      }
    }

    g.position.x = offsetX;
    return g;
  }

  scene.add(buildLaneVisual(0, false));

  // Nabobaner med statiske pyntekegler
  for (const laneIdx of [-2, -1, 1, 2]) {
    const offsetX = laneIdx * LANE_SPACING;
    scene.add(buildLaneVisual(offsetX, true));
    for (const [px, pz] of PIN_POSITIONS) {
      const m = new THREE.Mesh(pinGeo, pinMat);
      m.position.set(offsetX + px, 0, pz);
      scene.add(m);
    }
  }

  // --- Hallen ---
  const hallHalfW = LANE_SPACING * 2.5 + 0.6;

  // Gulvtæppe foran banerne (mønstret, mørkeblåt)
  const carpet = new THREE.Mesh(
    new THREE.PlaneGeometry(hallHalfW * 2 + 8, 10),
    new THREE.MeshStandardMaterial({ color: 0x27354d, roughness: 0.95 })
  );
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, -0.001, LANE_START_Z + 4.9);
  scene.add(carpet);
  // Gulv under banerne (mørkt, ses mellem baner)
  const underFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(hallHalfW * 2 + 8, laneLen + 12),
    new THREE.MeshStandardMaterial({ color: 0x1a2532, roughness: 0.95 })
  );
  underFloor.rotation.x = -Math.PI / 2;
  underFloor.position.set(0, -0.28, laneCenterZ);
  scene.add(underFloor);

  // Loft med lysstriber
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(hallHalfW * 2 + 8, laneLen + 14),
    new THREE.MeshStandardMaterial({ color: 0x31465c, roughness: 0.9, side: THREE.DoubleSide })
  );
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(0, 3.4, laneCenterZ);
  scene.add(ceiling);
  const stripMat = new THREE.MeshStandardMaterial({ color: 0xfff6da, emissive: 0xfff0c0, emissiveIntensity: 1.6 });
  for (let z = 1; z > LANE_END_Z; z -= 4) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(hallHalfW * 2, 0.05, 0.3), stripMat);
    strip.position.set(0, 3.35, z);
    scene.add(strip);
  }

  // Sidevægge
  const wallMat2 = new THREE.MeshStandardMaterial({ color: 0x2e4257, roughness: 0.85 });
  for (const side of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(laneLen + 14, 3.8), wallMat2);
    wall.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    wall.position.set(side * (hallHalfW + 4), 1.7, laneCenterZ);
    scene.add(wall);
  }

  // Masking-væg over pin-decks: mørk med neonglød (Wii-farvede cirkler)
  const masking = new THREE.Mesh(
    new THREE.BoxGeometry(hallHalfW * 2 + 2, 2.6, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x101820, roughness: 0.9 })
  );
  masking.position.set(0, 1.95, LANE_END_Z - 0.5);
  scene.add(masking);
  const neonColors = [0xe2564e, 0x3f9be0, 0x57b854, 0xe8a838, 0x9b6bd4];
  for (let i = -5; i <= 5; i++) {
    const col = neonColors[((i % 5) + 5) % 5];
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.28, 0.045, 10, 28),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.3 })
    );
    ring.position.set(i * 1.05, 1.35, LANE_END_Z - 0.4);
    scene.add(ring);
  }
  // Pit: mørkt "hul" bag keglerne med gardin, der fanger kuglen
  const pitMat = new THREE.MeshStandardMaterial({ color: 0x0a0e14, roughness: 1 });
  const pitFloor = new THREE.Mesh(new THREE.BoxGeometry(hallHalfW * 2 + 2, 0.02, 1.2), pitMat);
  pitFloor.position.set(0, -0.16, LANE_END_Z + 0.05);
  scene.add(pitFloor);
  const curtain = new THREE.Mesh(
    new THREE.BoxGeometry(hallHalfW * 2 + 2, 0.75, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x10151c, roughness: 0.95 })
  );
  curtain.position.set(0, 0.66, LANE_END_Z + 0.35);
  scene.add(curtain);

  // Glødende kant lige over pin-området
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(hallHalfW * 2 + 2, 0.08, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x9fd8ff, emissive: 0x6db8f0, emissiveIntensity: 2 })
  );
  glow.position.set(0, 0.72, LANE_END_Z - 0.42);
  scene.add(glow);

  // Kuglestativ ved spilleren (pynt)
  const rack = new THREE.Group();
  const rackBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.36, 0.55, 16),
    new THREE.MeshStandardMaterial({ color: 0x37475a, roughness: 0.4, metalness: 0.4 })
  );
  rackBase.position.y = 0.275;
  rack.add(rackBase);
  [0xe8a838, 0x57b854, 0x9b6bd4].forEach((col, i) => {
    const b = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_R * 0.95, 20, 14),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.15, metalness: 0.3 })
    );
    const a = (i / 3) * Math.PI * 2;
    b.position.set(Math.cos(a) * 0.16, 0.63, Math.sin(a) * 0.16);
    rack.add(b);
  });
  rack.position.set(LANE_HALF_W + GUTTER_W + 0.75, 0, 0.9);
  scene.add(rack);

  // --- Fysik ---
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

  world.createCollider(
    RAPIER.ColliderDesc.cuboid(LANE_HALF_W, 0.05, laneLen / 2)
      .setTranslation(0, -0.05, laneCenterZ)
      .setFriction(0.25)
      .setRestitution(0.1)
  );
  // Render som V-kanaler: to skrå flader pr. rende, så kuglen centrerer
  // sig i bunden og ikke kan kravle op på banen igen
  const V_ANGLE = 0.593; // ca. 34°
  for (const side of [-1, 1]) {
    const gx = side * (LANE_HALF_W + GUTTER_W / 2);
    for (const inner of [-1, 1]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, inner * side * V_ANGLE));
      world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.1, 0.015, laneLen / 2)
          .setTranslation(gx + inner * side * 0.083, -0.122, laneCenterZ)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setFriction(0.5)
          .setRestitution(0.05)
      );
    }
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.035, 0.2, laneLen / 2)
        .setTranslation(side * (LANE_HALF_W + GUTTER_W + 0.035), 0.05, laneCenterZ)
        .setRestitution(0.2)
    );
  }
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(3, 1, 0.1)
      .setTranslation(0, 0.5, LANE_END_Z - 0.3)
      .setRestitution(0.1)
  );
  // Kickback-vægge på siderne af pin-decket: kegler kan kun ryge bagud
  // i pitten eller ned i renden — ikke ud over nabobanerne
  const kickbackMat = new THREE.MeshStandardMaterial({ color: 0x141c26, roughness: 0.85 });
  for (const side of [-1, 1]) {
    const kx = side * (LANE_HALF_W + GUTTER_W + 0.045);
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.04, 0.45, 1.5)
        .setTranslation(kx, 0.45, PIN_HEAD_Z - 0.55)
        .setFriction(0.3)
        .setRestitution(0.15)
    );
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.9, 3.0), kickbackMat);
    panel.position.set(kx, 0.45, PIN_HEAD_Z - 0.55);
    scene.add(panel);
  }

  // Kugle
  const ballBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(BALL_START.x, BALL_START.y, BALL_START.z)
      .setLinearDamping(0.12)
      .setAngularDamping(0.2)
      .setCcdEnabled(true)
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_R).setDensity(1700).setFriction(0.3).setRestitution(0.15),
    ballBody
  );

  const ballMat = new THREE.MeshStandardMaterial({ color: 0xe2564e, roughness: 0.12, metalness: 0.35 });
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 32, 24), ballMat);
  ballMesh.castShadow = true;
  scene.add(ballMesh);

  // Mii-figur i tredjeperson (som Wii Sports bowling)
  const mii = makeMii(players[0].color, "bowling");
  mii.group.scale.setScalar(0.85);
  mii.group.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  scene.add(mii.group);

  function positionMii() {
    mii.group.position.set(aimX - 0.42, 0, BALL_START.z + 0.45);
    mii.group.rotation.y = -aimAngle;
  }

  // Kegler (fysik + grafik)
  const pins: Pin[] = PIN_POSITIONS.map(([x, z]) => {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0, z)
        .setLinearDamping(0.3)
        .setAngularDamping(0.4)
        .setCcdEnabled(true)
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(0.19, 0.055)
        .setTranslation(0, 0.19, 0)
        .setDensity(320)
        .setFriction(0.4)
        .setRestitution(0.3),
      body
    );
    const mesh = new THREE.Mesh(pinGeo, pinMat);
    mesh.castShadow = true;
    scene.add(mesh);
    return { body, mesh, home: new THREE.Vector3(x, 0, z), standing: true, parked: false };
  });

  function resetPin(p: Pin) {
    p.body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    p.body.setTranslation({ x: p.home.x, y: 0, z: p.home.z }, true);
    p.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    p.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    p.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.standing = true;
    p.parked = false;
    p.mesh.visible = true;
  }

  function parkPin(p: Pin) {
    p.body.setBodyType(RAPIER.RigidBodyType.Fixed, true);
    p.body.setTranslation({ x: p.home.x, y: -8, z: p.home.z }, true);
    p.standing = false;
    p.parked = true;
    p.mesh.visible = false;
  }

  function isPinFallen(p: Pin): boolean {
    if (!p.standing) return true;
    const rot = p.body.rotation();
    const q = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const t = p.body.translation();
    const moved = Math.hypot(t.x - p.home.x, t.z - p.home.z);
    return up.y < 0.75 || moved > 0.25 || t.y < -0.05;
  }

  // --- Sigte ---
  let aimX = BALL_START.x;
  let aimAngle = 0;

  const aimLineMat = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.25, gapSize: 0.18, transparent: true, opacity: 0.7 });
  const aimLineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const aimLine = new THREE.Line(aimLineGeo, aimLineMat);
  scene.add(aimLine);

  function updateAimLine() {
    const dir = new THREE.Vector3(Math.sin(aimAngle), 0, -Math.cos(aimAngle));
    const from = new THREE.Vector3(aimX, 0.02, BALL_START.z);
    const to = from.clone().addScaledVector(dir, 7);
    aimLineGeo.setFromPoints([from, to]);
    aimLine.computeLineDistances();
    aimLine.visible = true;
    positionMii();
  }

  function resetBall() {
    ballBody.setTranslation({ x: aimX, y: BALL_START.y, z: BALL_START.z }, true);
    ballBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    ballBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    ballBody.resetForces(true);
  }

  // --- Spiltilstand ---
  const scorecards = players.map(() => new BowlingScorecard());
  let currentPlayer = 0;
  let phase: Phase = "transition";
  let rollStartTime = 0;
  let curveForce = 0;
  let destroyed = false;

  // Controller-tilstand: telefoner styrer via værtssessionen
  const host = getActiveHost();
  const remoteMode = !!host && host.currentGame === "bowling";

  function updateHud() {
    const p = players[currentPlayer];
    const sc = scorecards[currentPlayer];
    hudDot.style.background = p.color;
    hudName.textContent = p.name;
    const f = sc.currentFrame;
    const rollNo = f >= 0 ? sc.frames[f].rolls.length + 1 : 0;
    hudFrame.textContent = f >= 0 ? `Frame ${f + 1} · Kast ${rollNo} · ${sc.total()} p` : "";
    ballMat.color.set(p.color);
    mii.setColor(p.color);
  }

  function setHint(text: string, visible: boolean) {
    hudHint.textContent = text;
    hudHint.style.display = visible ? "" : "none";
  }

  // --- Flyt/drej-knapper (hold nede for at gentage) ---
  function holdButton(id: string, onTick: () => void) {
    const btn = hud.querySelector<HTMLButtonElement>(id)!;
    let timer: number | null = null;
    const start = (e: Event) => {
      e.preventDefault();
      if (phase !== "aiming") return;
      onTick();
      timer = window.setInterval(() => {
        if (phase !== "aiming") return;
        onTick();
      }, 30);
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

  function moveAim(dx: number) {
    aimX = THREE.MathUtils.clamp(aimX + dx, -LANE_HALF_W + BALL_R, LANE_HALF_W - BALL_R);
    ballBody.setTranslation({ x: aimX, y: BALL_START.y, z: BALL_START.z }, true);
    updateAimLine();
  }

  function rotateAim(da: number) {
    aimAngle = THREE.MathUtils.clamp(aimAngle + da, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
    updateAimLine();
  }

  holdButton("#mv-left", () => moveAim(-0.012));
  holdButton("#mv-right", () => moveAim(0.012));
  holdButton("#rot-left", () => rotateAim(-0.0035));
  holdButton("#rot-right", () => rotateAim(0.0035));

  // --- Input: træk for at flytte, swipe op for at kaste ---
  interface Sample { x: number; y: number; t: number }
  let samples: Sample[] = [];
  let pointerDown = false;
  let dragStartAimX = 0;

  const canvas = renderer.domElement;

  canvas.addEventListener("pointerdown", (e) => {
    if (phase !== "aiming") return;
    pointerDown = true;
    samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
    dragStartAimX = aimX;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointerDown || phase !== "aiming") return;
    samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
    if (samples.length > 60) samples.shift();
    const dx = e.clientX - samples[0].x;
    aimX = THREE.MathUtils.clamp(dragStartAimX + dx * 0.003, -LANE_HALF_W + BALL_R, LANE_HALF_W - BALL_R);
    ballBody.setTranslation({ x: aimX, y: BALL_START.y, z: BALL_START.z }, true);
    updateAimLine();
  });

  canvas.addEventListener("pointerup", () => {
    if (!pointerDown || phase !== "aiming") return;
    pointerDown = false;
    if (samples.length < 3) return;

    const now = performance.now();
    const recent = samples.filter((s) => now - s.t < 140);
    if (recent.length < 2) return;
    const first = recent[0];
    const last = recent[recent.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return;

    const vyPx = (first.y - last.y) / dt;
    const vxPx = (last.x - first.x) / dt;
    if (vyPx < 500) return;

    const h = container.clientHeight || window.innerHeight;
    const norm = vyPx / h;
    const speed = THREE.MathUtils.clamp(6 + norm * 5.5, 7, 19);
    const lateral = THREE.MathUtils.clamp((vxPx / h) * 2.2, -3, 3);

    const mid = samples[Math.floor(samples.length / 2)];
    const overallAngle = Math.atan2(last.x - samples[0].x, samples[0].y - last.y);
    const endAngle = Math.atan2(last.x - mid.x, mid.y - last.y);
    const curve = THREE.MathUtils.clamp((endAngle - overallAngle) * 18, -9, 9);

    doThrow(speed, lateral, curve);
  });

  function doThrow(speed: number, lateral: number, curve: number) {
    if (phase !== "aiming") return;
    curveForce = curve;
    // Kasteretningen følger sigtevinklen
    const dirX = Math.sin(aimAngle);
    const dirZ = -Math.cos(aimAngle);
    ballBody.setLinvel({ x: dirX * speed + lateral, y: 0, z: dirZ * speed }, true);
    // Rullespin om aksen vinkelret på kasteretningen
    ballBody.setAngvel({ x: (-dirZ * speed) / BALL_R * -1, y: 0, z: (-dirX * speed) / BALL_R }, true);
    ballBody.resetForces(true);
    ballBody.addForce({ x: curveForce, y: 0, z: 0 }, true);

    phase = "rolling";
    mii.swing();
    sfx.whoosh();
    aimLine.visible = false;
    aimControls.style.display = "none";
    rollStartTime = performance.now();
    setHint("", false);
  }

  // Input fra telefon-controllere
  if (remoteMode && host) {
    host.onInput = (idx, msg) => {
      if (destroyed || idx !== currentPlayer || phase !== "aiming") return;
      if (msg.t === "move") moveAim(msg.dir * 0.015);
      else if (msg.t === "rotate") rotateAim(msg.dir * 0.004);
      else if (msg.t === "swipe") {
        const speed = THREE.MathUtils.clamp(7 + msg.power * 12, 7, 19);
        doThrow(speed, msg.lateral * 3, msg.curve * 9);
      }
    };
  }

  // --- Kast færdigt -> scoring ---
  function finishRoll() {
    phase = "transition";
    ballBody.resetForces(true);

    const sc = scorecards[currentPlayer];
    const frameBefore = sc.currentFrame;
    const standingBefore = pins.filter((p) => p.standing).length;

    setTimeout(() => {
      if (destroyed) return;
      let knocked = 0;
      for (const p of pins) {
        if (p.standing && isPinFallen(p)) {
          p.standing = false;
          knocked++;
        }
      }
      sc.addRoll(knocked);

      if (knocked > 0) sfx.crash(knocked);
      const rolls = sc.frames[frameBefore]?.rolls ?? [];
      if (knocked === standingBefore && rolls.length === 1 && knocked === 10) {
        showToast("STRIKE! 🎉");
        sfx.fanfare();
      } else if (knocked === standingBefore && rolls.length >= 2) {
        showToast("SPARE! 👏");
        sfx.fanfare();
      } else if (knocked === 0) {
        showToast("Øv! 😅");
        sfx.sad();
      } else showToast(`${knocked} ${knocked === 1 ? "kegle" : "kegler"}!`);

      setTimeout(() => {
        if (destroyed) return;
        advanceTurn(frameBefore);
      }, 1500);
    }, 900);
  }

  function advanceTurn(frameBefore: number) {
    const sc = scorecards[currentPlayer];

    if (scorecards.every((s) => s.isDone)) {
      showResults();
      return;
    }

    const samePlayer = !sc.isDone && sc.currentFrame === frameBefore;

    if (samePlayer) {
      prepareNextRoll(sc);
      startAiming();
      return;
    }

    // Spillerens frame er færdig: vis scoretavlen (som på Wii)
    let next = currentPlayer;
    do {
      next = (next + 1) % players.length;
    } while (scorecards[next].isDone);

    const isNewPlayer = next !== currentPlayer;

    if (isNewPlayer && players.length > 1) {
      currentPlayer = next;
      prepareNextRoll(scorecards[currentPlayer]);
      showTurnOverlay(players[currentPlayer], () => startAiming());
    } else {
      // Samme spiller (fx alene): vis scoretavle mellem frames
      currentPlayer = next;
      prepareNextRoll(scorecards[currentPlayer]);
      showScoreboardOverlay(() => startAiming());
    }
  }

  function prepareNextRoll(sc: BowlingScorecard) {
    if (sc.pinsStandingForNextRoll() === 10) {
      for (const p of pins) resetPin(p);
    } else {
      for (const p of pins) {
        if (!p.standing && !p.parked) parkPin(p);
      }
    }
    resetBall();
  }

  function startAiming() {
    updateHud();
    phase = "aiming";
    aimControls.style.display = remoteMode ? "none" : "";
    updateAimLine();
    if (remoteMode && host) {
      const sc = scorecards[currentPlayer];
      const f = sc.currentFrame;
      const rollNo = f >= 0 ? sc.frames[f].rolls.length + 1 : 0;
      host.announceTurn(currentPlayer, `Frame ${f + 1} · Kast ${rollNo} · ${sc.total()} point`);
      setHint(`${players[currentPlayer].name} kaster fra telefonen 📱`, true);
    } else {
      setHint("Flyt & drej — swipe op for at kaste! 🎳", true);
    }
  }

  // --- Overlays ---
  function showToast(text: string) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = text;
    app.appendChild(t);
    setTimeout(() => t.remove(), 1600);
  }

  function showTurnOverlay(player: Player, onReady: () => void) {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="big-avatar" style="background:${player.color}">${initialFor(player.name)}</div>
      <h2>${remoteMode ? `${escapeHtml(player.name)} har turen! 📱` : `Giv telefonen til ${escapeHtml(player.name)}!`}</h2>
      ${renderScoreboard()}
      <button class="btn btn-primary">Klar! 🎳</button>
    `;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      ov.remove();
      onReady();
    };
    ov.querySelector("button")!.addEventListener("click", go);
    if (remoteMode) setTimeout(go, 2800);
    app.appendChild(ov);
  }

  function showScoreboardOverlay(onClose?: () => void) {
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <h2>Stillingen</h2>
      ${renderScoreboard()}
      <button class="btn btn-primary">Videre</button>
    `;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      ov.remove();
      onClose?.();
    };
    ov.querySelector("button")!.addEventListener("click", go);
    if (remoteMode && onClose) setTimeout(go, 3200);
    app.appendChild(ov);
  }

  function renderScoreboard(): string {
    let html = `<div class="scoreboard"><table class="score-table"><tr><th></th>`;
    for (let f = 1; f <= 10; f++) html += `<th>${f}</th>`;
    html += `<th>Total</th></tr>`;
    players.forEach((p, pi) => {
      const sc = scorecards[pi];
      const scores = sc.frameScores();
      const cur = sc.currentFrame;
      html += `<tr><td class="pname" style="color:${p.color}">${escapeHtml(p.name)}</td>`;
      for (let f = 0; f < 10; f++) {
        const rolls = sc.rollDisplay(f);
        const slots = f === 9 ? 3 : 2;
        let cells = "";
        for (let s = 0; s < slots; s++) cells += `<span>${rolls[s] ?? "&nbsp;"}</span>`;
        const isCur = pi === currentPlayer && f === cur ? " current-frame" : "";
        html += `<td class="frame-cell${isCur}"><div class="frame-rolls">${cells}</div><div class="frame-total">${scores[f] ?? "&nbsp;"}</div></td>`;
      }
      html += `<td class="frame-total" style="font-size:15px;padding:0 8px">${sc.total()}</td></tr>`;
    });
    html += `</table></div>`;
    return html;
  }

  function showResults() {
    const ranked = players
      .map((p, i) => ({ p, score: scorecards[i].total() }))
      .sort((a, b) => b.score - a.score);

    for (const r of ranked) {
      addHighscore("bowling", { name: r.p.name, score: r.score, date: new Date().toISOString() });
    }

    sfx.fanfare();
    const ov = document.createElement("div");
    ov.className = "overlay";
    ov.innerHTML = `
      <div class="big-avatar" style="background:${ranked[0].p.color}">👑</div>
      <h2>${escapeHtml(ranked[0].p.name)} vinder!</h2>
      <p>${ranked.map((r, i) => `${i + 1}. ${escapeHtml(r.p.name)} — <b>${r.score}</b>`).join("<br>")}</p>
      ${renderScoreboard()}
      <div class="btn-row">
        <button class="btn btn-secondary" id="res-menu">Hovedmenu</button>
        <button class="btn btn-primary" id="res-again">Spil igen 🎳</button>
      </div>
    `;
    ov.querySelector("#res-menu")!.addEventListener("click", () => {
      destroy();
      onExit();
    });
    ov.querySelector("#res-again")!.addEventListener("click", () => {
      destroy();
      startBowling(app, players, onExit);
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
  world.timestep = FIXED_DT;

  const camTarget = new THREE.Vector3();

  function loop() {
    if (destroyed) return;
    raf = requestAnimationFrame(loop);

    const now = performance.now();
    let dt = (now - lastT) / 1000;
    lastT = now;
    dt = Math.min(dt, 0.1);
    advance(dt, now);
  }

  function advance(dt: number, now: number) {
    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      world.step();
      accumulator -= FIXED_DT;
    }

    const bt = ballBody.translation();
    ballMesh.position.set(bt.x, bt.y, bt.z);
    const br = ballBody.rotation();
    ballMesh.quaternion.set(br.x, br.y, br.z, br.w);
    mii.update(now);

    for (const p of pins) {
      if (!p.mesh.visible) continue;
      const t = p.body.translation();
      p.mesh.position.set(t.x, t.y, t.z);
      const r = p.body.rotation();
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      // Kegler der hopper fremad ud af pin-området bremses hurtigt,
      // så de aldrig triller op ad banen
      if (p.standing === false || p.parked) continue;
      if (t.z > PIN_HEAD_Z + 0.6 && phase === "rolling") {
        const v = p.body.linvel();
        p.body.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z * 0.7 }, true);
      }
    }

    if (phase === "rolling") {
      // I renden: dæmp sideværts fart og fjern skru, så kuglen bliver dernede
      if (Math.abs(bt.x) > LANE_HALF_W + 0.02 && bt.y < 0.03) {
        const v = ballBody.linvel();
        ballBody.setLinvel({ x: v.x * 0.8, y: v.y, z: v.z }, true);
        ballBody.resetForces(true);
      }
      // I pitten bag keglerne: brems kraftigt som en rigtig kuglefanger
      if (bt.z < LANE_END_Z + 0.9) {
        const v = ballBody.linvel();
        ballBody.setLinvel({ x: v.x * 0.75, y: v.y * 0.75, z: v.z * 0.75 }, true);
        const av = ballBody.angvel();
        ballBody.setAngvel({ x: av.x * 0.75, y: av.y * 0.75, z: av.z * 0.75 }, true);
        ballBody.resetForces(true);
      }
      const targetZ = Math.max(bt.z + 3.2, PIN_HEAD_Z + 2.5);
      camera.position.z += (targetZ - camera.position.z) * 0.08;
      camera.position.y += (1.3 - camera.position.y) * 0.05;
      camTarget.set(bt.x * 0.5, 0.25, Math.min(bt.z - 3, PIN_HEAD_Z));
      camera.lookAt(camTarget);

      const v = ballBody.linvel();
      const speed = Math.hypot(v.x, v.y, v.z);
      const elapsed = (now - rollStartTime) / 1000;
      if (bt.z < LANE_END_Z + 0.8 || elapsed > 7 || (elapsed > 2.5 && speed < 0.2)) {
        finishRoll();
      }
    } else if (phase === "aiming") {
      camera.position.z += (3.1 - camera.position.z) * 0.06;
      camera.position.y += (1.9 - camera.position.y) * 0.06;
      camera.position.x += (bt.x * 0.6 - camera.position.x) * 0.1;
      camTarget.set(bt.x * 0.3, 0.25, PIN_HEAD_Z);
      camera.lookAt(camTarget);
    }

    renderer.render(scene, camera);
  }

  // Debug-hooks til automatiseret test
  let simOffset = 0;
  (window as any).__wiiStep = (seconds: number) => {
    for (let s = 0; s < seconds; s += FIXED_DT) {
      simOffset += FIXED_DT * 1000;
      advance(FIXED_DT, performance.now() + simOffset);
    }
  };
  (window as any).__wiiThrow = (speed: number, lateral = 0, curve = 0) => {
    if (phase !== "aiming") return false;
    doThrow(speed, lateral, curve);
    return true;
  };
  (window as any).__wiiBowlState = () => ({
    phase,
    standing: pins.filter((p) => p.standing && !isPinFallen(p)).length,
    totals: scorecards.map((s) => s.total()),
    aimX,
    aimAngle,
  });

  function destroy() {
    destroyed = true;
    if (remoteMode && host) host.onInput = null;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    renderer.dispose();
    world.free();
    hud.remove();
    container.remove();
    app.innerHTML = "";
  }

  // Start
  updateHud();
  if (players.length > 1) {
    showTurnOverlay(players[0], () => startAiming());
  } else {
    startAiming();
  }
  loop();
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
