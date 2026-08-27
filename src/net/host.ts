import Peer, { DataConnection } from "peerjs";
import { Player } from "../players";
import { ControllerMsg, GameId, HostMsg, makeRoomCode, peerIdFor } from "./protocol";

export interface RemotePlayer {
  player: Player;
  conn: DataConnection;
}

type InputHandler = (playerIndex: number, msg: ControllerMsg) => void;

/**
 * Værtssession (TV'et). Telefoner forbinder via PeerJS og fungerer som
 * controllere. Spillene lytter på input via onInput.
 */
export class HostSession {
  peer: Peer | null = null;
  roomCode = "";
  remotes: RemotePlayer[] = [];
  onLobbyChange: (() => void) | null = null;
  onInput: InputHandler | null = null;
  currentGame: GameId | null = null;

  async start(): Promise<string> {
    // Prøv et par rumkoder, hvis en er optaget
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeRoomCode();
      try {
        await this.tryStart(code);
        this.roomCode = code;
        return code;
      } catch (e) {
        this.peer?.destroy();
        this.peer = null;
        if (attempt === 3) throw e;
      }
    }
    throw new Error("Kunne ikke oprette rum");
  }

  private tryStart(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(peerIdFor(code));
      this.peer = peer;
      const timeout = setTimeout(() => reject(new Error("timeout")), 10000);
      peer.on("open", () => {
        clearTimeout(timeout);
        peer.on("connection", (conn) => this.handleConnection(conn));
        resolve();
      });
      peer.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  private handleConnection(conn: DataConnection) {
    conn.on("data", (raw) => {
      const msg = raw as ControllerMsg;
      if (msg.t === "join") {
        if (this.remotes.length >= 4) {
          conn.close();
          return;
        }
        const index = this.remotes.length;
        this.remotes.push({ player: { name: msg.name, color: msg.color }, conn });
        this.send(index, { t: "joined", index, roomCode: this.roomCode });
        this.broadcastLobby();
        if (this.currentGame) this.send(index, { t: "game", game: this.currentGame });
        this.onLobbyChange?.();
        return;
      }
      const index = this.remotes.findIndex((r) => r.conn === conn);
      if (index >= 0) this.onInput?.(index, msg);
    });
    conn.on("close", () => {
      const index = this.remotes.findIndex((r) => r.conn === conn);
      if (index >= 0) {
        this.remotes.splice(index, 1);
        this.broadcastLobby();
        this.onLobbyChange?.();
      }
    });
  }

  get players(): Player[] {
    return this.remotes.map((r) => r.player);
  }

  send(index: number, msg: HostMsg) {
    try {
      this.remotes[index]?.conn.send(msg);
    } catch {}
  }

  broadcast(msg: HostMsg) {
    for (let i = 0; i < this.remotes.length; i++) this.send(i, msg);
  }

  broadcastLobby() {
    this.broadcast({ t: "lobby", players: this.players });
  }

  startGame(game: GameId) {
    this.currentGame = game;
    this.broadcast({ t: "game", game });
  }

  /** Fortæl alle hvem der har turen; den aktive får sin egen besked. */
  announceTurn(index: number, info: string) {
    if (!this.currentGame) return;
    this.broadcast({ t: "turn", index, game: this.currentGame, info });
  }

  destroy() {
    this.peer?.destroy();
    this.peer = null;
    this.remotes = [];
    this.currentGame = null;
    activeHost = null;
  }
}

// Singleton: spillene tjekker denne for at se, om der er controller-tilstand
export let activeHost: HostSession | null = null;

export function createHost(): HostSession {
  activeHost?.destroy();
  const h = new HostSession();
  activeHost = h;
  return h;
}

export function getActiveHost(): HostSession | null {
  return activeHost;
}
