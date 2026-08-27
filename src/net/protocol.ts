// Beskeder mellem vært (TV) og controllere (telefoner)

import { Player } from "../players";

export type GameId = "bowling" | "golf" | "kart";

// Controller -> vært
export type ControllerMsg =
  | { t: "join"; name: string; color: string }
  | { t: "swipe"; power: number; lateral: number; curve: number }
  | { t: "move"; dir: -1 | 1 }
  | { t: "rotate"; dir: -1 | 1 }
  | { t: "club"; dir: -1 | 1 }
  | { t: "steer"; v: number }
  | { t: "ready" };

// Vært -> controller
export type HostMsg =
  | { t: "joined"; index: number; roomCode: string }
  | { t: "lobby"; players: Player[] }
  | { t: "game"; game: GameId }
  | { t: "turn"; index: number; game: GameId; info: string }
  | { t: "info"; index: number; info: string }
  | { t: "gameover" };

export function makeRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function peerIdFor(code: string): string {
  return `telefon-wii-${code.toLowerCase()}`;
}
