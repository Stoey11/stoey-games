import Peer, { DataConnection } from "peerjs";
import { PLAYER_COLORS, initialFor, loadPlayers } from "../players";
import { ControllerMsg, GameId, HostMsg, peerIdFor } from "./protocol";

/**
 * Controller-tilstand: telefonen forbinder til værten (TV'et) og viser
 * et gamepad i stedet for selve spillet.
 */
export function showControllerJoin(app: HTMLElement, onBack: () => void) {
  app.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";
  const suggested = loadPlayers()[0];
  screen.innerHTML = `
    <div class="wii-title" style="font-size:clamp(22px,6vw,34px)">📱 Deltag i spillet</div>
    <div class="wii-subtitle">Indtast koden fra TV-skærmen</div>
    <div class="player-list" style="max-width:340px">
      <div class="player-row">
        <input id="room-code" type="text" maxlength="4" placeholder="KODE" autocapitalize="characters"
          style="text-transform:uppercase;text-align:center;font-size:26px;letter-spacing:8px;font-weight:800">
      </div>
      <div class="player-row">
        <div class="avatar" id="join-avatar" style="background:${suggested.color}">${initialFor(suggested.name)}</div>
        <input id="join-name" type="text" maxlength="12" placeholder="Dit navn" value="${escapeAttr(suggested.name)}">
      </div>
    </div>
    <div id="join-status" style="color:#6b93ab;font-weight:600;min-height:24px;margin-bottom:8px"></div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="back">‹ Tilbage</button>
      <button class="btn btn-primary" id="join">Deltag!</button>
    </div>
  `;
  app.appendChild(screen);

  let color = suggested.color;
  const avatar = screen.querySelector<HTMLElement>("#join-avatar")!;
  const nameInput = screen.querySelector<HTMLInputElement>("#join-name")!;
  avatar.addEventListener("click", () => {
    color = PLAYER_COLORS[(PLAYER_COLORS.indexOf(color) + 1) % PLAYER_COLORS.length];
    avatar.style.background = color;
  });
  nameInput.addEventListener("input", () => {
    avatar.textContent = initialFor(nameInput.value || "?");
  });

  screen.querySelector("#back")!.addEventListener("click", onBack);

  screen.querySelector("#join")!.addEventListener("click", () => {
    const code = screen.querySelector<HTMLInputElement>("#room-code")!.value.trim().toUpperCase();
    const name = nameInput.value.trim() || "Spiller";
    const status = screen.querySelector<HTMLElement>("#join-status")!;
    if (code.length !== 4) {
      status.textContent = "Koden er 4 tegn";
      return;
    }
    status.textContent = "Forbinder…";
    connect(code, name, color, app, onBack, (err) => {
      status.textContent = err;
    });
  });
}

function connect(
  code: string,
  name: string,
  color: string,
  app: HTMLElement,
  onBack: () => void,
  onError: (msg: string) => void
) {
  const peer = new Peer();
  let conn: DataConnection | null = null;
  let failed = false;
  const fail = (msg: string) => {
    if (failed) return;
    failed = true;
    peer.destroy();
    onError(msg);
  };
  const timeout = setTimeout(() => fail("Kunne ikke finde rummet — tjek koden"), 12000);

  peer.on("open", () => {
    conn = peer.connect(peerIdFor(code), { reliable: true });
    conn.on("open", () => {
      clearTimeout(timeout);
      conn!.send({ t: "join", name, color } satisfies ControllerMsg);
      showPad(app, peer, conn!, name, color, onBack);
    });
    conn.on("error", () => fail("Forbindelsen fejlede"));
  });
  peer.on("error", (e) => {
    if ((e as any).type === "peer-unavailable") fail("Rummet findes ikke — tjek koden");
    else fail("Netværksfejl: " + (e as any).type);
  });
}

/**
 * Styreudslag fra telefonens hældning, mappet efter skærmens orientering:
 * portræt = vip til siderne, landskab = drej telefonen som et rat.
 */
export function steerFromOrientation(e: DeviceOrientationEvent): number {
  const angle = (screen.orientation?.angle ?? (window as any).orientation ?? 0) as number;
  const beta = e.beta ?? 0;
  const gamma = e.gamma ?? 0;
  let raw: number;
  if (angle === 90) raw = beta;
  else if (angle === 270 || angle === -90) raw = -beta;
  else if (angle === 180) raw = -gamma;
  else raw = gamma;
  return Math.min(1, Math.max(-1, raw / 22));
}

/** Bed om lov til bevægelsessensorer (kræves på iPhone). */
async function requestMotionPermission(): Promise<boolean> {
  const DME = DeviceMotionEvent as any;
  const DOE = DeviceOrientationEvent as any;
  try {
    if (typeof DME?.requestPermission === "function" && (await DME.requestPermission()) !== "granted") return false;
    if (typeof DOE?.requestPermission === "function" && (await DOE.requestPermission()) !== "granted") return false;
  } catch {
    return false;
  }
  return true;
}

function showPad(
  app: HTMLElement,
  peer: Peer,
  conn: DataConnection,
  name: string,
  color: string,
  onBack: () => void
) {
  let myIndex = -1;
  let game: GameId | null = null;
  let myTurn = false;
  let motionMode = false; // sving med telefonen (Wiimote-stil)
  const cleanupFns: (() => void)[] = [];

  app.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";
  screen.style.justifyContent = "flex-start";
  app.appendChild(screen);

  const send = (msg: ControllerMsg) => {
    try {
      conn.send(msg);
    } catch {}
  };

  function render(statusText: string, infoText = "") {
    cleanupFns.forEach((f) => f());
    cleanupFns.length = 0;
    screen.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin:6px 0 2px">
        <div class="avatar" style="background:${color}">${initialFor(name)}</div>
        <div style="font-weight:800;color:#33505f;font-size:18px">${escapeHtml(name)}</div>
      </div>
      <div style="color:#6b93ab;font-weight:600;margin-bottom:10px;text-align:center">${statusText}</div>
      <div style="color:#33505f;font-weight:700;min-height:22px;margin-bottom:6px;text-align:center" id="pad-info">${infoText}</div>
      <div id="pad-area" style="width:100%;max-width:420px;flex:1;display:flex;flex-direction:column;gap:12px"></div>
      <button class="btn btn-ghost" id="pad-exit" style="margin-top:8px">Forlad spillet</button>
    `;
    screen.querySelector("#pad-exit")!.addEventListener("click", () => {
      peer.destroy();
      onBack();
    });
    return screen.querySelector<HTMLElement>("#pad-area")!;
  }

  function holdBtn(btn: HTMLElement, onTick: () => void) {
    let timer: number | null = null;
    const start = (e: Event) => {
      e.preventDefault();
      onTick();
      timer = window.setInterval(onTick, 40);
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

  /** Wiimote-stil: HOLD på skærmen, sving telefonen, SLIP — kraft fra
   *  accelerometeret, skævhed fra sidelæns bevægelse, skru fra vrid. */
  function buildMotionPad(area: HTMLElement, kind: "bowling" | "golf") {
    const pad = document.createElement("div");
    pad.style.cssText = `flex:1;min-height:220px;border-radius:22px;border:3px solid rgba(87,184,84,0.55);
      display:flex;align-items:center;justify-content:center;color:#33505f;font-weight:700;font-size:16px;
      text-align:center;padding:14px 14px 14px 44px;background:rgba(255,255,255,0.5);touch-action:none;position:relative`;
    const txt = document.createElement("div");
    txt.style.pointerEvents = "none";
    txt.textContent =
      kind === "bowling"
        ? "HOLD her og sving telefonen frem som en bowlingkugle — SLIP når du slipper kuglen! 🎳"
        : "HOLD her, tag et golfsving med telefonen — SLIP efter du rammer! 🏌️";
    pad.appendChild(txt);
    const bar = document.createElement("div");
    bar.style.cssText = `position:absolute;left:12px;top:10%;bottom:10%;width:16px;border-radius:10px;background:rgba(43,127,191,0.2)`;
    const fill = document.createElement("div");
    fill.style.cssText = `position:absolute;bottom:0;left:0;right:0;height:0%;border-radius:10px;background:#57b854`;
    bar.appendChild(fill);
    pad.appendChild(bar);
    area.appendChild(pad);

    let armed = false;
    let peak = 0;
    let sumX = 0;
    let nSamples = 0;
    let peakRot = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      if (!armed) return;
      const acc = e.acceleration ?? e.accelerationIncludingGravity;
      if (acc) {
        let mag = Math.hypot(acc.x ?? 0, acc.y ?? 0, acc.z ?? 0);
        if (!e.acceleration) mag = Math.max(0, mag - 9.81);
        peak = Math.max(peak, mag);
        sumX += acc.x ?? 0;
        nSamples++;
      }
      const r = e.rotationRate?.alpha ?? 0;
      if (Math.abs(r) > Math.abs(peakRot)) peakRot = r;
      const p = Math.min(1.15, peak / 26);
      fill.style.height = `${Math.min(100, (p / 1.15) * 100)}%`;
      fill.style.background = p > 1 ? "#d8433b" : p > 0.85 ? "#e8a838" : "#57b854";
    };
    window.addEventListener("devicemotion", onMotion);
    cleanupFns.push(() => window.removeEventListener("devicemotion", onMotion));

    pad.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      armed = true;
      peak = 0;
      sumX = 0;
      nSamples = 0;
      peakRot = 0;
      pad.style.background = "rgba(168,230,160,0.55)";
    });
    const release = () => {
      if (!armed) return;
      armed = false;
      pad.style.background = "rgba(255,255,255,0.5)";
      fill.style.height = "0%";
      if (peak < 5) return; // intet rigtigt sving registreret
      const power = Math.min(kind === "golf" ? 1.15 : 1, Math.max(0.15, peak / 26));
      const lateral = Math.min(1, Math.max(-1, sumX / Math.max(1, nSamples) / 5));
      const curve = Math.min(1, Math.max(-1, peakRot / 350));
      send({ t: "swipe", power, lateral, curve });
      if (navigator.vibrate) navigator.vibrate(60);
    };
    pad.addEventListener("pointerup", release);
    pad.addEventListener("pointercancel", release);
  }

  function addMotionToggle(area: HTMLElement, label: string) {
    const b = document.createElement("button");
    b.className = "btn btn-secondary";
    b.textContent = motionMode ? "👆 Tilbage til touch-styring" : label;
    b.addEventListener("click", async () => {
      if (!motionMode && !(await requestMotionPermission())) {
        b.textContent = "❌ Ingen adgang til bevægelsessensor";
        return;
      }
      motionMode = !motionMode;
      renderState(lastInfo);
    });
    area.appendChild(b);
  }

  /** Wii-sving til golf: træk ned = baksving (kraftbar), swipe op = slag. */
  function buildSwingArea(area: HTMLElement, label: string) {
    const pad = document.createElement("div");
    pad.style.cssText = `flex:1;min-height:220px;border-radius:22px;border:3px dashed rgba(43,127,191,0.4);
      display:flex;align-items:center;justify-content:center;color:#6b93ab;font-weight:700;font-size:16px;
      text-align:center;padding:14px 14px 14px 44px;background:rgba(255,255,255,0.5);touch-action:none;position:relative`;
    pad.textContent = label;
    const bar = document.createElement("div");
    bar.style.cssText = `position:absolute;left:12px;top:10%;bottom:10%;width:16px;border-radius:10px;
      background:rgba(43,127,191,0.2)`;
    const fill = document.createElement("div");
    fill.style.cssText = `position:absolute;bottom:0;left:0;right:0;height:0%;border-radius:10px;background:#57b854`;
    bar.appendChild(fill);
    const mark = document.createElement("div");
    mark.style.cssText = `position:absolute;left:-3px;right:-3px;bottom:87%;height:2px;background:rgba(51,80,95,0.7)`;
    bar.appendChild(mark);
    pad.appendChild(bar);
    area.appendChild(pad);

    interface Sample { x: number; y: number; t: number }
    let samples: Sample[] = [];
    let down = false;
    let peak = 0;
    let power = 0;
    pad.addEventListener("pointerdown", (e) => {
      down = true;
      peak = 0;
      power = 0;
      fill.style.height = "0%";
      samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {}
    });
    pad.addEventListener("pointermove", (e) => {
      if (!down) return;
      samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (samples.length > 90) samples.shift();
      peak = Math.max(peak, e.clientY - samples[0].y);
      power = Math.min(1.15, Math.max(0, peak / (window.innerHeight * 0.4)));
      fill.style.height = `${Math.min(100, (power / 1.15) * 100)}%`;
      fill.style.background = power > 1 ? "#d8433b" : power > 0.85 ? "#e8a838" : "#57b854";
    });
    pad.addEventListener("pointerup", () => {
      if (!down) return;
      down = false;
      fill.style.height = "0%";
      if (samples.length < 3 || power < 0.04) return;
      const now = performance.now();
      const recent = samples.filter((s) => now - s.t < 150);
      if (recent.length < 2) return;
      const first = recent[0];
      const last = recent[recent.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt <= 0) return;
      if ((first.y - last.y) / dt < 250) return; // intet opsving
      const upLen = Math.max(30, first.y - last.y);
      const dxUp = last.x - first.x;
      let crook = Math.min(1, Math.max(-1, (dxUp / upLen) * 2.8));
      let spin = Math.min(1, Math.max(-1, (dxUp / upLen) * 3.3));
      if (power > 1) {
        const over = power - 1;
        crook = Math.min(1, Math.max(-1, crook + (Math.random() - 0.5) * over * 11));
        spin = Math.min(1, Math.max(-1, spin + (Math.random() - 0.5) * over * 12));
      }
      send({ t: "swipe", power, lateral: crook, curve: spin });
      pad.animate([{ background: "rgba(87,184,84,0.5)" }, { background: "rgba(255,255,255,0.5)" }], { duration: 500 });
      if (navigator.vibrate) navigator.vibrate(40);
    });
  }

  function buildSwipeArea(area: HTMLElement, label: string) {
    const pad = document.createElement("div");
    pad.style.cssText = `flex:1;min-height:220px;border-radius:22px;border:3px dashed rgba(43,127,191,0.4);
      display:flex;align-items:center;justify-content:center;color:#6b93ab;font-weight:700;font-size:17px;
      text-align:center;padding:14px;background:rgba(255,255,255,0.5);touch-action:none`;
    pad.textContent = label;
    area.appendChild(pad);

    interface Sample { x: number; y: number; t: number }
    let samples: Sample[] = [];
    let down = false;
    pad.addEventListener("pointerdown", (e) => {
      down = true;
      samples = [{ x: e.clientX, y: e.clientY, t: performance.now() }];
      try {
        pad.setPointerCapture(e.pointerId);
      } catch {}
    });
    pad.addEventListener("pointermove", (e) => {
      if (!down) return;
      samples.push({ x: e.clientX, y: e.clientY, t: performance.now() });
      if (samples.length > 60) samples.shift();
    });
    pad.addEventListener("pointerup", () => {
      if (!down) return;
      down = false;
      if (samples.length < 3) return;
      const now = performance.now();
      const recent = samples.filter((s) => now - s.t < 160);
      if (recent.length < 2) return;
      const first = recent[0];
      const last = recent[recent.length - 1];
      const dt = (last.t - first.t) / 1000;
      if (dt <= 0) return;
      const vyPx = (first.y - last.y) / dt;
      const vxPx = (last.x - first.x) / dt;
      if (vyPx < 350) return;
      const h = window.innerHeight;
      const power = Math.min(1, Math.max(0.1, vyPx / h / 3.2));
      const lateral = Math.min(1, Math.max(-1, (vxPx / h) * 0.8));
      const mid = samples[Math.floor(samples.length / 2)];
      const overallAngle = Math.atan2(last.x - samples[0].x, samples[0].y - last.y);
      const endAngle = Math.atan2(last.x - mid.x, mid.y - last.y);
      const curve = Math.min(1, Math.max(-1, (endAngle - overallAngle) * 2));
      send({ t: "swipe", power, lateral, curve });
      pad.animate([{ background: "rgba(87,184,84,0.5)" }, { background: "rgba(255,255,255,0.5)" }], { duration: 500 });
      if (navigator.vibrate) navigator.vibrate(40);
    });
  }

  function ctlRow(area: HTMLElement, defs: { label: string; btns: [string, () => void][] }[]) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:space-around;gap:10px";
    for (const d of defs) {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:6px";
      const lbl = document.createElement("div");
      lbl.style.cssText = "font-size:13px;font-weight:700;color:#6b93ab";
      lbl.textContent = d.label;
      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:10px";
      for (const [txt, fn] of d.btns) {
        const b = document.createElement("button");
        b.className = "ctl-btn";
        b.textContent = txt;
        b.style.background = "#fff";
        holdBtn(b, fn);
        btnRow.appendChild(b);
      }
      wrap.appendChild(lbl);
      wrap.appendChild(btnRow);
      row.appendChild(wrap);
    }
    area.appendChild(row);
  }

  let lastInfo = "";

  function renderState(info = "") {
    lastInfo = info;
    if (!game) {
      render("✅ Du er med! Venter på at værten starter et spil…");
      return;
    }
    if (game === "kart") {
      // Realtid: alle kører samtidig
      const area = render("🏎️ Kart Racing", info || "Styr dit kart!");
      let steer = 0;
      const sendSteer = (v: number) => {
        if (v !== steer) {
          steer = v;
          send({ t: "steer", v });
        }
      };
      const row = document.createElement("div");
      row.style.cssText = "flex:1;display:flex;gap:14px;min-height:260px";
      const mkBtn = (label: string, v: number) => {
        const b = document.createElement("div");
        b.style.cssText = `flex:1;border-radius:22px;background:rgba(255,255,255,0.75);display:flex;
          align-items:center;justify-content:center;font-size:64px;font-weight:900;color:#33505f;
          box-shadow:0 4px 14px rgba(0,0,0,0.15);touch-action:none;user-select:none`;
        b.textContent = label;
        const down = (e: Event) => {
          e.preventDefault();
          b.style.background = "rgba(168,230,160,0.9)";
          sendSteer(v);
        };
        const up = () => {
          b.style.background = "rgba(255,255,255,0.75)";
          sendSteer(0);
        };
        b.addEventListener("pointerdown", down);
        b.addEventListener("pointerup", up);
        b.addEventListener("pointercancel", up);
        b.addEventListener("pointerleave", up);
        return b;
      };
      row.appendChild(mkBtn("◀", -1));
      row.appendChild(mkBtn("▶", 1));
      area.appendChild(row);

      // Rat-styring: hold telefonen på tværs og drej den som et rat
      // (virker også som vip i portræt — mappes efter skærmens orientering)
      const tiltBtn = document.createElement("button");
      tiltBtn.className = "btn btn-secondary";
      tiltBtn.textContent = "🏎️ Brug telefonen som RAT";
      let tiltOn = false;
      let lastSent = 0;
      const onOri = (e: DeviceOrientationEvent) => {
        if (!tiltOn) return;
        const now = performance.now();
        if (now - lastSent < 70) return;
        lastSent = now;
        send({ t: "steer", v: steerFromOrientation(e) });
      };
      window.addEventListener("deviceorientation", onOri);
      cleanupFns.push(() => window.removeEventListener("deviceorientation", onOri));
      tiltBtn.addEventListener("click", async () => {
        if (!tiltOn && !(await requestMotionPermission())) {
          tiltBtn.textContent = "❌ Ingen adgang til bevægelsessensor";
          return;
        }
        tiltOn = !tiltOn;
        tiltBtn.textContent = tiltOn ? "🏎️ RAT TIL — drej telefonen!" : "🏎️ Brug telefonen som RAT";
        if (!tiltOn) send({ t: "steer", v: 0 });
      });
      area.appendChild(tiltBtn);
      return;
    }
    if (!myTurn) {
      render(game === "bowling" ? "🎳 Bowling" : "⛳ Golf", info || "Vent på din tur…");
      return;
    }
    if (game === "bowling") {
      const area = render("🎳 DIN TUR!", info);
      ctlRow(area, [
        { label: "Flyt", btns: [["◀", () => send({ t: "move", dir: -1 })], ["▶", () => send({ t: "move", dir: 1 })]] },
        { label: "Drej", btns: [["↺", () => send({ t: "rotate", dir: -1 })], ["↻", () => send({ t: "rotate", dir: 1 })]] },
      ]);
      if (motionMode) buildMotionPad(area, "bowling");
      else buildSwipeArea(area, "SWIPE OP her for at kaste! 🎳\n(hurtigt = hårdt, buet = skru)");
      addMotionToggle(area, "🎳 Sving med telefonen (Wii-stil)");
    } else {
      const area = render("⛳ DIN TUR!", info);
      ctlRow(area, [
        { label: "Kølle", btns: [["‹", () => send({ t: "club", dir: -1 })], ["›", () => send({ t: "club", dir: 1 })]] },
        { label: "Sigt", btns: [["↺", () => send({ t: "rotate", dir: -1 })], ["↻", () => send({ t: "rotate", dir: 1 })]] },
      ]);
      if (motionMode) buildMotionPad(area, "golf");
      else buildSwingArea(area, "Træk NED for baksving,\nswipe OP for at slå! 🏌️\n(skævt eller >100 % = skævt slag)");
      addMotionToggle(area, "🏌️ Sving med telefonen (Wii-stil)");
    }
  }

  renderState();

  conn.on("data", (raw) => {
    const msg = raw as HostMsg;
    if (msg.t === "joined") {
      myIndex = msg.index;
      renderState();
    } else if (msg.t === "lobby") {
      if (!game) renderState();
    } else if (msg.t === "game") {
      game = msg.game;
      myTurn = false;
      renderState();
    } else if (msg.t === "turn") {
      const wasMyTurn = myTurn;
      myTurn = msg.index === myIndex;
      if (myTurn && !wasMyTurn && navigator.vibrate) navigator.vibrate([80, 60, 80]);
      renderState(msg.info);
    } else if (msg.t === "info") {
      if (msg.index === myIndex || msg.index === -1) {
        const el = screen.querySelector("#pad-info");
        if (el) el.textContent = msg.info;
      }
    } else if (msg.t === "gameover") {
      game = null;
      myTurn = false;
      renderState();
    }
  });

  conn.on("close", () => {
    peer.destroy();
    app.innerHTML = "";
    const s = document.createElement("div");
    s.className = "screen";
    s.innerHTML = `
      <div class="wii-title" style="font-size:26px">Forbindelsen blev lukket</div>
      <button class="btn btn-primary" id="back">Tilbage</button>
    `;
    s.querySelector("#back")!.addEventListener("click", onBack);
    app.appendChild(s);
  });
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
