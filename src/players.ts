export interface Player {
  name: string;
  color: string;
}

export const PLAYER_COLORS = [
  "#e2564e", // rød
  "#3f9be0", // blå
  "#57b854", // grøn
  "#e8a838", // gul
  "#9b6bd4", // lilla
  "#e878b0", // pink
];

const STORAGE_KEY = "telefon-wii:players";
const HIGHSCORE_KEY = "telefon-wii:highscores";

export function loadPlayers(): Player[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [{ name: "Spiller 1", color: PLAYER_COLORS[0] }];
}

export function savePlayers(players: Player[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(players));
  } catch {}
}

export interface HighscoreEntry {
  name: string;
  score: number;
  date: string;
}

export function loadHighscores(game: string): HighscoreEntry[] {
  try {
    const raw = localStorage.getItem(`${HIGHSCORE_KEY}:${game}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

export function addHighscore(game: string, entry: HighscoreEntry) {
  const list = loadHighscores(game);
  list.push(entry);
  list.sort((a, b) => b.score - a.score);
  try {
    localStorage.setItem(`${HIGHSCORE_KEY}:${game}`, JSON.stringify(list.slice(0, 10)));
  } catch {}
}

export function initialFor(name: string): string {
  return (name.trim()[0] || "?").toUpperCase();
}
