import * as THREE from "three";

/**
 * Spillerfigur i Wii-stil, men mere realistisk: rigtige proportioner,
 * todelte arme og ben, skjorte i spillerens farve, mørke bukser, sko,
 * hals og ansigt. Armene sidder i en pivot ved skuldrene, så spillene
 * kan animere sving (golfkølle eller bowlingkast).
 *
 * Figuren kigger mod lokal -z (spillenes "fremad"). Højde ca. 1,7 m.
 */
export interface Mii {
  group: THREE.Group;
  armPivot: THREE.Group;
  setColor(color: string): void;
  swing(): void;
  update(nowMs: number): boolean;
}

const SKIN_TONES = [0xf2c99b, 0xe8b98a, 0xd9a06b, 0xc98f5f];
const HAIR_COLORS = [0x4a2f18, 0x2b2b2b, 0x8a5a20, 0x6b4a2b, 0xb08d57];
const PANTS_COLORS = [0x2f3b48, 0x3a3f45, 0x41505e];
let miiCounter = 0;

export function makeMii(color: string, tool: "golf" | "bowling"): Mii {
  const variant = miiCounter++;
  const group = new THREE.Group();

  const shirtMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.7 });
  const skinMat = new THREE.MeshStandardMaterial({ color: SKIN_TONES[variant % SKIN_TONES.length], roughness: 0.55 });
  const hairMat = new THREE.MeshStandardMaterial({ color: HAIR_COLORS[variant % HAIR_COLORS.length], roughness: 0.75 });
  const pantsMat = new THREE.MeshStandardMaterial({ color: PANTS_COLORS[variant % PANTS_COLORS.length], roughness: 0.8 });
  const shoeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.7 });
  const greyMat = new THREE.MeshStandardMaterial({ color: 0xb9c2c9, roughness: 0.3, metalness: 0.55 });

  // --- Ben: lår + underben + sko ---
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.055, 0.4, 10), pantsMat);
    thigh.position.set(side * 0.1, 0.72, 0);
    group.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.042, 0.42, 10), pantsMat);
    shin.position.set(side * 0.1, 0.32, 0.01);
    group.add(shin);
    const shoe = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), shoeMat);
    shoe.scale.set(1.05, 0.6, 1.7);
    shoe.position.set(side * 0.1, 0.05, -0.05);
    group.add(shoe);
  }

  // Hofter
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), pantsMat);
  hips.scale.set(1.1, 0.6, 0.8);
  hips.position.y = 0.92;
  group.add(hips);

  // --- Overkrop: skjorte i spillerfarve ---
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.17, 0.42, 12), shirtMat);
  torso.position.y = 1.16;
  group.add(torso);
  // Skuldre
  for (const side of [-1, 1]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), shirtMat);
    sh.position.set(side * 0.16, 1.36, 0);
    group.add(sh);
  }

  // Hals + hoved
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.09, 8), skinMat);
  neck.position.y = 1.42;
  group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 14), skinMat);
  head.scale.set(0.95, 1.08, 0.95);
  head.position.y = 1.58;
  group.add(head);

  // Hår: kalot + baghoved og lidt pandehår
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.142, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat);
  hair.scale.set(0.98, 1.05, 0.98);
  hair.position.y = 1.6;
  group.add(hair);
  const hairBack = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8), hairMat);
  hairBack.scale.set(0.95, 0.75, 0.6);
  hairBack.position.set(0, 1.56, 0.07);
  group.add(hairBack);

  // Ansigt (mod -z): øjne, øjenbryn, næse, mund
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.016, 8, 6), darkMat);
    eye.position.set(side * 0.05, 1.6, -0.125);
    group.add(eye);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.01, 0.012), hairMat);
    brow.position.set(side * 0.05, 1.645, -0.128);
    group.add(brow);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), skinMat);
  nose.position.set(0, 1.57, -0.135);
  group.add(nose);
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.01), new THREE.MeshStandardMaterial({ color: 0xa3564a }));
  mouth.position.set(0, 1.52, -0.128);
  group.add(mouth);

  // --- Arme i pivot ved skuldrene: overarm (skjorte) + underarm (hud) + hånd ---
  const armPivot = new THREE.Group();
  armPivot.position.y = 1.36;
  group.add(armPivot);

  for (const side of [-1, 1]) {
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.043, 0.3, 8), shirtMat);
    upper.position.set(side * 0.21, -0.13, -0.03);
    upper.rotation.z = side * 0.28;
    upper.rotation.x = -0.15;
    armPivot.add(upper);
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.28, 8), skinMat);
    fore.position.set(side * 0.25, -0.38, -0.1);
    fore.rotation.z = side * 0.12;
    fore.rotation.x = -0.35;
    armPivot.add(fore);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.048, 8, 6), skinMat);
    hand.position.set(side * 0.26, -0.52, -0.17);
    armPivot.add(hand);
  }

  if (tool === "golf") {
    // Golfkølle holdt med begge hænder, skrå ned foran figuren
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.0, 6), greyMat);
    shaft.position.set(0.02, -0.85, -0.42);
    shaft.rotation.x = 0.55;
    armPivot.add(shaft);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6), darkMat);
    grip.position.set(0.02, -0.48, -0.19);
    grip.rotation.x = 0.55;
    armPivot.add(grip);
    const clubHead = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.055, 0.15), greyMat);
    clubHead.position.set(0.05, -1.26, -0.68);
    armPivot.add(clubHead);
  }

  // --- Svinganimation ---
  let swingStart = -1;
  const IDLE = tool === "golf" ? 0.15 : 0.08;
  armPivot.rotation.x = IDLE;

  function swing() {
    swingStart = performance.now();
  }

  function update(nowMs: number): boolean {
    if (swingStart < 0) {
      armPivot.rotation.x += (IDLE - armPivot.rotation.x) * 0.15;
      return false;
    }
    const p = (nowMs - swingStart) / 600;
    if (p >= 1) {
      swingStart = -1;
      return false;
    }
    if (tool === "golf") {
      if (p < 0.35) {
        const q = p / 0.35;
        armPivot.rotation.x = IDLE + q * q * 2.0;
      } else {
        const q = (p - 0.35) / 0.65;
        armPivot.rotation.x = IDLE + 2.0 - q * 4.2;
      }
    } else {
      if (p < 0.4) {
        const q = p / 0.4;
        armPivot.rotation.x = IDLE + q * q * 1.6;
      } else {
        const q = (p - 0.4) / 0.6;
        armPivot.rotation.x = IDLE + 1.6 - q * 3.0;
      }
    }
    return true;
  }

  function setColor(c: string) {
    shirtMat.color.set(c);
  }

  return { group, armPivot, setColor, swing, update };
}
