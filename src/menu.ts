import {
  Player,
  PLAYER_COLORS,
  loadPlayers,
  savePlayers,
  loadHighscores,
  initialFor,
} from "./players";
import { startBowling } from "./bowling/bowling";
import { startGolf } from "./golf/golf";
import { startKart } from "./kart/kart";
import { createHost, HostSession } from "./net/host";
import { showControllerJoin } from "./net/controller";
import { GameId } from "./net/protocol";
import * as sfx from "./sound";

export function showMainMenu(app: HTMLElement) {
  app.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";
  screen.innerHTML = `
    <div class="wii-title">Stoey Games</div>
    <div class="wii-subtitle">Vælg et spil</div>
    <div class="game-grid">
      <button class="game-card" data-game="bowling">
        <span class="icon">🎳</span>
        <span class="label">Bowling<small>1–4 spillere · swipe for at kaste</small></span>
      </button>
      <button class="game-card" data-game="golf">
        <span class="icon">⛳</span>
        <span class="label">Golf<small>18 huller · vælg kølle, pas på vinden</small></span>
      </button>
      <button class="game-card" data-game="kart">
        <span class="icon">🏎️</span>
        <span class="label">Kart Racing<small>2 baner · mod AI · flere kørere via TV</small></span>
      </button>
      <button class="game-card" data-game="host" style="background:linear-gradient(180deg,#fff 0%,#eaf6ff 100%)">
        <span class="icon">📺</span>
        <span class="label">Spil på TV<small>Åbn på PC'en — telefonerne er controllere</small></span>
      </button>
      <button class="game-card" data-game="controller" style="background:linear-gradient(180deg,#fff 0%,#eaf6ff 100%)">
        <span class="icon">📱</span>
        <span class="label">Deltag med telefon<small>Forbind til et spil på TV'et</small></span>
      </button>
    </div>
    <div style="margin-top:26px" id="hs-box"></div>
    <button class="btn btn-ghost" id="mute-btn" style="margin-top:14px">${sfx.isMuted() ? "🔇 Lyd fra" : "🔊 Lyd til"}</button>
  `;
  app.appendChild(screen);

  const muteBtn = screen.querySelector<HTMLButtonElement>("#mute-btn")!;
  muteBtn.addEventListener("click", () => {
    sfx.setMuted(!sfx.isMuted());
    muteBtn.textContent = sfx.isMuted() ? "🔇 Lyd fra" : "🔊 Lyd til";
    if (!sfx.isMuted()) sfx.tap();
  });

  const hs = loadHighscores("bowling");
  if (hs.length > 0) {
    const box = screen.querySelector("#hs-box")!;
    box.innerHTML =
      `<div style="color:#6b93ab;font-weight:700;margin-bottom:8px;text-align:center">🏆 Bedste bowling-scores</div>` +
      hs
        .slice(0, 5)
        .map(
          (e, i) =>
            `<div style="color:#33505f;font-size:15px;padding:2px 0;text-align:center">${i + 1}. <b>${escapeHtml(e.name)}</b> — ${e.score}</div>`
        )
        .join("");
  }

  screen.querySelectorAll<HTMLButtonElement>(".game-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      sfx.tap();
      const game = btn.dataset.game!;
      if (btn.classList.contains("locked")) {
        btn.animate(
          [
            { transform: "translateX(0)" },
            { transform: "translateX(-6px)" },
            { transform: "translateX(6px)" },
            { transform: "translateX(0)" },
          ],
          { duration: 250 }
        );
        return;
      }
      if (game === "host") {
        showHostLobby(app);
        return;
      }
      if (game === "controller") {
        showControllerJoin(app, () => showMainMenu(app));
        return;
      }
      showPlayerSetup(app, game);
    });
  });
}

function showPlayerSetup(app: HTMLElement, game: string) {
  app.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";
  screen.innerHTML = `
    <div class="wii-title" style="font-size:clamp(22px,6vw,34px)">${game === "golf" ? "⛳" : "🎳"} Hvem spiller?</div>
    <div class="wii-subtitle">Tryk på cirklen for at skifte farve</div>
    <div class="player-list" id="player-list"></div>
    <div class="btn-row">
      <button class="btn btn-secondary" id="add-player">+ Tilføj spiller</button>
    </div>
    <div class="btn-row" style="margin-top:20px">
      <button class="btn btn-ghost" id="back">‹ Tilbage</button>
      <button class="btn btn-primary" id="start">Start spillet!</button>
    </div>
  `;
  app.appendChild(screen);

  let players: Player[] = loadPlayers();
  const listEl = screen.querySelector<HTMLElement>("#player-list")!;

  function render() {
    listEl.innerHTML = "";
    players.forEach((p, i) => {
      const row = document.createElement("div");
      row.className = "player-row";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.background = p.color;
      avatar.textContent = initialFor(p.name);
      avatar.addEventListener("click", () => {
        const idx = PLAYER_COLORS.indexOf(p.color);
        p.color = PLAYER_COLORS[(idx + 1) % PLAYER_COLORS.length];
        avatar.style.background = p.color;
      });

      const input = document.createElement("input");
      input.type = "text";
      input.maxLength = 12;
      input.value = p.name;
      input.placeholder = `Spiller ${i + 1}`;
      input.addEventListener("input", () => {
        p.name = input.value;
        avatar.textContent = initialFor(p.name || `S${i + 1}`);
      });

      row.appendChild(avatar);
      row.appendChild(input);

      if (players.length > 1) {
        const rm = document.createElement("button");
        rm.className = "remove-btn";
        rm.textContent = "✕";
        rm.addEventListener("click", () => {
          players.splice(i, 1);
          render();
        });
        row.appendChild(rm);
      }

      listEl.appendChild(row);
    });
  }
  render();

  screen.querySelector("#add-player")!.addEventListener("click", () => {
    if (players.length >= 4) return;
    const used = players.map((p) => p.color);
    const color = PLAYER_COLORS.find((c) => !used.includes(c)) || PLAYER_COLORS[players.length % PLAYER_COLORS.length];
    players.push({ name: `Spiller ${players.length + 1}`, color });
    render();
  });

  screen.querySelector("#back")!.addEventListener("click", () => showMainMenu(app));

  screen.querySelector("#start")!.addEventListener("click", () => {
    players = players.map((p, i) => ({
      ...p,
      name: p.name.trim() || `Spiller ${i + 1}`,
    }));
    savePlayers(players);
    if (game === "bowling") {
      startBowling(app, players, () => showMainMenu(app));
    } else if (game === "golf") {
      startGolf(app, players, () => showMainMenu(app));
    } else if (game === "kart") {
      startKart(app, players, () => showMainMenu(app));
    }
  });
}

function showHostLobby(app: HTMLElement, existing?: HostSession) {
  app.innerHTML = "";
  const screen = document.createElement("div");
  screen.className = "screen";
  screen.innerHTML = `
    <div class="wii-title" style="font-size:clamp(22px,6vw,34px)">📺 TV-tilstand</div>
    <div class="wii-subtitle">Opretter rum…</div>
    <div id="lobby-body" style="width:100%;max-width:460px;display:flex;flex-direction:column;align-items:center"></div>
    <div class="btn-row" style="margin-top:18px">
      <button class="btn btn-ghost" id="back">‹ Tilbage</button>
    </div>
  `;
  app.appendChild(screen);

  let host: HostSession | null = null;
  let closed = false;

  screen.querySelector("#back")!.addEventListener("click", () => {
    closed = true;
    host?.destroy();
    showMainMenu(app);
  });

  const body = screen.querySelector<HTMLElement>("#lobby-body")!;
  const sub = screen.querySelector<HTMLElement>(".wii-subtitle")!;

  function renderLobby() {
    if (!host) return;
    const joinUrl = location.origin + location.pathname;
    body.innerHTML = `
      <div style="background:#fff;border-radius:22px;padding:20px 30px;box-shadow:0 8px 24px rgba(43,127,191,0.15);text-align:center;margin-bottom:18px">
        <div style="color:#6b93ab;font-weight:600;font-size:14px">Åbn på telefonen og tryk 📱 Deltag</div>
        <div style="color:#33505f;font-weight:700;font-size:17px;margin:4px 0">${escapeHtml(joinUrl)}</div>
        <div style="color:#6b93ab;font-weight:600;font-size:14px;margin-top:10px">Rumkode</div>
        <div style="font-size:44px;font-weight:900;letter-spacing:14px;color:#2b7fbf;padding-left:14px">${host.roomCode}</div>
      </div>
      <div class="player-list" id="lobby-players"></div>
      <div class="btn-row">
        <button class="btn btn-primary" id="start-bowling" ${host.players.length === 0 ? "disabled style='opacity:0.5'" : ""}>🎳 Bowling</button>
        <button class="btn btn-primary" id="start-golf" ${host.players.length === 0 ? "disabled style='opacity:0.5'" : ""}>⛳ Golf</button>
        <button class="btn btn-primary" id="start-kart" ${host.players.length === 0 ? "disabled style='opacity:0.5'" : ""}>🏎️ Kart</button>
      </div>
    `;
    const list = body.querySelector<HTMLElement>("#lobby-players")!;
    if (host.players.length === 0) {
      list.innerHTML = `<div style="text-align:center;color:#6b93ab;font-weight:600">Venter på spillere… 📱</div>`;
    } else {
      host.players.forEach((p) => {
        const row = document.createElement("div");
        row.className = "player-row";
        row.innerHTML = `<div class="avatar" style="background:${p.color}">${initialFor(p.name)}</div>
          <div style="font-weight:700;color:#33505f;font-size:17px">${escapeHtml(p.name)}</div>
          <div style="margin-left:auto;color:#57b854;font-weight:700">✓ Klar</div>`;
        list.appendChild(row);
      });
    }
    const startGame = (game: GameId) => {
      if (!host || host.players.length === 0) return;
      host.startGame(game);
      const back = () => {
        host!.currentGame = null;
        host!.broadcast({ t: "gameover" });
        showHostLobby(app, host!);
      };
      if (game === "bowling") startBowling(app, host.players, back);
      else if (game === "golf") startGolf(app, host.players, back);
      else startKart(app, host.players, back);
    };
    body.querySelector("#start-bowling")!.addEventListener("click", () => startGame("bowling"));
    body.querySelector("#start-golf")!.addEventListener("click", () => startGame("golf"));
    body.querySelector("#start-kart")!.addEventListener("click", () => startGame("kart"));
  }

  if (existing) {
    host = existing;
    sub.textContent = "Telefonerne forbinder med koden:";
    renderLobby();
    host.onLobbyChange = renderLobby;
  } else {
    const h = createHost();
    h.start()
      .then(() => {
        if (closed) {
          h.destroy();
          return;
        }
        host = h;
        sub.textContent = "Telefonerne forbinder med koden:";
        renderLobby();
        h.onLobbyChange = renderLobby;
      })
      .catch(() => {
        sub.textContent = "Kunne ikke oprette rum — tjek internetforbindelsen";
      });
  }
}

function escapeHtml(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}
